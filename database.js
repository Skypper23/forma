const crypto = require("node:crypto");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const emptyDays = () => Array.from({ length: 7 }, () => ({ name: "", exercises: [], meals: [] }));

function splitDays(days) {
  return {
    workout: days.map(day => ({ name: day.name, exercises: day.exercises })),
    diet: days.map(day => ({ meals: day.meals }))
  };
}

function combinePlan(row) {
  if (!row) return null;
  return {
    revision: row.revision,
    days: row.workout.map((day, i) => ({ ...day, meals: row.diet[i].meals }))
  };
}

function createStore(db) {
  return {
    async user(email) {
      const { rows } = await db.query(
        'SELECT name, email, password_hash AS "passwordHash", role FROM forma_users WHERE email = $1', [email]
      );
      return rows[0] || null;
    },
    async students() {
      const { rows } = await db.query("SELECT name, email, role FROM forma_users WHERE role = 'aluno' ORDER BY name, email");
      return rows;
    },
    async attempt(ip) {
      await db.query("DELETE FROM forma_login_attempts WHERE started_at <= now() - interval '15 minutes'");
      await db.query("DELETE FROM forma_sessions WHERE expires_at <= now()");
      const { rows } = await db.query(`
        INSERT INTO forma_login_attempts (ip_hash, started_at, attempts)
        VALUES ($1, now(), 1)
        ON CONFLICT (ip_hash) DO UPDATE SET
          started_at = CASE WHEN forma_login_attempts.started_at <= now() - interval '15 minutes' THEN now() ELSE forma_login_attempts.started_at END,
          attempts = CASE WHEN forma_login_attempts.started_at <= now() - interval '15 minutes' THEN 1 ELSE forma_login_attempts.attempts + 1 END
        RETURNING attempts`, [digest(ip)]);
      return rows[0].attempts <= 10;
    },
    async clearAttempts(ip) {
      await db.query("DELETE FROM forma_login_attempts WHERE ip_hash = $1", [digest(ip)]);
    },
    async createSession(token, user) {
      await db.query(
        "INSERT INTO forma_sessions (token_hash, email, password_hash, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')",
        [digest(token), user.email, user.passwordHash]
      );
    },
    async sessionUser(token) {
      const { rows } = await db.query(`
        SELECT u.name, u.email, u.role FROM forma_sessions s
        JOIN forma_users u ON u.email = s.email AND u.password_hash = s.password_hash
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [digest(token)]);
      return rows[0] || null;
    },
    async deleteSession(token) {
      await db.query("DELETE FROM forma_sessions WHERE token_hash = $1", [digest(token)]);
    },
    async plan(email) {
      const { rows } = await db.query("SELECT revision, workout, diet FROM forma_plans WHERE email = $1", [email]);
      return combinePlan(rows[0]);
    },
    async savePlan(email, plan, section) {
      const empty = splitDays(emptyDays());
      const workout = section === "diet" ? empty.workout : plan.days.map(day => ({ name: day.name, exercises: day.exercises }));
      const diet = section === "workout" ? empty.diet : plan.days.map(day => ({ meals: day.meals }));
      const { rows } = await db.query(`
        INSERT INTO forma_plans (email, revision, workout, diet)
        VALUES ($1, $2, $3::jsonb, $4::jsonb)
        ON CONFLICT (email) DO UPDATE SET
          revision = EXCLUDED.revision,
          workout = CASE WHEN $5 = 'diet' THEN forma_plans.workout ELSE EXCLUDED.workout END,
          diet = CASE WHEN $5 = 'workout' THEN forma_plans.diet ELSE EXCLUDED.diet END
        RETURNING revision, workout, diet`,
      [email, crypto.randomUUID(), JSON.stringify(workout), JSON.stringify(diet), section || ""]);
      return combinePlan(rows[0]);
    }
  };
}

module.exports = { createStore, splitDays };
