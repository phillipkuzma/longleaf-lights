import { CONFIG } from "./config.js";
import { buildSeason } from "./schedule.js";
import { ensureSchema, slotCounts, getSettings, saveSetSetting } from "./db.js";
import { stripe } from "./stripe.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (iso) =>
  iso
    ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    : "";
const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

function unauthorized() {
  return new Response("Sign in required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Longleaf Lights admin", charset="UTF-8"' },
  });
}

function authorized(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  return pass.length > 0 && pass === env.ADMIN_PASSWORD;
}

const page = (body) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Admin · Longleaf Lights</title>
<link rel="stylesheet" href="/admin.css"></head><body>${body}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

export async function handleAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return page(`<main class="wrap"><h1>Admin isn't set up yet</h1>
      <p>Add a secret named <code>ADMIN_PASSWORD</code> to this Worker in the Cloudflare dashboard (Settings, then Variables and Secrets), then reload.</p></main>`);
  }
  if (!authorized(request, env)) return unauthorized();
  if (!env.DB) {
    return page(`<main class="wrap"><h1>Database not connected</h1>
      <p>The bookings database isn't connected to this Worker yet. Once it is, bookings will show up here.</p></main>`);
  }
  await ensureSchema(env.DB);

  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/admin/action") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return new Response("Bad origin", { status: 403 });
    const form = await request.formData();
    const flash = await runAction(env, form, url);
    const to = new URL("/admin", url.origin);
    if (flash) to.searchParams.set("msg", flash);
    if (form.get("anchor")) to.hash = form.get("anchor");
    return Response.redirect(to.toString(), 303);
  }
  return renderDashboard(env, url);
}

async function runAction(env, form, url) {
  const action = form.get("action");
  const id = form.get("id");
  const db = env.DB;
  const settings = await getSettings(db);

  switch (action) {
    case "toggle-weekend": {
      const key = form.get("key");
      settings.closedWeekends.has(key) ? settings.closedWeekends.delete(key) : settings.closedWeekends.add(key);
      await saveSetSetting(db, "closedWeekends", settings.closedWeekends);
      return "Lift weekend updated.";
    }
    case "toggle-slot": {
      const key = form.get("key");
      settings.blocked.has(key) ? settings.blocked.delete(key) : settings.blocked.add(key);
      await saveSetSetting(db, "blocked", settings.blocked);
      return "Slot updated.";
    }
    case "install-done":
      await db.prepare(`UPDATE bookings SET install_status = 'done' WHERE id = ?`).bind(id).run();
      return "Install marked done.";
    case "takedown-done":
      await db.prepare(`UPDATE bookings SET takedown_status = 'done' WHERE id = ?`).bind(id).run();
      return "Takedown marked done.";
    case "cancel":
      await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(id).run();
      return "Booking cancelled. Its dates are open again. Refund the deposit in Stripe if you're the one cancelling.";
    case "save-notes":
      await db.prepare(`UPDATE bookings SET admin_notes = ? WHERE id = ?`).bind(String(form.get("notes") || "").slice(0, 1000), id).run();
      return "Notes saved.";
    case "balance-link": {
      const visit = form.get("visit") === "takedown" ? "takedown" : "install";
      const b = await db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
      if (!b) return "Booking not found.";
      const total = visit === "install" ? b.install_total : b.takedown_total;
      const deposit = CONFIG.deposits[visit];
      const amount = Math.max(0, (total || 0) - deposit);
      if (!amount) return "Nothing left to bill for that visit.";
      const label = visit === "install" ? "Install balance" : "Takedown balance";
      const price = await stripe(env, "prices", {
        currency: "usd",
        unit_amount: Math.round(amount * 100),
        product_data: { name: `Longleaf Lights ${label.toLowerCase()} for ${b.address}` },
      });
      const link = await stripe(env, "payment_links", {
        line_items: { 0: { price: price.id, quantity: 1 } },
        metadata: { booking_id: id, visit },
        payment_intent_data: { metadata: { booking_id: id, visit } },
        restrictions: { completed_sessions: { limit: 1 } },
        after_completion: {
          type: "hosted_confirmation",
          hosted_confirmation: { custom_message: "Thank you! Your balance is paid. Happy holidays from Longleaf Lights." },
        },
      });
      await db
        .prepare(`UPDATE bookings SET ${visit}_link = ?, ${visit}_link_id = ? WHERE id = ?`)
        .bind(link.url, link.id, id)
        .run();
      return `${label} link created. Copy it from the booking and text it to the customer.`;
    }
    case "mark-paid": {
      const visit = form.get("visit") === "takedown" ? "takedown" : "install";
      await db.prepare(`UPDATE bookings SET ${visit}_paid = 1 WHERE id = ?`).bind(id).run();
      return "Marked as paid.";
    }
  }
  return "";
}

function actionForm(fields, label, cls = "") {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<form method="post" action="/admin/action" class="inline">${inputs}<button class="${cls}">${esc(label)}</button></form>`;
}

async function renderDashboard(env, url) {
  const db = env.DB;
  const [counts, settings] = await Promise.all([slotCounts(db), getSettings(db)]);
  const seasons = ["install", "takedown"].map((s) => buildSeason(s, counts, settings));
  const msg = url.searchParams.get("msg");

  const bookings = (
    await db
      .prepare(`SELECT * FROM bookings WHERE status = 'confirmed' ORDER BY install_date, install_kind DESC, created_at`)
      .all()
  ).results;
  const recentOther = (
    await db
      .prepare(`SELECT id, name, status, install_date, created_at, phone, email FROM bookings WHERE status != 'confirmed' ORDER BY created_at DESC LIMIT 15`)
      .all()
  ).results;

  const totalDeposits = bookings.reduce((s, b) => s + (b.paid_today_cents || 0), 0) / 100;

  const seasonHtml = seasons
    .map((s) => {
      const rows = s.weekends
        .map((w) => {
          const key = `${s.season}:${w.friday}`;
          let status;
          if (w.closed) status = `<span class="tag closed">Closed</span>`;
          else if (w.liftFull) status = `<span class="tag ok">Full</span>`;
          else if (w.liftOpen) status = `<span class="tag open">Open now</span>`;
          else if (w.past) status = `<span class="tag">Past</span>`;
          else status = `<span class="tag">Waiting its turn</span>`;
          const runs = w.liftRuns
            ? `<span class="good">Runs</span>`
            : w.liftBooked
              ? `Needs ${CONFIG.liftMinimum - w.liftBooked} more`
              : "";
          const days = w.days
            .map((d) => {
              const cell = (slot, label) => {
                const k = `${d.date}|${slot.kind}`;
                return `<div class="slot ${slot.blocked ? "blocked" : ""}">
                  <span>${label} ${slot.used}/${slot.cap}</span>
                  ${actionForm({ action: "toggle-slot", key: k, anchor: s.season }, slot.blocked ? "Unblock" : "Block", "tiny")}
                </div>`;
              };
              return `<div class="day"><strong>${DOW[d.dow]} ${fmt(d.date).split(", ")[1]}</strong>
                ${cell(d.lift, "Lift")}${cell(d.evening, "Evening")}</div>`;
            })
            .join("");
          return `<tr>
            <td><strong>${fmt(w.friday).split(", ")[1]}</strong> weekend<div class="muted">Confirm by ${fmt(w.liftConfirmBy)}</div></td>
            <td>${status}<div>${w.liftBooked}/${w.liftCapacity} two-story ${runs ? "· " + runs : ""}</div>
              ${actionForm({ action: "toggle-weekend", key, anchor: s.season }, w.closed ? "Reopen lift weekend" : "Close lift weekend", "small")}</td>
            <td><div class="days">${days}</div></td>
          </tr>`;
        })
        .join("");
      return `<section id="${s.season}"><h2>${s.label} weekends</h2>
        <div class="scroll"><table><thead><tr><th>Weekend</th><th>Lift</th><th>Slots</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    })
    .join("");

  const bookingHtml = bookings.length
    ? bookings
        .map((b) => {
          const addons = Object.entries(JSON.parse(b.addons || "{}"))
            .map(([k, q]) => `${q} × ${CONFIG.addons[k]?.name || k}`)
            .join(", ");
          const visit = (v) => {
            const date = b[`${v}_date`];
            if (!date) return `<div class="visit muted">No ${v} booked</div>`;
            const status = b[`${v}_status`];
            const total = b[`${v}_total`];
            const paid = b[`${v}_paid`];
            const link = b[`${v}_link`];
            const balance = Math.max(0, total - CONFIG.deposits[v]);
            const controls = [];
            if (status !== "done") controls.push(actionForm({ action: `${v}-done`, id: b.id, anchor: "b-" + b.id }, `Mark ${v} done`, "small"));
            if (!paid && balance > 0 && !link) controls.push(actionForm({ action: "balance-link", visit: v, id: b.id, anchor: "b-" + b.id }, "Create balance link", "small"));
            if (!paid && balance > 0) controls.push(actionForm({ action: "mark-paid", visit: v, id: b.id, anchor: "b-" + b.id }, "Paid another way", "small ghost"));
            return `<div class="visit">
              <div><strong>${v === "install" ? "Install" : "Takedown"}:</strong> ${fmt(date)} (${b[`${v}_kind`] === "lift" ? "lift, daytime" : "evening"})
                ${status === "done" ? `<span class="tag ok">Done</span>` : ""}
                ${paid ? `<span class="tag ok">Paid</span>` : ""}</div>
              <div class="muted">Total ${usd(total)} · deposit ${usd(CONFIG.deposits[v])} · balance ${usd(balance)}</div>
              ${link && !paid ? `<div class="link"><input readonly value="${esc(link)}" onclick="this.select()"></div>` : ""}
              <div class="controls">${controls.join("")}</div>
            </div>`;
          };
          return `<article class="booking" id="b-${esc(b.id)}">
            <header><h3>${esc(b.name)}</h3><span class="muted">${b.stories === 2 ? "Two-story" : "Single-story"} · ${esc(CONFIG.packages[b.package]?.name || b.package)} · ${b.kit ? "Bought kit" : "Own lights"}</span></header>
            <p><a href="https://maps.google.com/?q=${encodeURIComponent(b.address + " " + b.zip)}" target="_blank" rel="noopener">${esc(b.address)}, ${esc(b.zip)}</a><br>
            <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a> · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>
            ${b.address_verified ? "" : `<p class="note"><strong>Address not verified.</strong> No map database could find it. Check the map link to confirm it's in your area, and refund the deposit in Stripe if it isn't.</p>`}
            ${addons ? `<p class="muted">Add-ons: ${esc(addons)}</p>` : ""}
            ${b.access_notes ? `<p class="note">Access: ${esc(b.access_notes)}</p>` : ""}
            <p class="muted">Paid at booking: ${usd((b.paid_today_cents || 0) / 100)}${b.kit_total ? ` (includes ${usd(b.kit_total)} kit)` : ""}</p>
            ${visit("install")}${visit("takedown")}
            <form method="post" action="/admin/action" class="notes">
              <input type="hidden" name="action" value="save-notes"><input type="hidden" name="id" value="${esc(b.id)}">
              <input type="hidden" name="anchor" value="b-${esc(b.id)}">
              <textarea name="notes" rows="2" placeholder="Private notes">${esc(b.admin_notes)}</textarea>
              <button class="small">Save notes</button>
            </form>
            <div class="controls">${actionForm({ action: "cancel", id: b.id }, "Cancel booking", "small danger")}</div>
          </article>`;
        })
        .join("")
    : `<p class="empty">No bookings yet. Share your site link and they'll show up here.</p>`;

  const otherHtml = recentOther.length
    ? `<details><summary>Unfinished and cancelled (${recentOther.length})</summary><ul class="plain">${recentOther
        .map((r) => `<li><strong>${esc(r.name)}</strong> · ${esc(r.status)} · ${fmt(r.install_date)} · ${esc(r.phone)} · ${esc(r.email)}</li>`)
        .join("")}</ul><p class="muted">"Abandoned" and "expired" mean someone started booking but didn't pay. Their dates were released.</p></details>`
    : "";

  return page(`<main class="wrap">
    <header class="top"><h1>Longleaf Lights admin</h1><a href="/" class="muted">View site</a></header>
    ${msg ? `<p class="flash">${esc(msg)}</p>` : ""}
    <p class="stats"><strong>${bookings.length}</strong> confirmed bookings · <strong>${usd(totalDeposits)}</strong> collected at booking</p>
    <section><h2>Bookings</h2>${bookingHtml}${otherHtml}</section>
    ${seasonHtml}
  </main>`);
}
