// D1 database helpers. Tables are created automatically on first use,
// so there is no separate migration step to run.

let schemaReady = false;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    hold_expires INTEGER,
    name TEXT, email TEXT, phone TEXT,
    address TEXT, zip TEXT, access_notes TEXT,
    stories INTEGER, package TEXT, kit INTEGER, addons TEXT,
    install_date TEXT, install_kind TEXT,
    takedown_date TEXT, takedown_kind TEXT,
    install_total INTEGER, takedown_total INTEGER,
    kit_total INTEGER, kit_tax_cents INTEGER,
    due_today_cents INTEGER, paid_today_cents INTEGER DEFAULT 0,
    install_status TEXT DEFAULT 'scheduled',
    takedown_status TEXT,
    install_link TEXT, install_link_id TEXT, install_paid INTEGER DEFAULT 0,
    takedown_link TEXT, takedown_link_id TEXT, takedown_paid INTEGER DEFAULT 0,
    stripe_session TEXT,
    admin_notes TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_install ON bookings (install_date, install_kind)`,
  `CREATE INDEX IF NOT EXISTS idx_takedown ON bookings (takedown_date, takedown_kind)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];

export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

// A booking holds its slots while confirmed, or while an unpaid checkout is open.
export const ACTIVE = `(status = 'confirmed' OR (status = 'pending' AND hold_expires > ?))`;

export async function slotCounts(db) {
  const now = Date.now();
  const counts = new Map();
  const add = (rows) => {
    for (const r of rows) counts.set(`${r.d}|${r.k}`, (counts.get(`${r.d}|${r.k}`) || 0) + r.n);
  };
  const a = await db
    .prepare(`SELECT install_date d, install_kind k, COUNT(*) n FROM bookings WHERE ${ACTIVE} AND install_status != 'cancelled' GROUP BY d, k`)
    .bind(now)
    .all();
  const b = await db
    .prepare(`SELECT takedown_date d, takedown_kind k, COUNT(*) n FROM bookings WHERE takedown_date IS NOT NULL AND ${ACTIVE} AND COALESCE(takedown_status,'') != 'cancelled' GROUP BY d, k`)
    .bind(now)
    .all();
  add(a.results);
  add(b.results);
  return counts;
}

export async function getSettings(db) {
  const rows = (await db.prepare(`SELECT key, value FROM settings`).all()).results;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parse = (v) => {
    try { return JSON.parse(v || "[]"); } catch { return []; }
  };
  return {
    closedWeekends: new Set(parse(map.closedWeekends)),
    blocked: new Set(parse(map.blocked)),
  };
}

export async function saveSetSetting(db, key, set) {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, JSON.stringify([...set]))
    .run();
}

export const emptySettings = () => ({ closedWeekends: new Set(), blocked: new Set() });
