const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { Pool } = require("pg");
const { createStore } = require("../database");
const { verifyPassword, validText, validPlan } = require("../common");

let store;
function getStore() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está configurada.");
  if (!store) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    pool.on("error", error => console.error("Erro numa ligação inativa à base de dados:", error));
    store = createStore(pool);
  }
  return store;
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

async function body(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) throw Object.assign(new Error("É necessário enviar JSON."), { status: 415 });
  let text = "";
  let size = 0;
  const decoder = new StringDecoder("utf8");
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 200000) throw Object.assign(new Error("Pedido demasiado grande."), { status: 413 });
    text += decoder.write(chunk);
  }
  text += decoder.end();
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("JSON inválido."), { status: 400 }); }
}

function sessionToken(req) {
  const match = /(?:^|;\s*)forma_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "");
  return match && match[1];
}

function createHandler(getDatabase) {
  return async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const origin = process.env.APP_ORIGIN || process.env.PUBLIC_ORIGIN;
      if (!origin) throw new Error("APP_ORIGIN não está configurada.");
      const publicUrl = new URL(origin);
      if (publicUrl.origin !== origin || publicUrl.protocol !== "https:") throw new Error("APP_ORIGIN deve ser uma origem HTTPS exata.");
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Não encontrado." });
      if (!["GET", "POST", "PUT"].includes(req.method)) return send(res, 405, { error: "Método não permitido." });
      if (req.method !== "GET" && req.headers.origin !== origin) return send(res, 403, { error: "Origem não autorizada." });
      const db = getDatabase();
      const cookie = (value, maxAge) => `forma_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Secure`;
      if (url.pathname === "/api/login" && req.method === "POST") {
        const ip = req.headers["x-vercel-forwarded-for"];
        if (typeof ip !== "string" || !ip) throw new Error("Não foi possível identificar o endereço do cliente.");
        if (!await db.attempt(ip)) return send(res, 429, { error: "Demasiadas tentativas. Tenta novamente mais tarde." });
        const input = await body(req);
        if (!input || !validText(input.email, 254) || !validText(input.password, 1024)) return send(res, 400, { error: "Preenche o email e a palavra-passe." });
        const user = await db.user(input.email.trim().toLowerCase());
        const ok = await verifyPassword(input.password, user ? user.passwordHash : "scrypt:00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
        if (!ok || !user) return send(res, 401, { error: "Email ou palavra-passe incorretos." });
        const token = crypto.randomBytes(32).toString("hex");
        await db.createSession(token, user);
        await db.clearAttempts(ip);
        return send(res, 200, { user: { name: user.name, email: user.email, role: user.role } }, { "Set-Cookie": cookie(token, 604800) });
      }
      const token = sessionToken(req);
      const user = token && await db.sessionUser(token);
      if (!user) return send(res, 401, { error: "Inicia sessão para continuar." });
      if (url.pathname === "/api/logout" && req.method === "POST") {
        await db.deleteSession(token);
        return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
      }
      if (url.pathname === "/api/me" && req.method === "GET") return send(res, 200, { user });
      if (url.pathname === "/api/plan" && req.method === "GET") return send(res, 200, { plan: await db.plan(user.email) });
      if (url.pathname === "/api/students" && req.method === "GET") {
        if (user.role !== "admin") return send(res, 403, { error: "Acesso reservado a gestores." });
        return send(res, 200, { students: await db.students() });
      }
      if (url.pathname === "/api/student-plan" && ["GET", "PUT"].includes(req.method)) {
        if (user.role !== "admin") return send(res, 403, { error: "Acesso reservado a gestores." });
        const email = url.searchParams.get("email");
        const student = await db.user(email);
        if (!student || student.role !== "aluno") return send(res, 404, { error: "Aluno não encontrado." });
        if (req.method === "GET") return send(res, 200, { plan: await db.plan(email) });
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
        return send(res, 200, { plan: await db.savePlan(email, plan, section) });
      }
      return send(res, 404, { error: "Não encontrado." });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : "Erro no servidor. Tenta novamente." });
      else res.destroy();
    }
  };
}

module.exports = createHandler(getStore);
module.exports.createHandler = createHandler;
