// Shared quote math. Used by the booking page and re-checked by the Worker,
// so the price a customer sees is always the price they're charged.
// All results are whole dollars except tax, which is rounded to cents.

export function buildQuote(cfg, sel) {
  const pkg = cfg.packages[sel.package];
  if (!pkg) return { error: "Choose a package." };
  const stories = sel.stories === 2 ? 2 : 1;
  const kit = Boolean(sel.kit);
  const lift = stories === 2 ? cfg.liftFee : 0;

  const addonLines = [];
  let addonCount = 0;
  for (const [key, def] of Object.entries(cfg.addons)) {
    const qty = Math.max(0, Math.min(def.max, parseInt(sel.addons?.[key] ?? 0, 10) || 0));
    if (!qty) continue;
    const each = kit ? def.withKit : def.ownLights;
    addonLines.push({ key, name: def.name, unit: def.unit, qty, each, total: qty * each });
    addonCount += qty;
  }
  const addonTotal = addonLines.reduce((s, l) => s + l.total, 0);

  const install = {
    labor: pkg.install,
    addons: addonTotal,
    lift,
    total: pkg.install + addonTotal + lift,
  };

  const kitPrice = kit ? pkg.kit : 0;
  const kitTax = Math.round(kitPrice * (cfg.kitTaxRate || 0) * 100) / 100;

  const wantsTakedown = Boolean(sel.takedown);
  const takedown = wantsTakedown
    ? {
        labor: pkg.takedown,
        addons: addonCount * cfg.takedownAddonFee,
        lift,
        total: pkg.takedown + addonCount * cfg.takedownAddonFee + lift,
      }
    : null;

  const dueToday =
    cfg.deposits.install + kitPrice + kitTax + (wantsTakedown ? cfg.deposits.takedown : 0);

  return {
    package: { key: sel.package, ...pkg },
    stories,
    kit,
    addonLines,
    addonCount,
    install,
    kitPrice,
    kitTax,
    takedown,
    deposits: {
      install: cfg.deposits.install,
      takedown: wantsTakedown ? cfg.deposits.takedown : 0,
    },
    dueToday,
    installBalance: install.total - cfg.deposits.install,
    takedownBalance: takedown ? takedown.total - cfg.deposits.takedown : 0,
  };
}

export function money(n) {
  const cents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
