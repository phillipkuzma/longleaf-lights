import { money } from "./pricing.js";

const el = document.getElementById("confirm");
const id = new URLSearchParams(location.search).get("id");
const long = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

function render(b) {
  const lift = b.stories === 2;
  const when = lift ? "daytime, Lift Weekend" : "evening, starting around 5:30 pm";
  el.innerHTML = `<img class="mark" src="/images/logo.svg" alt="">
    <h1>You're booked, ${b.firstName || "neighbor"}</h1>
    <p>Your dates are held. Stripe has emailed your receipt.</p>
    <dl>
      <dt>Package</dt><dd>${b.package}, ${lift ? "two-story" : "single-story"}, ${b.kit ? "with a light kit" : "your lights"}</dd>
      <dt>Install</dt><dd>${long(b.installDate)} (${when})</dd>
      ${b.takedownDate ? `<dt>Takedown</dt><dd>${long(b.takedownDate)}</dd>` : ""}
      <dt>Paid today</dt><dd>${money(b.paidToday)}</dd>
      <dt>Due after install</dt><dd>${money(b.installTotal - b.deposits.install)}</dd>
      ${b.takedownDate ? `<dt>Due after takedown</dt><dd>${money(b.takedownTotal - b.deposits.takedown)}</dd>` : ""}
    </dl>
    ${lift ? `<p>Two-story Lift Weekends run once enough homes book. We'll text you to confirm, and if your weekend doesn't run, you can move dates or get a full refund.</p>` : ""}
    <p>Before your install, make sure we can reach an outdoor outlet. We'll text you the day before.</p>
    <a class="btn btn-pine" href="/">Back to home</a>`;
}

async function poll(tries = 0) {
  if (!id) {
    el.innerHTML = `<h1>We couldn't find that booking</h1><p>If you were charged, check your email for a Stripe receipt and contact us.</p>`;
    return;
  }
  const res = await fetch(`/api/booking?id=${encodeURIComponent(id)}`);
  const b = res.ok ? await res.json() : null;
  if (b && b.status === "confirmed") return render(b);
  if (tries < 15) return setTimeout(() => poll(tries + 1), 2000);
  el.innerHTML = `<h1>Payment received, still confirming</h1>
    <p>Your payment is processing. You'll get a Stripe receipt by email, and we'll confirm your dates by text. Refresh this page in a minute to check again.</p>`;
}
poll();
