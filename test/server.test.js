const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

test("login, autorização e planos individuais", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forma-test-"));
  process.env.FORMA_DATA_DIR = dir;
  const password = "password-de-teste-123";
  const salt = crypto.randomBytes(16);
  const hash = `scrypt:${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
  await fs.writeFile(path.join(dir, "users.json"), JSON.stringify([
    { name: "Gestor", email: "gestor@example.test", passwordHash: hash, role: "admin" },
    { name: "Aluno A", email: "a@example.test", passwordHash: hash, role: "aluno" },
    { name: "Aluno B", email: "b@example.test", passwordHash: hash, role: "aluno" }
  ]));
  const { server } = require("../server");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(base + url, {
    ...options,
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", ...options.headers }
  });
  async function login(email) {
    const response = await request("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.match(cookie, /Max-Age=604800/);
    return cookie.split(";")[0];
  }
  assert.equal((await request("/data/users.json")).status, 404);
  assert.equal((await request("/api/students")).status, 401);
  assert.equal((await request("/api/login", { method: "POST", headers: { Origin: "https://outra.test" }, body: "{}" })).status, 403);
  assert.equal((await request("/api/login", { method: "POST", body: JSON.stringify({ email: "a@example.test", password: "errada" }) })).status, 401);
  const admin = await login("gestor@example.test");
  const student = await login("a@example.test");
  const other = await login("b@example.test");
  assert.equal((await request("/api/students", { headers: { Cookie: student } })).status, 403);
  const url = "/api/student-plan?email=a%40example.test";
  assert.equal((await request(url, { method: "PUT", headers: { Cookie: student }, body: "{}" })).status, 403);
  assert.equal((await request(url, { method: "PUT", headers: { Cookie: admin }, body: "{}" })).status, 400);
  const days = Array.from({ length: 7 }, () => ({ name: "", exercises: [], meals: [] }));
  days[0] = { name: "Peito", exercises: [{ name: "Supino", sets: "3", reps: "8-12", rest: "90 segundos" }], meals: [{ name: "Almoço", description: "Arroz e legumes" }] };
  const saved = await request(url, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days }) });
  assert.equal(saved.status, 200);
  const own = await (await request("/api/plan", { headers: { Cookie: student } })).json();
  assert.deepEqual(own.plan.days, days);
  const workoutDays = days.map(day => ({ name: day.name, exercises: day.exercises }));
  workoutDays[0].name = "Peito e costas";
  workoutDays[1] = { name: "Pernas", exercises: [{ name: "Agachamento", sets: "4", reps: "6-8", rest: "2 min" }] };
  const dietDays = days.map(day => ({ meals: day.meals }));
  dietDays[0] = { meals: [{ name: "Pequeno-almoço", description: "Aveia e fruta", calories: 350 }, ...days[0].meals] };
  const results = await Promise.all([
    request(`${url}&section=workout`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: workoutDays }) }),
    request(`${url}&section=diet`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: dietDays }) })
  ]);
  assert.deepEqual(results.map(response => response.status), [200, 200]);
  const updated = await (await request("/api/plan", { headers: { Cookie: student } })).json();
  assert.equal(updated.plan.days[0].name, "Peito e costas");
  assert.deepEqual(updated.plan.days[0].meals, dietDays[0].meals);
  assert.deepEqual(updated.plan.days[1].exercises, workoutDays[1].exercises);
  const invalidDiet = dietDays.map(day => ({ meals: day.meals.map(meal => ({ ...meal })) }));
  for (const invalid of [-1, 10001, 2.5, "350", null]) {
    invalidDiet[0].meals[0].calories = invalid;
    assert.equal((await request(`${url}&section=diet`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: invalidDiet }) })).status, 400);
  }
  invalidDiet[0].meals[0].calories = 0;
  assert.equal((await request(`${url}&section=diet`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: invalidDiet }) })).status, 200);
  assert.equal((await request(`${url}&section=diet`, { method: "PUT", headers: { Cookie: admin }, body: JSON.stringify({ days: [{ meals: [] }] }) })).status, 400);
  assert.equal((await request(`${url}&section=workout`, { method: "PUT", headers: { Cookie: student }, body: JSON.stringify({ days: workoutDays }) })).status, 403);
  const otherPlan = await (await request("/api/plan", { headers: { Cookie: other } })).json();
  assert.equal(otherPlan.plan, null);
  assert.equal((await request("/api/logout", { method: "POST", headers: { Cookie: student }, body: "{}" })).status, 200);
  assert.equal((await request("/api/me", { headers: { Cookie: student } })).status, 401);
});
