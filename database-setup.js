const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { validPlan, validText } = require("./common");
const { splitDays } = require("./database");

async function setup(client, imported) {
  const schema = await fs.readFile(path.join(__dirname, "database.sql"), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(schema);
    if (imported) {
      for (const user of imported.users) {
        await client.query(`
          INSERT INTO forma_users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
          ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
        [user.email, user.name, user.passwordHash, user.role]);
      }
      for (const [email, plan] of Object.entries(imported.plans)) {
        const { workout, diet } = splitDays(plan.days);
        await client.query(`
          INSERT INTO forma_plans (email, revision, workout, diet) VALUES ($1, $2, $3::jsonb, $4::jsonb)
          ON CONFLICT (email) DO UPDATE SET revision = EXCLUDED.revision, workout = EXCLUDED.workout, diet = EXCLUDED.diet`,
        [email, plan.revision || crypto.randomUUID(), JSON.stringify(workout), JSON.stringify(diet)]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function readImport() {
  const dir = process.env.FORMA_DATA_DIR ? path.resolve(process.env.FORMA_DATA_DIR) : path.join(__dirname, "data");
  const users = JSON.parse(await fs.readFile(path.join(dir, "users.json"), "utf8"));
  let plans;
  try { plans = JSON.parse(await fs.readFile(path.join(dir, "plans.json"), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    plans = {};
  }
  if (!Array.isArray(users) || users.length === 0 || !users.every(user =>
    user && validText(user.name, 100) && validText(user.email, 254) &&
    user.email === user.email.trim().toLowerCase() && ["admin", "aluno"].includes(user.role) &&
    typeof user.passwordHash === "string" && /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.passwordHash))) {
    throw new Error("users.json deve conter utilizadores válidos com palavras-passe protegidas.");
  }
  if (new Set(users.map(user => user.email)).size !== users.length) throw new Error("Existem emails duplicados em users.json.");
  if (!plans || Array.isArray(plans) || typeof plans !== "object" || !Object.values(plans).every(validPlan)) {
    throw new Error("plans.json contém planos inválidos.");
  }
  return { users, plans };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Define DATABASE_URL antes de executar este comando.");
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--import") || args.length > 1) throw new Error("Uso: npm run db:setup [-- --import]");
  const imported = args.includes("--import") ? await readImport() : null;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await setup(client, imported);
    console.log(imported ? "Tabelas criadas e dados importados." : "Tabelas criadas.");
  } finally {
    await client.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error("Não foi possível preparar a base de dados:", error.message);
  process.exitCode = 1;
});

module.exports = { setup, readImport };
