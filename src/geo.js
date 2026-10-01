import { CONFIG } from "./config.js";

// Looks up an address on a map and checks it against the service area box.

export function inServiceArea(lat, lon) {
  const b = CONFIG.serviceArea.bounds;
  return lat <= b.north && lat >= b.south && lon >= b.west && lon <= b.east;
}

async function census(query) {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
    encodeURIComponent(query);
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  const m = data?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return { lat: Number(m.coordinates.y), lon: Number(m.coordinates.x), source: "census", matched: m.matchedAddress };
}

async function openStreetMap(street, zip) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&street=" +
    encodeURIComponent(street) +
    "&postalcode=" + encodeURIComponent(zip) + "&state=Florida";
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "LongleafLights-Booking/1.0 (holiday light installer, St. Johns FL)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const m = data?.[0];
  if (!m) return null;
  return { lat: Number(m.lat), lon: Number(m.lon), source: "osm", matched: m.display_name };
}

// Returns { lat, lon, source, matched } or null if no map knows the address.
export async function geocode(street, zip) {
  const attempts = [
    () => census(`${street}, Saint Johns, FL ${zip}`),
    () => openStreetMap(street, zip),
  ];
  for (const attempt of attempts) {
    try {
      const r = await attempt();
      if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) return r;
    } catch (err) {
      console.warn("Geocoder failed:", err.message);
    }
  }
  return null;
}
