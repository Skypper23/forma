const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);

async function verifyPassword(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split(":") : [];
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = await scrypt(password, Buffer.from(parts[1], "hex"), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
}
function validText(value, max, required = true) {
  return typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
}
function validPlan(plan) {
  return plan && Array.isArray(plan.days) && plan.days.length === 7 && plan.days.every(day =>
    day && validText(day.name, 100, false) && Array.isArray(day.exercises) && day.exercises.length <= 30 &&
    day.exercises.every(ex => ex && validText(ex.name, 100) && validText(ex.sets, 30) && validText(ex.reps, 50) && validText(ex.rest, 50)) &&
    Array.isArray(day.meals) && day.meals.length <= 30 &&
    day.meals.every(meal => meal && validText(meal.name, 100) && validText(meal.description, 500) &&
      (meal.calories === undefined || (Number.isInteger(meal.calories) && meal.calories >= 0 && meal.calories <= 10000))));
}

module.exports = { verifyPassword, validText, validPlan };
