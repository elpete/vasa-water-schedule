const form = document.querySelector("#search-form");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const resultsEl = document.querySelector("#results");
const dateInput = document.querySelector("#date");
const zipInput = document.querySelector("#zip");

dateInput.value = new Date().toISOString().slice(0, 10);

function classNameFor(schedule) {
  return schedule.classes.length ? "location" : "location empty";
}

function renderClass(item) {
  const capacity = item.available && item.capacity ? `${item.available}/${item.capacity} open` : "";
  return `
    <article class="class-row ${item.canceled ? "is-canceled" : ""}">
      <div class="time">${item.time || "Time TBA"}</div>
      <div class="details">
        <h3>${item.title || item.room}${item.subtitle ? `<span>${item.subtitle}</span>` : ""}</h3>
        <p>${[item.instructor, item.room, capacity].filter(Boolean).join(" · ")}</p>
      </div>
      ${item.canceled ? '<div class="badge">Canceled</div>' : ""}
    </article>
  `;
}

function render(data) {
  summaryEl.hidden = false;
  const activity = data.activity === "water" ? "Water activities" : "All classes";
  summaryEl.textContent = `${activity} · ${data.schedules.length} clubs within ${data.miles} miles · ${data.day}, ${data.date}`;

  resultsEl.innerHTML = data.schedules
    .map((schedule) => {
      const rows = schedule.error
        ? `<p class="muted">${schedule.error}</p>`
          : schedule.classes.length
          ? schedule.classes.map(renderClass).join("")
          : '<p class="muted">No matching classes found for this weekday on the public VASA schedule page.</p>';

      return `
        <section class="${classNameFor(schedule)}">
          <div class="location-head">
            <div>
              <h2>${schedule.name}</h2>
              <p>${schedule.address || ""}${Number.isFinite(schedule.distanceMiles) ? ` · ${schedule.distanceMiles} mi` : ""}</p>
            </div>
            <a href="${schedule.scheduleUrl}" target="_blank" rel="noreferrer">VASA page</a>
          </div>
          <div class="classes">${rows}</div>
        </section>
      `;
    })
    .join("");
}

async function loadSchedules(event) {
  event.preventDefault();
  const params = new URLSearchParams(new FormData(form));

  statusEl.textContent = "Loading VASA schedules...";
  summaryEl.hidden = true;
  resultsEl.innerHTML = "";

  try {
    const response = await fetch(`/api/schedules?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load schedules.");
    statusEl.textContent = data.note;
    render(data);
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

form.addEventListener("submit", loadSchedules);

if (new URLSearchParams(location.search).has("zip")) {
  const params = new URLSearchParams(location.search);
  zipInput.value = params.get("zip") || "";
  dateInput.value = params.get("date") || dateInput.value;
  document.querySelector("#miles").value = params.get("miles") || "25";
  document.querySelector("#activity").value = params.get("activity") || "water";
  form.requestSubmit();
}
