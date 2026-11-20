window.initAdmin = async function initAdmin(api) {
  const select = document.getElementById("student-select");
  const editor = document.getElementById("plan-editor");
  const workoutDays = document.getElementById("workout-editor-days");
  const dietDays = document.getElementById("diet-editor-days");
  const message = document.getElementById("admin-message");
  const sections = {
    workout: { container: document.getElementById("workout-editor"), tab: document.getElementById("show-workout-editor"), save: document.getElementById("save-workout") },
    diet: { container: document.getElementById("diet-editor"), tab: document.getElementById("show-diet-editor"), save: document.getElementById("save-diet") }
  };
  const mealTypes = ["Pequeno-almoço", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar", "Ceia"];
  const exerciseFields = [["EXERCÍCIO", "name", 100], ["SÉRIES", "sets", 30], ["REP RANGE", "reps", 50], ["DESCANSO", "rest", 50]];
  let activeEmail = "";
  let dirty = { workout: false, diet: false };
  const blankDays = () => Array.from({ length: 7 }, () => ({ name: "", exercises: [], meals: [] }));

  function field(label, value, maxLength, multiline = false) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) input.type = "text";
    input.value = value;
    input.maxLength = maxLength;
    wrapper.append(input);
    return wrapper;
  }
  function removeButton(row, kind) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "editor-remove";
    remove.textContent = "Remover";
    remove.addEventListener("click", () => { row.remove(); dirty[kind] = true; });
    return remove;
  }
  function addExercise(container, values) {
    const row = document.createElement("div");
    row.className = "editor-row";
    exerciseFields.forEach(([label, key, max]) => {
      const wrapper = field(label, values[key] || "", max);
      const input = wrapper.querySelector("input");
      input.dataset.field = key;
      input.required = true;
      row.append(wrapper);
    });
    row.append(removeButton(row, "workout"));
    container.append(row);
  }
  function addMeal(container, meal) {
    const row = document.createElement("div");
    row.className = "diet-editor-row";
    const name = field("REFEIÇÃO", meal.name || "", 100);
    name.querySelector("input").className = "diet-name";
    const description = field("ALIMENTOS E QUANTIDADES", meal.description || "", 500, true);
    description.querySelector("textarea").className = "diet-description";
    description.querySelector("textarea").placeholder = "Ex.: 2 ovos, 1 fatia de pão e uma peça de fruta";
    const calories = field("KCAL (OPCIONAL)", meal.calories === undefined ? "" : String(meal.calories), 5);
    const caloriesInput = calories.querySelector("input");
    caloriesInput.className = "diet-calories";
    caloriesInput.type = "number";
    caloriesInput.min = "0";
    caloriesInput.max = "10000";
    caloriesInput.step = "1";
    caloriesInput.placeholder = "Ex.: 450";
    row.append(name, description, calories, removeButton(row, "diet"));
    container.append(row);
  }
  function daySection(index) {
    const section = document.createElement("details");
    section.className = "editor-day";
    section.open = index === 0;
    const summary = document.createElement("summary");
    summary.textContent = weekdays[index];
    section.append(summary);
    return section;
  }
  function renderEditor(days) {
    workoutDays.replaceChildren();
    dietDays.replaceChildren();
    days.forEach((day, index) => {
      const workout = daySection(index);
      const dayName = field("NOME DO TREINO (OPCIONAL)", day.name, 100);
      dayName.querySelector("input").className = "editor-day-name";
      workout.append(dayName);
      const exerciseRows = document.createElement("div");
      exerciseRows.className = "editor-exercises";
      day.exercises.forEach(exercise => addExercise(exerciseRows, exercise));
      workout.append(exerciseRows);
      const addExerciseButton = document.createElement("button");
      addExerciseButton.type = "button";
      addExerciseButton.className = "editor-add";
      addExerciseButton.textContent = "+ Adicionar exercício";
      addExerciseButton.addEventListener("click", () => { addExercise(exerciseRows, {}); dirty.workout = true; });
      workout.append(addExerciseButton);
      workoutDays.append(workout);

      const diet = daySection(index);
      const mealRows = document.createElement("div");
      mealRows.className = "editor-meals";
      const remaining = day.meals.slice();
      mealTypes.forEach(name => {
        const found = remaining.findIndex(meal => meal.name.trim().toLocaleLowerCase("pt-PT") === name.toLocaleLowerCase("pt-PT"));
        addMeal(mealRows, found < 0 ? { name, description: "" } : remaining.splice(found, 1)[0]);
      });
      remaining.forEach(meal => addMeal(mealRows, meal));
      diet.append(mealRows);
      const addMealButton = document.createElement("button");
      addMealButton.type = "button";
      addMealButton.className = "editor-add";
      addMealButton.textContent = "+ Adicionar outra refeição";
      addMealButton.addEventListener("click", () => { addMeal(mealRows, {}); dirty.diet = true; });
      diet.append(addMealButton);
      dietDays.append(diet);
    });
  }
  function collectWorkout() {
    return Array.from(workoutDays.querySelectorAll(".editor-day"), section => ({
      name: section.querySelector(".editor-day-name").value.trim(),
      exercises: Array.from(section.querySelectorAll(".editor-row"), row => {
        const item = {};
        row.querySelectorAll("input").forEach(input => { item[input.dataset.field] = input.value.trim(); });
        return item;
      })
    }));
  }
  function collectDiet() {
    return Array.from(dietDays.querySelectorAll(".editor-day"), section => ({
      meals: Array.from(section.querySelectorAll(".diet-editor-row"), row => {
        const meal = {
          name: row.querySelector(".diet-name").value.trim(),
          description: row.querySelector(".diet-description").value.trim()
        };
        const calories = row.querySelector(".diet-calories").value;
        if (calories !== "") meal.calories = Number(calories);
        return meal;
      }).filter(meal => meal.description)
    }));
  }
  function showSection(kind) {
    Object.entries(sections).forEach(([key, section]) => {
      const active = key === kind;
      section.container.hidden = !active;
      section.tab.classList.toggle("active", active);
      section.tab.setAttribute("aria-pressed", String(active));
    });
    message.textContent = "";
  }
  Object.entries(sections).forEach(([kind, section]) => {
    section.tab.addEventListener("click", () => showSection(kind));
    section.container.addEventListener("input", () => { dirty[kind] = true; });
    section.save.addEventListener("click", async () => {
      const missing = kind === "workout"
        ? Array.from(workoutDays.querySelectorAll("input[required]")).find(input => !input.value.trim())
        : Array.from(dietDays.querySelectorAll(".diet-editor-row")).find(row => row.querySelector(".diet-description").value.trim() && !row.querySelector(".diet-name").value.trim());
      if (missing) {
        missing.closest("details").open = true;
        const target = kind === "workout" ? missing : missing.querySelector(".diet-name");
        target.focus();
        message.textContent = kind === "workout" ? "Preenche todos os campos dos exercícios adicionados." : "Indica o nome de todas as refeições preenchidas.";
        return;
      }
      if (kind === "diet") {
        const invalidCalories = Array.from(dietDays.querySelectorAll(".diet-calories")).find(input =>
          !input.validity.valid || (input.value !== "" && !input.closest(".diet-editor-row").querySelector(".diet-description").value.trim()));
        if (invalidCalories) {
          invalidCalories.closest("details").open = true;
          invalidCalories.focus();
          message.textContent = "Indica calorias inteiras entre 0 e 10 000 numa refeição preenchida.";
          return;
        }
      }
      const days = kind === "workout" ? collectWorkout() : collectDiet();
      select.disabled = true;
      editor.inert = true;
      try {
        await api(`/api/student-plan?email=${encodeURIComponent(activeEmail)}&section=${kind}`, { method: "PUT", body: JSON.stringify({ days }) });
        dirty[kind] = false;
        message.textContent = kind === "workout" ? "Treino guardado e disponível para o aluno." : "Dieta guardada e disponível para o aluno.";
      } catch (error) { message.textContent = error.message; }
      finally { select.disabled = false; editor.inert = false; }
    });
  });
  const result = await api("/api/students");
  select.replaceChildren(new Option("Seleciona um aluno", ""));
  result.students.forEach(student => select.add(new Option(`${student.name} (${student.email})`, student.email)));
  if (!result.students.length) message.textContent = "Ainda não existem alunos no ficheiro de utilizadores.";
  select.addEventListener("change", async () => {
    if ((dirty.workout || dirty.diet) && !confirm("Há alterações por guardar. Queres descartá-las?")) { select.value = activeEmail; return; }
    activeEmail = select.value;
    dirty = { workout: false, diet: false };
    editor.hidden = true;
    message.textContent = "";
    if (!activeEmail) return;
    select.disabled = true;
    try {
      const data = await api(`/api/student-plan?email=${encodeURIComponent(activeEmail)}`);
      renderEditor(data.plan ? data.plan.days : blankDays());
      showSection("workout");
      editor.hidden = false;
    } catch (error) { message.textContent = error.message; select.value = ""; activeEmail = ""; }
    finally { select.disabled = false; }
  });
  window.addEventListener("beforeunload", event => { if (dirty.workout || dirty.diet) { event.preventDefault(); event.returnValue = ""; } });
};
