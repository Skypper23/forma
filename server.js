const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { verifyPassword, validText, validPlan } = require("./common");
const root = __dirname;
const dataDir = process.env.FORMA_DATA_DIR ? path.resolve(process.env.FORMA_DATA_DIR) : path.join(root, "data");
const usersFile = path.join(dataDir, "users.json");
const plansFile = path.join(dataDir, "plans.json");
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
const publicUrl = new URL(origin);
if (publicUrl.origin !== origin || (publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && publicUrl.hostname === "localhost"))) {
  throw new Error("PUBLIC_ORIGIN deve ser uma origem HTTPS exata, ou http://localhost:3000 para desenvolvimento.");
}
const port = Number(process.env.PORT || 3000);
const sessions = new Map();
const attempts = new Map();
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const assets = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/admin.js": ["admin.js", "text/javascript; charset=utf-8"]
};

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function users() {
  const list = await readJson(usersFile, []);
  if (!Array.isArray(list)) throw new Error("O ficheiro de utilizadores tem formato inválido.");
  return list;
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}
function cookie(value, maxAge) {
  return `forma_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${publicUrl.protocol === "https:" ? "; Secure" : ""}`;
}
async function body(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) throw Object.assign(new Error("É necessário enviar JSON."), { status: 415 });
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 200000) throw Object.assign(new Error("Pedido demasiado grande."), { status: 413 });
  }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("JSON inválido."), { status: 400 }); }
}
async function currentUser(req) {
  const match = /(?:^|;\s*)forma_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "");
  const session = match && sessions.get(match[1]);
  if (!session) return null;
  if (session.expires <= Date.now()) { sessions.delete(match[1]); return null; }
  const user = (await users()).find(item => item.email === session.email && item.passwordHash === session.passwordHash);
  if (!user || !["admin", "aluno"].includes(user.role)) { sessions.delete(match[1]); return null; }
  return user;
}
function safeUser(user) { return { name: user.name, email: user.email, role: user.role }; }
let writeQueue = Promise.resolve();
function savePlan(email, plan, section) {
  const operation = writeQueue.then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    const plans = await readJson(plansFile, {});
    let days = plan.days;
    if (section) {
      const currentDays = plans[email] ? plans[email].days : Array.from({ length: 7 }, () => ({ name: "", exercises: [], meals: [] }));
      days = currentDays.map((day, index) => section === "workout"
        ? { ...day, name: plan.days[index].name, exercises: plan.days[index].exercises }
        : { ...day, meals: plan.days[index].meals });
    }
    plans[email] = { revision: crypto.randomUUID(), days };
    const temp = path.join(dataDir, `plans-${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(plans, null, 2), { mode: 0o600 });
    await fs.rename(temp, plansFile);
    return plans[email];
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, origin);
    if (req.method === "GET" && assets[url.pathname]) {
      const [file, type] = assets[url.pathname];
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(await fs.readFile(path.join(root, file)));
      return;
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Não encontrado." });
    if (!["GET", "POST", "PUT"].includes(req.method)) return send(res, 405, { error: "Método não permitido." });
    if (req.method !== "GET" && req.headers.origin !== origin) return send(res, 403, { error: "Origem não autorizada." });

    if (url.pathname === "/api/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      for (const [key, record] of attempts) if (now - record.start > 15 * 60 * 1000) attempts.delete(key);
      for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
      const record = attempts.get(ip) || { start: now, count: 0 };
      if (record.count >= 10) return send(res, 429, { error: "Demasiadas tentativas. Tenta novamente mais tarde." });
      record.count++;
      attempts.set(ip, record);
      const input = await body(req);
      if (!input || !validText(input.email, 254) || !validText(input.password, 1024)) return send(res, 400, { error: "Preenche o email e a palavra-passe." });
      const email = input.email.trim().toLowerCase();
      const user = (await users()).find(item => item.email === email && ["admin", "aluno"].includes(item.role));
      const ok = await verifyPassword(input.password, user ? user.passwordHash : "scrypt:00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
      if (!ok || !user) return send(res, 401, { error: "Email ou palavra-passe incorretos." });
      attempts.delete(ip);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { email: user.email, passwordHash: user.passwordHash, expires: now + SESSION_MS });
      return send(res, 200, { user: safeUser(user) }, { "Set-Cookie": cookie(token, SESSION_MS / 1000) });
    }
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: "Inicia sessão para continuar." });
    if (url.pathname === "/api/logout" && req.method === "POST") {
      const match = /(?:^|;\s*)forma_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "");
      if (match) sessions.delete(match[1]);
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
    }
    if (url.pathname === "/api/me" && req.method === "GET") return send(res, 200, { user: safeUser(user) });
    if (url.pathname === "/api/plan" && req.method === "GET") {
      const plans = await readJson(plansFile, {});
      return send(res, 200, { plan: plans[user.email] || null });
    }
    if (url.pathname === "/api/students" && req.method === "GET") {
      if (user.role !== "admin") return send(res, 403, { error: "Acesso reservado a gestores." });
      return send(res, 200, { students: (await users()).filter(item => item.role === "aluno").map(safeUser) });
    }
    if (url.pathname === "/api/student-plan" && ["GET", "PUT"].includes(req.method)) {
      if (user.role !== "admin") return send(res, 403, { error: "Acesso reservado a gestores." });
      const email = url.searchParams.get("email");
      if (!(await users()).some(item => item.email === email && item.role === "aluno")) return send(res, 404, { error: "Aluno não encontrado." });
      if (req.method === "GET") {
        const plans = await readJson(plansFile, {});
        return send(res, 200, { plan: plans[email] || null });
      }
      const plan = await body(req);
      const section = url.searchParams.get("section");
      if (section && !["workout", "diet"].includes(section)) return send(res, 400, { error: "Tipo de plano inválido." });
      let validationPlan = plan;
      if (section && plan && Array.isArray(plan.days)) {
        validationPlan = { days: plan.days.map(day => section === "workout"
          ? { name: day && day.name, exercises: day && day.exercises, meals: [] }
          : { name: "", exercises: [], meals: day && day.meals }) };
      }
      if (!validPlan(validationPlan)) return send(res, 400, { error: "O plano é inválido. Confirma os campos de todos os dias." });
      return send(res, 200, { plan: await savePlan(email, plan, section) });
    }
    return send(res, 404, { error: "Não encontrado." });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : "Erro no servidor. Tenta novamente." });
    else res.destroy();
  }
});

if (require.main === module) {
  const host = process.env.VERCEL ? "0.0.0.0" : "127.0.0.1";
  server.listen(port, host, () => console.log(`FORMA disponível em http://localhost:${port}`));
}

module.exports = { server, validPlan, verifyPassword };
