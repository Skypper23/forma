const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { PGlite } = require("@electric-sql/pglite");
const { setup } = require("../database-setup");
const { createStore } = require("../database");
const { createHandler } = require("../api/[...path]");

test("API Vercel guarda sessões e planos em PostgreSQL", async t => {
  const postgres = new PGlite();
  const db = {
    query: (sql, params) => sql.includes("CREATE TABLE") ? postgres.exec(sql) : postgres.query(sql, params)
  };
  t.after(() => postgres.close());
  const password = "password-de-teste-123";
  const hash = `scrypt:${"01".repeat(16)}:${crypto.scryptSync(password, Buffer.alloc(16, 1), 64).toString("hex")}`;
  const users = [
    { name: "Gestor", email: "gestor@example.test", passwordHash: hash, role: "admin" },
    { name: "Aluno", email: "aluno@example.test", passwordHash: hash, role: "aluno" }
  ];
  await setup(db, { users, plans: {} });
  const store = createStore(db);
  process.env.APP_ORIGIN = "https://forma.example.test";
  process.env.PUBLIC_ORIGIN = "https://origem-antiga.example.test";
  const servers = [http.createServer(createHandler(() => store)), http.createServer(createHandler(() => createStore(db)))];
  for (const server of servers) {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
  }
  const request = (instance, url, options = {}) => fetch(`http://127.0.0.1:${servers[instance].address().port}${url}`, {
    ...options,
    headers: { Origin: process.env.APP_ORIGIN, "Content-Type": "application/json", "x-vercel-forwarded-for": "192.0.2.1", ...options.headers }
  });
  async function login(email) {
    const response = await request(0, "/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800; Secure/);
    return cookie.split(";")[0];
  }
  delete process.env.APP_ORIGIN;
  assert.equal((await request(0, "/api/logout", { method: "POST", headers: { Origin: process.env.PUBLIC_ORIGIN }, body: "{}" })).status, 401);
  process.env.APP_ORIGIN = "https://forma.example.test";
  assert.equal((await request(0, "/api/login", { method: "POST", headers: { Origin: "https://outro.test" }, body: "{}" })).status, 403);
  const admin = await login("gestor@example.test");
  const student = await login("aluno@example.test");
  assert.equal((await request(1, "/api/me", { headers: { Cookie: student } })).status, 200);
  assert.equal((await request(1, "/api/students", { headers: { Cookie: student } })).status, 403);

  const url = "/api/student-plan?email=aluno%40example.test";
  const workout = Array.from({ length: 7 }, () => ({ name: "Treino", exercises: [] }));
  const diet = Array.from({ length: 7 }, () => ({ meals: [{ name: "Almoço", description: "Arroz", calories: 300 }] }));
  const responses = await Promise.all([
    request(0, `${url}&section=workout`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: workout }) }),
    request(1, `${url}&section=diet`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: diet }) })
  ]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const result = await (await request(1, "/api/plan", { headers: { Cookie: student } })).json();
  assert.deepEqual(result.plan.days, workout.map((day, i) => ({ ...day, meals: diet[i].meals })));
  await assert.rejects(setup(db, {
    users: [{ ...users[0], name: "Nome alterado" }],
    plans: { "inexistente@example.test": result.plan }
  }));
  assert.equal((await store.user("gestor@example.test")).name, "Gestor");
  assert.equal((await request(1, `${url}&section=diet`, { method: "PUT", headers: { Cookie: student }, body: "{}" })).status, 403);
  assert.equal((await request(0, "/api/logout", { method: "POST", headers: { Cookie: student }, body: "{}" })).status, 200);
  assert.equal((await request(1, "/api/me", { headers: { Cookie: student } })).status, 401);

  for (let i = 0; i < 10; i++) {
    const response = await request(0, "/api/login", {
      method: "POST", headers: { "x-vercel-forwarded-for": "192.0.2.2" },
      body: JSON.stringify({ email: "aluno@example.test", password: "incorreta" })
    });
    assert.equal(response.status, 401);
  }
  assert.equal((await request(1, "/api/login", {
    method: "POST", headers: { "x-vercel-forwarded-for": "192.0.2.2" },
    body: JSON.stringify({ email: "aluno@example.test", password })
  })).status, 429);

  await db.query("UPDATE forma_users SET password_hash = $1 WHERE email = $2", [hash + "changed", "gestor@example.test"]);
  assert.equal((await request(1, "/api/me", { headers: { Cookie: admin } })).status, 401);
});
