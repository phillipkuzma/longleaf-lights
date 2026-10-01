// ---------------------------------------------------------------------------
// Longleaf Lights — business rules
// Every price, date and limit the site uses lives in this one file.
// Prices are whole dollars.
// ---------------------------------------------------------------------------

export const CONFIG = {
  business: {
    name: "Longleaf Lights",
    tagline: "Holiday lighting for St. Johns homes",
    email: "", // shown on the site once set, e.g. "hello@longleaflights.com"
    phone: "", // e.g. "(904) 555-0123"
    timezone: "America/New_York",
  },

  // Who we serve. A ZIP must match. If allowedStreets has entries, the street
  // name must also contain one of them (case-insensitive).
  serviceArea: {
    zips: ["32259"],
    allowedStreets: [],
    description: "homes in St. Johns, FL 32259",
  },

  // Packages are sized by front roofline length.
  packages: {
    cottage: { name: "Cottage", feet: 75, install: 149, kit: 199, takedown: 99 },
    classic: { name: "Classic", feet: 125, install: 249, kit: 349, takedown: 149 },
    grand: { name: "Grand", feet: 175, install: 369, kit: 499, takedown: 229 },
  },

  // Add-ons. withKit = we supply the lights; ownLights = customer's lights.
  addons: {
    shrub: { name: "Shrub or bush", unit: "each", withKit: 35, ownLights: 20, max: 12 },
    tree: { name: "Tree wrap, up to 10 ft", unit: "each", withKit: 95, ownLights: 55, max: 6 },
    column: { name: "Column or post wrap", unit: "each", withKit: 45, ownLights: 25, max: 8 },
    stakes: { name: "Walkway stakes", unit: "per 10 ft", withKit: 45, ownLights: 25, max: 10 },
    wreath: { name: "Wreath hanging", unit: "each", withKit: 20, ownLights: 20, max: 6 },
  },
  takedownAddonFee: 10, // added to the takedown bill per add-on

  // Two-story homes need the lift. Charged on each lift visit.
  liftFee: 150,
  liftMinimum: 5, // a lift weekend runs once this many homes book
  liftConfirmDaysBefore: 10, // we confirm (or cancel) a lift weekend this many days ahead

  deposits: { install: 100, takedown: 50 },

  // Florida sales tax on light kits. Set once confirmed with your accountant
  // (for example 0.065 for 6.5%). 0 means no tax line is shown.
  kitTaxRate: 0,

  // Light kit buyback offered at takedown.
  buyback: { cashPercent: 30, creditPercent: 50 },

  holdMinutes: 32, // how long an unpaid checkout holds a slot
  minLeadDays: 3, // earliest bookable date is this many days out

  // Homes per day. Keys are days of the week: 5 = Fri, 6 = Sat, 0 = Sun.
  capacity: {
    lift: { 5: 1, 6: 3, 0: 3 }, // two-story, daytime with the lift
    evening: { 5: 1, 6: 1, 0: 1 }, // single-story, evenings
  },

  // Each weekend is listed by its Friday.
  seasons: {
    install: {
      label: "Install",
      weekends: ["2026-11-06", "2026-11-13", "2026-11-20", "2026-12-04", "2026-12-11", "2026-12-18"],
    },
    takedown: {
      label: "Takedown",
      weekends: ["2027-01-08", "2027-01-15"],
    },
  },
};

// The subset of config the browser needs to show prices and build quotes.
export function publicConfig() {
  const c = CONFIG;
  return {
    business: c.business,
    serviceArea: { zips: c.serviceArea.zips, description: c.serviceArea.description },
    packages: c.packages,
    addons: c.addons,
    takedownAddonFee: c.takedownAddonFee,
    liftFee: c.liftFee,
    liftMinimum: c.liftMinimum,
    liftConfirmDaysBefore: c.liftConfirmDaysBefore,
    deposits: c.deposits,
    kitTaxRate: c.kitTaxRate,
    buyback: c.buyback,
  };
}
