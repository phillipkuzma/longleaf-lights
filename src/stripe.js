// Minimal Stripe client using fetch (no SDK needed on Workers).

function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join("&");
}

export async function stripe(env, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not set up yet (missing STRIPE_SECRET_KEY).");
  const base = env.STRIPE_API_BASE || "https://api.stripe.com";
  const res = await fetch(`${base}/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encode(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

// Verifies the Stripe-Signature header. Returns the parsed event or null.
export async function verifyWebhook(env, request) {
  const raw = await request.text();
  const header = request.headers.get("Stripe-Signature") || "";
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return null;

  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=")).filter((p) => p.length === 2)
  );
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  const t = parts.t;
  if (!t || !signatures.length) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!signatures.some((s) => timingSafeEqual(s, expected))) return null;
  return JSON.parse(raw);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
