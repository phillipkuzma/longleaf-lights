import { buildQuote, money } from "./pricing.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const long = (iso) => fmt(iso, { weekday: "long", month: "long", day: "numeric" });

let cfg;
let avail = { 1: null, 2: null };
const state = {
  step: 1,
  street: "",
  zip: "",
  stories: 1,
  package: "classic",
  kit: true,
  addons: {},
  installDate: null,
  wantTakedown: true,
  takedownDate: null,
};

// ---------------------------------------------------------------- steps
function show(step) {
  state.step = step;
  $$(".step").forEach((s) => (s.hidden = Number(s.dataset.step) !== step));
  $$("#progress li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.className = n === step ? "current" : n < step ? "done" : "";
    if (n === step) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  const heading = $(`.step[data-step="${step}"] h1`);
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$("[data-back]").forEach((b) => b.addEventListener("click", () => show(state.step - 1)));

// ---------------------------------------------------------------- step 1
$("#next-1").addEventListener("click", async () => {
  const err = $("#err-1");
  err.textContent = "";
  state.street = $("#street").value.trim();
  state.zip = $("#zip").value.trim();
  const btn = $("#next-1");
  btn.disabled = true;
  try {
    const r = await fetch("/api/check-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ street: state.street, zip: state.zip }),
    }).then((r) => r.json());
    if (!r.ok) {
      err.textContent = r.reason;
      return;
    }
    show(2);
  } catch {
    err.textContent = "We couldn't check that address. Check your connection and try again.";
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- step 2
function renderPackages() {
  $("#package-choices").innerHTML = Object.entries(cfg.packages)
    .map(
      ([key, p]) => `<label class="choice"><input type="radio" name="package" value="${key}" ${key === state.package ? "checked" : ""}>
        <span class="card"><strong>${p.name}</strong><span>Up to about ${p.feet} ft</span>
        <span class="price">Install ${money(p.install)}</span></span></label>`
    )
    .join("");
  $$('input[name="package"]').forEach((i) =>
    i.addEventListener("change", () => {
      state.package = i.value;
      renderKitDesc();
      renderSummary();
    })
  );
}

function renderKitDesc() {
  const p = cfg.packages[state.package];
  $("#kit-desc").textContent = `${money(p.kit)} for about ${p.feet} ft of warm white LED. Yours to keep.`;
}

function renderAddons() {
  $("#addons").innerHTML = Object.entries(cfg.addons)
    .map(([key, a]) => {
      const qty = state.addons[key] || 0;
      const each = state.kit ? a.withKit : a.ownLights;
      return `<div class="addon"><div class="meta"><strong>${a.name}</strong><span>${money(each)} ${a.unit}</span></div>
        <div class="stepper" role="group" aria-label="${a.name} quantity">
          <button type="button" data-addon="${key}" data-d="-1" aria-label="Fewer" ${qty ? "" : "disabled"}>−</button>
          <output aria-live="polite">${qty}</output>
          <button type="button" data-addon="${key}" data-d="1" aria-label="More" ${qty >= a.max ? "disabled" : ""}>+</button>
        </div></div>`;
    })
    .join("");
}
$("#addons").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-addon]");
  if (!b) return;
  const key = b.dataset.addon;
  const max = cfg.addons[key].max;
  state.addons[key] = Math.max(0, Math.min(max, (state.addons[key] || 0) + Number(b.dataset.d)));
  renderAddons();
  renderSummary();
  $(`button[data-addon="${key}"][data-d="${b.dataset.d}"]`)?.focus();
});

document.addEventListener("change", (e) => {
  if (e.target.name === "stories") {
    state.stories = Number(e.target.value);
    state.installDate = null;
    state.takedownDate = null;
    renderSummary();
  }
  if (e.target.name === "kit") {
    state.kit = e.target.value === "1";
    renderAddons();
    renderSummary();
  }
  if (e.target.name === "wantTakedown") {
    state.wantTakedown = e.target.value === "1";
    if (!state.wantTakedown) state.takedownDate = null;
    $("#takedown-wrap").hidden = !state.wantTakedown;
    renderSummary();
  }
  if (e.target.name === "installDate") {
    state.installDate = e.target.value;
    renderSummary();
  }
  if (e.target.name === "takedownDate") {
    state.takedownDate = e.target.value;
    renderSummary();
  }
});

$("#next-2").addEventListener("click", async () => {
  show(3);
  await renderDates();
});

// ---------------------------------------------------------------- step 3
async function loadAvailability(stories) {
  avail[stories] = await fetch(`/api/availability?stories=${stories}`).then((r) => r.json());
  return avail[stories];
}

function dateButtons(name, dates, selected, note) {
  if (!dates.length) return "";
  const groups = new Map();
  for (const d of dates) {
    if (!groups.has(d.weekend)) groups.set(d.weekend, []);
    groups.get(d.weekend).push(d);
  }
  return [...groups.entries()]
    .map(
      ([fri, ds]) => `<div class="date-group"><h3>Weekend of ${fmt(fri, { month: "long", day: "numeric" })}</h3><div class="dates">
      ${ds
        .map(
          (d) => `<label class="date"><input type="radio" name="${name}" value="${d.date}" ${d.date === selected ? "checked" : ""}>
          <span>${fmt(d.date)}<small>${note(d)}</small></span></label>`
        )
        .join("")}</div></div>`
    )
    .join("");
}

async function renderDates() {
  const container = $("#install-dates");
  container.innerHTML = `<p class="hint">Loading open dates…</p>`;
  let data;
  try {
    data = await loadAvailability(state.stories);
  } catch {
    container.innerHTML = `<p class="error">We couldn't load dates. Check your connection and try again.</p>`;
    return;
  }
  const lift = state.stories === 2;
  const spots = (d) => (lift ? `${d.left} ${d.left === 1 ? "spot" : "spots"} left` : "Evening");

  $("#install-hint").textContent = lift
    ? "Two-story installs happen during the day on the open Lift Weekend."
    : "Single-story installs happen in the evening, starting around 5:30 pm.";

  const notice = $("#lift-notice");
  const w = data.install.liftWeekend;
  if (lift && w) {
    notice.innerHTML = `<p><strong>Open Lift Weekend: ${fmt(w.friday, { month: "long", day: "numeric" })}.</strong> ${w.booked} of ${w.capacity} homes booked.</p>
      <p>${w.runs ? "This weekend has enough homes and is running." : `It runs once ${cfg.liftMinimum} homes book. We'll confirm by ${long(w.confirmBy)}. If it doesn't run, you can move dates or get a full refund.`}</p>`;
    notice.hidden = false;
  } else notice.hidden = true;

  if (state.installDate && !data.install.dates.some((d) => d.date === state.installDate)) state.installDate = null;
  container.innerHTML =
    dateButtons("installDate", data.install.dates, state.installDate, spots) ||
    `<p class="notice">${lift ? "The current Lift Weekend is full. The next one opens soon, so check back in a few days." : "All install evenings are booked for this season."}</p>`;

  if (state.takedownDate && !data.takedown.dates.some((d) => d.date === state.takedownDate)) state.takedownDate = null;
  $("#takedown-dates").innerHTML =
    dateButtons("takedownDate", data.takedown.dates, state.takedownDate, spots) ||
    `<p class="notice">No takedown dates are open right now.</p>`;
  $("#takedown-wrap").hidden = !state.wantTakedown;
  renderSummary();
}

$("#next-3").addEventListener("click", () => {
  const err = $("#err-3");
  err.textContent = "";
  if (!state.installDate) return (err.textContent = "Choose an install date.");
  if (state.wantTakedown && !state.takedownDate) return (err.textContent = "Choose a takedown date, or choose No.");
  show(4);
});

// ---------------------------------------------------------------- step 4
$("#pay").addEventListener("click", async () => {
  const err = $("#err-4");
  err.textContent = "";
  const body = {
    street: state.street,
    zip: state.zip,
    stories: state.stories,
    package: state.package,
    kit: state.kit,
    addons: state.addons,
    installDate: state.installDate,
    takedownDate: state.wantTakedown ? state.takedownDate : null,
    name: $("#name").value,
    email: $("#email").value,
    phone: $("#phone").value,
    accessNotes: $("#notes").value,
    agree: $("#agree").checked,
  };
  if (!body.name.trim()) return (err.textContent = "Enter your full name.");
  if (!body.email.includes("@")) return (err.textContent = "Enter your email address.");
  if (body.phone.replace(/\D/g, "").length < 10) return (err.textContent = "Enter a mobile number with area code.");
  if (!body.agree) return (err.textContent = "Check the box to agree to the booking terms.");

  const btn = $("#pay");
  btn.disabled = true;
  btn.textContent = "Opening secure checkout…";
  try {
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || "Booking didn't go through. Please try again.";
      if (res.status === 409) {
        show(3);
        await renderDates();
        $("#err-3").textContent = data.error;
      }
      return;
    }
    window.location.href = data.checkoutUrl;
  } catch {
    err.textContent = "Booking didn't go through. Check your connection and try again.";
  } finally {
    btn.disabled = false;
    renderSummary();
  }
});

// ---------------------------------------------------------------- summary
function renderSummary() {
  const q = buildQuote(cfg, {
    package: state.package,
    stories: state.stories,
    kit: state.kit,
    addons: state.addons,
    takedown: state.wantTakedown,
  });
  if (q.error) return;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const installRows = [row(`${q.package.name} install`, money(q.install.labor))];
  q.addonLines.forEach((l) => installRows.push(row(`${l.qty} × ${l.name}`, money(l.total))));
  if (q.install.lift) installRows.push(row("Lift fee", money(q.install.lift)));
  installRows.push(row("<strong>Install total</strong>", `<strong>${money(q.install.total)}</strong>`));

  let td = "";
  if (q.takedown) {
    const rows = [row(`${q.package.name} takedown`, money(q.takedown.labor))];
    if (q.takedown.addons) rows.push(row("Add-on takedown", money(q.takedown.addons)));
    if (q.takedown.lift) rows.push(row("Lift fee", money(q.takedown.lift)));
    rows.push(row("<strong>Takedown total</strong>", `<strong>${money(q.takedown.total)}</strong>`));
    td = `<div class="group"><h3>Takedown${state.takedownDate ? `, ${fmt(state.takedownDate)}` : ""}</h3><dl>${rows.join("")}</dl></div>`;
  }

  const todayRows = [row("Install deposit", money(q.deposits.install))];
  if (q.deposits.takedown) todayRows.push(row("Takedown deposit", money(q.deposits.takedown)));
  if (q.kit) todayRows.push(row(`${q.package.name} light kit`, money(q.kitPrice)));
  if (q.kitTax) todayRows.push(row("Sales tax on kit", money(q.kitTax)));

  const later = [`${money(q.installBalance)} after your install`];
  if (q.takedown) later.push(`${money(q.takedownBalance)} after your takedown`);

  $("#summary").innerHTML = `<h2>Your quote</h2>
    <div class="group"><h3>Install${state.installDate ? `, ${fmt(state.installDate)}` : ""}</h3><dl>${installRows.join("")}</dl></div>
    ${td}
    <div class="group"><h3>Due today</h3><dl>${todayRows.join("")}</dl></div>
    <div class="today"><span>Today</span><strong>${money(q.dueToday)}</strong></div>
    <p class="fine">Then ${later.join(", and ")}.</p>`;
  $("#pay").textContent = `Pay ${money(q.dueToday)} and book`;
}

// ---------------------------------------------------------------- init
async function init() {
  cfg = await fetch("/api/config").then((r) => r.json());
  $("#area-lede").textContent = `We install for ${cfg.serviceArea.description}.`;
  $$("[data-lift-fee]").forEach((el) => (el.textContent = money(cfg.liftFee)));
  $$("[data-dep-takedown]").forEach((el) => (el.textContent = money(cfg.deposits.takedown)));
  renderPackages();
  renderKitDesc();
  renderAddons();
  renderSummary();

  const params = new URLSearchParams(location.search);
  const cancelled = params.get("cancelled");
  if (cancelled) {
    $("#cancel-notice").hidden = false;
    fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cancelled }) });
    history.replaceState(null, "", "/book");
  }
  const a = await loadAvailability(1).catch(() => null);
  if (a && !a.bookingOpen) {
    $("#err-4").textContent = "Online booking opens soon. You can look around, but payments aren't turned on yet.";
  }
  show(1);
}
init();
