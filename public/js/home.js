import { money } from "./pricing.js";

document.querySelector(".hero-art")?.classList.add("lit");

const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => (el.textContent = text));
const fmtDate = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

function table(el, head, rows) {
  el.innerHTML =
    `<thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

async function loadPrices() {
  const cfg = await (await fetch("/api/config")).json();
  const pk = Object.values(cfg.packages);
  const label = (p) => `${p.name}<small>Up to about ${p.feet} ft of roofline</small>`;

  table(document.getElementById("t-install"), ["Package", "Price"], pk.map((p) => [label(p), money(p.install)]));
  table(document.getElementById("t-takedown"), ["Package", "Price"], pk.map((p) => [label(p), money(p.takedown)]));
  table(document.getElementById("t-kits"), ["Kit", "Price"], pk.map((p) => [`${p.name} kit<small>About ${p.feet} ft</small>`, money(p.kit)]));
  table(
    document.getElementById("t-addons"),
    ["Add-on", "Our lights", "Your lights"],
    Object.values(cfg.addons).map((a) => [`${a.name}<small>${a.unit}</small>`, money(a.withKit), money(a.ownLights)])
  );

  set("[data-from-price]", money(Math.min(...pk.map((p) => p.install))));
  set("[data-td-addon]", money(cfg.takedownAddonFee));
  set("[data-dep-install]", money(cfg.deposits.install));
  set("[data-dep-takedown]", money(cfg.deposits.takedown));
  set("[data-lift-fee]", money(cfg.liftFee));
  set("[data-lift-min]", String(cfg.liftMinimum));
  set("[data-lift-days]", String(cfg.liftConfirmDaysBefore));
  set("[data-bb-cash]", `${cfg.buyback.cashPercent}%`);
  set("[data-bb-credit]", `${cfg.buyback.creditPercent}%`);

  const contact = [cfg.business.phone && `<a href="tel:${cfg.business.phone}">${cfg.business.phone}</a>`,
    cfg.business.email && `<a href="mailto:${cfg.business.email}">${cfg.business.email}</a>`].filter(Boolean);
  document.getElementById("contact-line").innerHTML = contact.join(" · ");
}

async function loadLiftMeter() {
  const data = await (await fetch("/api/availability?stories=2")).json();
  const w = data.install?.liftWeekend;
  if (!w) return;
  const meter = document.getElementById("lift-meter");
  const friday = fmtDate(w.friday);
  document.getElementById("lift-meter-title").textContent = `Open now: the weekend of ${friday}`;
  document.getElementById("lift-meter-track").innerHTML = Array.from(
    { length: w.capacity },
    (_, i) => `<span class="${i < w.booked ? "on" : ""}"></span>`
  ).join("");
  document.getElementById("lift-meter-note").textContent =
    `${w.booked} of ${w.capacity} homes booked` + (w.runs ? ". This weekend is running." : `. Confirmed by ${fmtDate(w.confirmBy)}.`);
  meter.hidden = false;
}

loadPrices().catch(console.error);
loadLiftMeter().catch(console.error);
