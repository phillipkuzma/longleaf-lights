# Longleaf Lights

Booking site for Longleaf Lights, Christmas light installation in St. Johns, FL.
It runs as a single Cloudflare Worker: the pages, the price quotes, the booking
calendar, Stripe deposits, and a private admin page.

## What's where

| Path | What it does |
|---|---|
| `src/config.js` | Every price, deposit, date, and daily limit. Change business rules here. |
| `public/js/pricing.js` | Quote math, shared by the booking page and the Worker |
| `src/schedule.js` | Weekends, daily capacity, one-Lift-Weekend-at-a-time rule |
| `src/index.js` | API: address check, availability, booking, Stripe webhook |
| `src/admin.js` | Admin page at `/admin` |
| `public/` | Home page, booking page, confirmation page, graphics |

## How booking works

- Single-story homes book an evening slot (Fri, Sat, Sun, one per evening).
- Two-story homes book a daytime slot in the open Lift Weekend
  (Fri 1, Sat 3, Sun 3). Only the earliest unfilled Lift Weekend is open.
  It runs once `liftMinimum` homes book.
- Checkout charges the install deposit, the takedown deposit (if booked),
  and the light kit (if bought). An unpaid checkout holds the slot for about 30 minutes.
- After each visit, the admin page creates a Stripe payment link for that
  visit's balance, to text to the customer.

## Setup (all in the browser)

1. **Cloudflare:** Workers & Pages, then Create, then Import a repository.
   Pick this repo. Leave the build settings as they are and deploy.
2. **Database:** Storage & Databases, then D1, then Create, named `longleaf-lights`.
   Then in the Worker: Settings, then Bindings, then Add, then D1 database,
   with variable name `DB`. Tables are created automatically.
3. **Secrets** (Worker, then Settings, then Variables and Secrets, type Secret):
   - `ADMIN_PASSWORD`: password for `/admin`
   - `STRIPE_SECRET_KEY`: from Stripe, Developers, then API keys
   - `STRIPE_WEBHOOK_SECRET`: from the webhook in step 4
4. **Stripe webhook:** Stripe, Developers, then Webhooks, then Add endpoint.
   URL: `https://YOUR-SITE/api/stripe/webhook`.
   Events: `checkout.session.completed` and `checkout.session.expired`.
5. **Custom domain (later):** Worker, then Settings, then Domains & Routes,
   then Add, then Custom Domain. Then add a variable `SITE_URL`
   set to the full domain, such as `https://longleaflights.com`.
