import { CONFIG, publicConfig } from "./config.js";
import { buildQuote } from "../public/js/pricing.js";
import { buildSeason, availableDates, isBookable, kindForStories, capacityFor } from "./schedule.js";
import { ensureSchema, slotCounts, getSettings, emptySettings, ACTIVE } from "./db.js";
import { stripe, verifyWebhook } from "./stripe.js";
import { handleAdmin } from "./admin.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/admin" || path.startsWith("/admin/")) return await handleAdmin(request, env);
      if (path === "/api/config") return json(publicConfig());
      if (path === "/api/check-address" && request.method === "POST") return await checkAddressRoute(request);
      if (path === "/api/availability") return await availabilityRoute(url, env);
      if (path === "/api/book" && request.method === "POST") return await bookRoute(request, env, url);
      if (path === "/api/release" && request.method === "POST") return await releaseRoute(request, env);
      if (path === "/api/booking") return await bookingStatusRoute(url, env);
      if (path === "/api/stripe/webhook" && request.method === "POST") return await webhookRoute(request, env);
      if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: err.message || "Something went wrong. Please try again." }, 500);
    }
  },
};

// ---------------------------------------------------------------------------

export function checkAddress(street, zip) {
  const z = String(zip || "").trim().slice(0, 5);
  const s = String(street || "").trim();
  if (s.length < 5) return { ok: false, reason: "Enter your street address." };
  if (!/^\d{5}$/.test(z)) return { ok: false, reason: "Enter a 5-digit ZIP code." };
  if (!CONFIG.serviceArea.zips.includes(z)) {
    return { ok: false, reason: `We currently install for ${CONFIG.serviceArea.description}. Your ZIP is outside our area.` };
  }
  const streets = CONFIG.serviceArea.allowedStreets;
  if (streets.length && !streets.some((st) => s.toLowerCase().includes(st.toLowerCase()))) {
    return { ok: false, reason: "Your street is outside our current service area." };
  }
  return { ok: true };
}

async function checkAddressRoute(request) {
  const body = await request.json().catch(() => ({}));
  return json(checkAddress(body.street, body.zip));
}

async function loadSchedule(env) {
  if (!env.DB) return { counts: new Map(), settings: emptySettings(), hasDb: false };
  await ensureSchema(env.DB);
  const [counts, settings] = await Promise.all([slotCounts(env.DB), getSettings(env.DB)]);
  return { counts, settings, hasDb: true };
}

async function availabilityRoute(url, env) {
  const stories = url.searchParams.get("stories") === "2" ? 2 : 1;
  const kind = kindForStories(stories);
  const { counts, settings, hasDb } = await loadSchedule(env);
  const install = buildSeason("install", counts, settings);
  const takedown = buildSeason("takedown", counts, settings);
  const summarize = (s) => {
    const openWeekend = s.weekends.find((w) => w.liftOpen);
    return {
      dates: availableDates(s, kind),
      liftWeekend: openWeekend
        ? {
            friday: openWeekend.friday,
            booked: openWeekend.liftBooked,
            capacity: openWeekend.liftCapacity,
            runs: openWeekend.liftRuns,
            confirmBy: openWeekend.liftConfirmBy,
          }
        : null,
    };
  };
  return json({ kind, bookingOpen: hasDb, install: summarize(install), takedown: summarize(takedown) });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function bookRoute(request, env, url) {
  if (!env.DB) return json({ error: "Online booking opens soon. Please check back shortly." }, 503);
  const b = await request.json().catch(() => ({}));

  const name = String(b.name || "").trim().slice(0, 100);
  const email = String(b.email || "").trim().slice(0, 200);
  const phone = String(b.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  const street = String(b.street || "").trim().slice(0, 200);
  const zip = String(b.zip || "").trim().slice(0, 5);
  const notes = String(b.accessNotes || "").trim().slice(0, 500);

  if (!name) return json({ error: "Enter your name." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (phone.replace(/\D/g, "").length < 10) return json({ error: "Enter a phone number with area code." }, 400);
  const addr = checkAddress(street, zip);
  if (!addr.ok) return json({ error: addr.reason }, 400);
  if (b.agree !== true) return json({ error: "Please agree to the booking terms." }, 400);

  const stories = b.stories === 2 ? 2 : 1;
  const kind = kindForStories(stories);
  const quote = buildQuote(CONFIG, {
    package: b.package,
    stories,
    kit: b.kit,
    addons: b.addons || {},
    takedown: Boolean(b.takedownDate),
  });
  if (quote.error) return json({ error: quote.error }, 400);

  const { counts, settings } = await loadSchedule(env);
  const installSeason = buildSeason("install", counts, settings);
  if (!isBookable(installSeason, kind, b.installDate)) {
    return json({ error: "That install date is no longer available. Please pick another." }, 409);
  }
  const takedownDate = b.takedownDate || null;
  if (takedownDate) {
    const tdSeason = buildSeason("takedown", counts, settings);
    if (!isBookable(tdSeason, kind, takedownDate)) {
      return json({ error: "That takedown date is no longer available. Please pick another." }, 409);
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const holdExpires = now + CONFIG.holdMinutes * 60 * 1000;
  const dueTodayCents = Math.round(quote.dueToday * 100);
  const installCap = capacityFor(kind, b.installDate);
  const takedownCap = takedownDate ? capacityFor(kind, takedownDate) : 0;

  // Insert only if the slots still have room. D1 runs this as one statement,
  // so two people can't grab the last spot at the same moment.
  const result = await env.DB.prepare(
    `INSERT INTO bookings (
      id, created_at, status, hold_expires, name, email, phone, address, zip, access_notes,
      stories, package, kit, addons, install_date, install_kind, takedown_date, takedown_kind,
      install_total, takedown_total, kit_total, kit_tax_cents, due_today_cents, takedown_status
    )
    SELECT ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM bookings WHERE install_date = ? AND install_kind = ? AND ${ACTIVE}) < ?
      AND (? IS NULL OR (SELECT COUNT(*) FROM bookings WHERE takedown_date = ? AND takedown_kind = ? AND ${ACTIVE}) < ?)`
  )
    .bind(
      id, now, holdExpires, name, email, phone, street, zip, notes,
      stories, b.package, quote.kit ? 1 : 0, JSON.stringify(Object.fromEntries(quote.addonLines.map((l) => [l.key, l.qty]))),
      b.installDate, kind, takedownDate, takedownDate ? kind : null,
      quote.install.total, quote.takedown ? quote.takedown.total : null, quote.kitPrice,
      Math.round(quote.kitTax * 100), dueTodayCents, takedownDate ? "scheduled" : null,
      b.installDate, kind, now, installCap,
      takedownDate, takedownDate, kind, now, takedownCap
    )
    .run();

  if (!result.meta || result.meta.changes !== 1) {
    return json({ error: "That date just filled up. Please pick another." }, 409);
  }

  const origin = env.SITE_URL || url.origin;
  const pretty = (d) =>
    new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  const lineItems = [];
  const item = (name, amount, description) =>
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: Math.round(amount * 100),
        product_data: description ? { name, description } : { name },
      },
      quantity: 1,
    });

  item(`Install deposit, ${pretty(b.installDate)}`, CONFIG.deposits.install, "Holds your install date. Non-refundable. Applied to your install bill.");
  if (takedownDate) {
    item(`Takedown deposit, ${pretty(takedownDate)}`, CONFIG.deposits.takedown, "Holds your takedown date. Non-refundable. Applied to your takedown bill.");
  }
  if (quote.kit) item(`${quote.package.name} light kit (about ${quote.package.feet} ft)`, quote.kitPrice, "Commercial-grade LED lights. Yours to keep.");
  if (quote.kitTax > 0) item("Sales tax on light kit", quote.kitTax);

  let session;
  try {
    session = await stripe(env, "checkout/sessions", {
      mode: "payment",
      customer_email: email,
      client_reference_id: id,
      success_url: `${origin}/booked?id=${id}`,
      cancel_url: `${origin}/book?cancelled=${id}`,
      expires_at: Math.floor(now / 1000) + 31 * 60,
      metadata: { kind: "booking", booking_id: id },
      payment_intent_data: { description: `Longleaf Lights booking ${id.slice(0, 8)}`, metadata: { booking_id: id } },
      custom_text: {
        submit: { message: "Deposits are non-refundable. If a two-story lift weekend doesn't reach its minimum, you can move dates or get a full refund." },
      },
      line_items: Object.fromEntries(lineItems.map((li, i) => [i, li])),
    });
  } catch (err) {
    await env.DB.prepare(`UPDATE bookings SET status = 'failed' WHERE id = ?`).bind(id).run();
    throw err;
  }

  await env.DB.prepare(`UPDATE bookings SET stripe_session = ? WHERE id = ?`).bind(session.id, id).run();
  return json({ checkoutUrl: session.url, id });
}

async function releaseRoute(request, env) {
  if (!env.DB) return json({ ok: true });
  const { id } = await request.json().catch(() => ({}));
  if (id) {
    await env.DB.prepare(`UPDATE bookings SET status = 'abandoned' WHERE id = ? AND status = 'pending'`).bind(String(id)).run();
  }
  return json({ ok: true });
}

async function bookingStatusRoute(url, env) {
  if (!env.DB) return json({ error: "Not found" }, 404);
  await ensureSchema(env.DB);
  const id = url.searchParams.get("id") || "";
  const r = await env.DB.prepare(
    `SELECT status, name, stories, package, kit, install_date, takedown_date, install_total, takedown_total,
            kit_total, paid_today_cents, due_today_cents FROM bookings WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!r) return json({ error: "Booking not found." }, 404);
  return json({
    status: r.status,
    firstName: (r.name || "").split(" ")[0],
    stories: r.stories,
    package: CONFIG.packages[r.package]?.name || r.package,
    kit: Boolean(r.kit),
    installDate: r.install_date,
    takedownDate: r.takedown_date,
    installTotal: r.install_total,
    takedownTotal: r.takedown_total,
    paidToday: (r.paid_today_cents || 0) / 100,
    deposits: CONFIG.deposits,
  });
}

async function webhookRoute(request, env) {
  const event = await verifyWebhook(env, request);
  if (!event) return json({ error: "Invalid signature" }, 400);
  if (!env.DB) return json({ received: true });
  await ensureSchema(env.DB);

  const s = event.data?.object || {};
  if (event.type === "checkout.session.completed") {
    if (s.metadata?.kind === "booking" && s.metadata.booking_id) {
      await env.DB.prepare(
        `UPDATE bookings SET status = 'confirmed', paid_today_cents = ?, stripe_session = ?
         WHERE id = ? AND status IN ('pending', 'expired', 'abandoned')`
      )
        .bind(s.amount_total || 0, s.id, s.metadata.booking_id)
        .run();
    } else if (s.payment_link) {
      await env.DB.prepare(`UPDATE bookings SET install_paid = 1 WHERE install_link_id = ?`).bind(s.payment_link).run();
      await env.DB.prepare(`UPDATE bookings SET takedown_paid = 1 WHERE takedown_link_id = ?`).bind(s.payment_link).run();
    }
  } else if (event.type === "checkout.session.expired" && s.metadata?.booking_id) {
    await env.DB.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'pending'`)
      .bind(s.metadata.booking_id)
      .run();
  }
  return json({ received: true });
}
