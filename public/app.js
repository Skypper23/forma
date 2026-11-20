const weekdays = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const todayIndex = () => (new Date().getDay() + 6) % 7;
const emptyDay = () => ({ date: localDate(), meals: [], water: 0, completedMeals: [] });
let state = emptyDay();
let history = {};
let plan = null;
let storageKey = "";
let user = null;

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir o pedido.");
  return data;
}
function notify(message) { document.getElementById("status").textContent = message; }
function loadTracking() {
  history = {};
  state = emptyDay();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && saved.days && typeof saved.days === "object") history = saved.days;
    if (history[localDate()]) state = history[localDate()];
  } catch (error) {
    console.error(error);
    notify("Não foi possível carregar os dados deste navegador.");
  }
}
function save() {
  try {
    history[state.date] = state;
    localStorage.setItem(storageKey, JSON.stringify({ days: history }));
    return true;
  } catch (error) {
    console.error(error);
    notify("Não foi possível guardar os dados neste navegador.");
    return false;
  }
}
function ensureToday() {
  if (state.date !== localDate()) state = history[localDate()] || emptyDay();
  if (!Array.isArray(state.completedMeals)) state.completedMeals = [];
}
function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}
function todayPlanMeals() {
  const occurrences = new Map();
  return (plan ? plan.days[todayIndex()].meals : []).map(meal => {
    const identity = JSON.stringify([meal.name, meal.description]);
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    return { meal, key: JSON.stringify([meal.name, meal.description, occurrence]) };
  });
}
function updateCalories() {
  const manual = state.meals.reduce((sum, meal) => sum + meal.calories, 0);
  const planned = todayPlanMeals().reduce((sum, { meal, key }) =>
    sum + (state.completedMeals.includes(key) && Number.isInteger(meal.calories) ? meal.calories : 0), 0);
  const calories = manual + planned;
  document.getElementById("calorie-count").textContent = calories.toLocaleString("pt-PT");
  document.getElementById("meal-total").textContent = calories.toLocaleString("pt-PT");
  document.getElementById("calorie-progress").style.width = `${Math.min(calories / 2000 * 100, 100)}%`;
  document.getElementById("nutrition-ring").style.background = `conic-gradient(var(--red) ${Math.min(calories / 2000 * 360, 360)}deg, #393b35 0deg)`;
}
function renderPlans() {
  const workout = document.getElementById("exercise-list");
  const diet = document.getElementById("diet-plan");
  workout.replaceChildren();
  diet.replaceChildren();
  document.getElementById("diet-weekday").textContent = weekdays[todayIndex()].toUpperCase();
  if (!plan) {
    workout.append(text("p", "plan-empty", "Ainda não tens um plano atribuído. Contacta a tua equipa."));
    diet.append(text("p", "plan-empty", "Ainda não tens um plano alimentar atribuído."));
    return;
  }
  const workoutDays = plan.days.filter(day => day.exercises.length);
  if (!workoutDays.length) workout.append(text("p", "plan-empty", "Ainda não tens treinos atribuídos."));
  plan.days.forEach((day, dayIndex) => {
    if (day.exercises.length) {
    const section = document.createElement("details");
    section.className = "plan-day";
    section.open = dayIndex === todayIndex();
    const summary = document.createElement("summary");
    summary.append(text("span", "", weekdays[dayIndex]), text("strong", "", day.name || "Treino"));
    section.append(summary);
    day.exercises.forEach((exercise, index) => {
      const row = document.createElement("div");
      row.className = "exercise";
      row.append(text("span", "exercise-num", String(index + 1).padStart(2, "0")));
      const info = document.createElement("div");
      info.className = "exercise-info";
      info.append(text("strong", "", exercise.name), text("span", "", `${exercise.sets} séries · ${exercise.reps} reps · descanso: ${exercise.rest}`));
      row.append(info);
      section.append(row);
    });
    workout.append(section);
    }
  });
  const meals = todayPlanMeals();
  if (!meals.length) {
    diet.append(text("p", "plan-empty", "Não tens refeições atribuídas para hoje."));
    return;
  }
  const renderedDate = localDate();
  meals.forEach(({ meal, key }) => {
    const item = document.createElement("div");
    item.className = "diet-item";
    const info = document.createElement("div");
    info.className = "diet-item-info";
    info.append(text("strong", "", meal.name), text("p", "", meal.description));
    info.append(text("span", "diet-kcal", Number.isInteger(meal.calories) ? `${meal.calories.toLocaleString("pt-PT")} kcal` : "Calorias não indicadas"));
    const label = document.createElement("label");
    label.className = "diet-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.completedMeals.includes(key);
    checkbox.setAttribute("aria-label", `Marcar ${meal.name} como consumida`);
    checkbox.addEventListener("change", () => {
      if (renderedDate !== localDate()) { render(); return; }
      ensureToday();
      const previous = state.completedMeals;
      state.completedMeals = checkbox.checked ? [...previous, key] : previous.filter(item => item !== key);
      if (!save()) {
        state.completedMeals = previous;
        checkbox.checked = !checkbox.checked;
      } else updateCalories();
    });
    label.append(checkbox, text("span", "", "Já comi"));
    item.append(info, label);
    diet.append(item);
  });
  diet.append(text("p", "diet-check-note", "As refeições marcadas somam as calorias indicadas. Evita registá-las novamente abaixo."));
}
function render() {
  ensureToday();
  document.getElementById("today-date").textContent = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()).toUpperCase();
  updateCalories();
  document.getElementById("water-count").textContent = state.water;
  document.getElementById("water-minus").disabled = state.water === 0;
  document.getElementById("water-dots").innerHTML = Array.from({ length: 8 }, (_, index) => `<span class="${index < state.water ? "filled" : ""}"></span>`).join("");
  renderPlans();

  const mealList = document.getElementById("meal-list");
  mealList.replaceChildren();
  if (!state.meals.length) mealList.append(text("div", "empty-meals", "Ainda não registaste refeições hoje. Começa quando quiseres."));
  state.meals.forEach((meal, index) => {
    const row = document.createElement("div");
    row.className = "meal-row";
    const remove = text("button", "delete-meal", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remover ${meal.name}`);
    remove.addEventListener("click", () => { ensureToday(); state.meals.splice(index, 1); save(); render(); });
    row.append(text("span", "meal-bullet", String(index + 1).padStart(2, "0")), text("span", "meal-name", meal.name), text("span", "meal-calories", `${meal.calories.toLocaleString("pt-PT")} kcal`), remove);
    mealList.append(row);
  });
}
async function startSession(currentUser) {
  user = currentUser;
  storageKey = `forma-daily-v2:${user.email}`;
  loadTracking();
  const result = await api("/api/plan");
  plan = result.plan;
  document.getElementById("profile-name").textContent = user.name;
  document.getElementById("profile-role").textContent = user.role === "admin" ? "Gestor" : "Aluno · dados neste navegador";
  document.getElementById("profile-avatar").textContent = user.name.slice(0, 2).toUpperCase();
  document.getElementById("admin-link").hidden = user.role !== "admin";
  document.getElementById("gestao").hidden = user.role !== "admin";
  document.getElementById("login-screen").hidden = true;
  document.body.classList.remove("auth-pending");
  render();
  if (user.role === "admin") await window.initAdmin(api);
}
function showLogin(message = "") {
  document.body.classList.add("auth-pending");
  document.getElementById("login-screen").hidden = false;
  document.getElementById("login-error").textContent = message;
}
document.getElementById("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ email: document.getElementById("login-email").value, password: document.getElementById("login-password").value }) });
    document.getElementById("login-password").value = "";
    await startSession(result.user);
  } catch (error) { showLogin(error.message); }
  finally { button.disabled = false; }
});
document.getElementById("logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); location.reload(); }
  catch (error) { notify(error.message); }
});
document.getElementById("water-minus").addEventListener("click", () => { ensureToday(); state.water = Math.max(0, state.water - 1); save(); render(); });
document.getElementById("water-plus").addEventListener("click", () => { ensureToday(); state.water++; save(); render(); });
const dialog = document.getElementById("meal-dialog");
const mealForm = document.getElementById("meal-form");
document.getElementById("open-meal").addEventListener("click", () => dialog.showModal());
document.getElementById("close-meal").addEventListener("click", () => dialog.close());
mealForm.addEventListener("submit", event => {
  event.preventDefault();
  const nameInput = document.getElementById("meal-name");
  const name = nameInput.value.trim();
  if (!name) { nameInput.setCustomValidity("Introduz o nome da refeição."); nameInput.reportValidity(); return; }
  ensureToday();
  state.meals.push({ name, calories: Number(document.getElementById("meal-calories").value) });
  const saved = save();
  render();
  mealForm.reset();
  dialog.close();
  if (saved) notify("Refeição registada.");
});
document.getElementById("meal-name").addEventListener("input", event => event.target.setCustomValidity(""));
document.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach(item => item.classList.remove("active"));
  link.classList.add("active");
}));
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && user) {
    try { plan = (await api("/api/plan")).plan; render(); }
    catch (error) { notify(error.message); }
  }
});
function scheduleNextDay() {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  setTimeout(() => {
    if (user) render();
    scheduleNextDay();
  }, midnight.getTime() - Date.now() + 100);
}
scheduleNextDay();
(async () => {
  try { await startSession((await api("/api/me")).user); }
  catch (error) { showLogin(error.message === "Inicia sessão para continuar." ? "" : error.message); }
})();
