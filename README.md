# Moovin

Find where to live, by commute — not by vibes.

Moovin is a Google-Maps-style site that draws coloured travel-time bands (like isochrones) around a destination — currently Sydney CBD by default, or any point you pick — showing how far you can live away and still keep your public-transport commute under a time budget you choose.

![Moovin screenshot](screenshots/moovin.png)

## Why

Built while house-hunting for a move to Sydney: existing suburb/rent tools show distance, not actual public-transport travel time. A suburb 5 km from the city can be a 12-minute express-train ride or a 40-minute two-bus slog — Moovin tries to show that difference on a map instead of a spreadsheet.

## Features

- **Live travel-time isochrones** via the [Geoapify](https://www.geoapify.com/) Isoline API — real computed shapes, not simple circles, that hug the transit network and leave gaps where a spot genuinely isn't well served.
- **Custom destination** — click "Change" or use a station popup's "Set as destination" to recolour the whole map relative to any point (your future office, a friend's place, etc.), not just the CBD.
- **Arrive-by time picker** — morning peak, off-peak, evening peak, Saturday.
- **Search** for any of ~195 built-in Sydney train/metro/light rail/ferry/bus stops.
- **Click anywhere** on the map for an instant commute estimate.
- **Saved spots** — bookmark candidate suburbs from any popup and compare them side by side, sorted best-commute-first. Change the destination and every saved spot re-scores against it. Stored in your browser only (`localStorage`) — no account, no server, nothing leaves the device.
- **Automatic fallback** — if no API key is connected (or a request fails), the site falls back to a built-in approximate dataset (hand-compiled off-peak timetable estimates) so it's never blank.
- Optional [TravelTime API](https://traveltime.com/) support for timetable-exact isochrones (their free tier currently requires a company email to sign up).
- **Optional shared-key proxy** (`worker/`) — a small Cloudflare Worker that keeps the provider key server-side and caches aggressively, so visitors get live bands without needing a key of their own. See [Deploying](#optional-serve-visitors-from-your-own-key-worker).

## Quick start

1. Clone this repo.
2. Get a free Geoapify API key at [myprojects.geoapify.com](https://myprojects.geoapify.com/) (email signup only, no card, 3,000 free credits/day).
3. Copy the config template and paste your key in:
   ```
   cp config.example.js config.js
   ```
   then edit `config.js`:
   ```js
   const MOOVIN_CONFIG = {
     geoapifyKey: "your-key-here",
     travelTimeAppId: "",
     travelTimeApiKey: "",
   };
   ```
4. Open `index.html` in a browser. If your browser blocks `fetch` requests from a plain `file://` page, serve the folder locally instead:
   ```
   python3 -m http.server 8000
   ```
   then visit `http://localhost:8000`.

No `config.js`? The site still works — it uses the built-in approximate data, and you can paste a key into the in-app **API setup** panel for that browser tab instead (not saved between sessions).

## Deploying

This is a static site — `index.html`, `styles.css`, `app.js`, `stations.js`, plus your local `config.js`. GitHub Pages, Netlify, Vercel, or any static host all work with zero build step.

Note: `config.js` is gitignored on purpose, so a public deployment won't have your key baked in — visitors would need to add their own via the API setup panel. That's intentional; don't commit a real API key to a public repo.

### Optional: serve visitors from your own key (`worker/`)

If you'd rather visitors didn't need a key at all, deploy the Cloudflare Worker in `worker/`. It holds the Geoapify key server-side and the browser only ever talks to your endpoint.

A key can't be hidden in a static page, so this is the only way to do it — but it also means you're paying for everyone's lookups. The Worker is built around that: it snaps incoming coordinates to a ~300 m grid before they become a cache key, so nearby lookups collapse onto one stored response, and since most people are asking about the same handful of destinations, most requests never reach Geoapify. It also restricts requests to a Sydney bounding box and rate-limits cache misses only.

```
cd worker
npx wrangler login
npx wrangler kv namespace create ISO_CACHE   # paste the printed id into wrangler.toml
npx wrangler secret put GEOAPIFY_KEY         # your key, stored server-side
# set ALLOWED_ORIGINS in wrangler.toml to your site's origin
npx wrangler deploy
```

Then put the deployed URL into `DEFAULT_API_BASE` near the top of `app.js`:

```js
const DEFAULT_API_BASE = "https://moovin-api.you.workers.dev";
```

That value is public by design, so unlike the API keys it belongs in the committed file. With it set, the site boots straight into live data, the status chip reads "Live data · shared key", and the API setup panel becomes optional — visitors who hit the shared rate limit can still paste their own key, or switch back with "Use shared key".

To run the Worker locally, put `GEOAPIFY_KEY=…` in `worker/.dev.vars` (gitignored), run `npx wrangler dev`, and set `apiBase` in your `config.js` to the address it prints.

Worth knowing: Cloudflare's rate-limit binding is not enforced by `wrangler dev` — it always reports success locally and only takes effect once deployed. Everything else behaves the same in both.

## How the data works

- **Isochrones**: on connect, the site calls Geoapify's isoline endpoint with your destination and the current band thresholds (10/20/30... min), requesting `transit` mode first and falling back to `approximated_transit` if exact transit coverage isn't available for the area. Shapes are simplified (near-duplicate points dropped) before rendering for smoother pan/zoom.
- **Built-in station data** (`stations.js`): ~195 Sydney PT stops with hand-compiled off-peak minutes-to-CBD, used as the no-API-key fallback and for the search/click-estimate features. These are estimates, not live timetable data — good for a first pass, not a substitute for checking an actual trip planner before signing a lease.
- **Saved spots**: kept under the `moovin.saved.v1` key in `localStorage` as `{v:1, spots:[{id, label, lat, lon}]}`. Times shown next to each spot are always derived on the fly from the built-in dataset relative to the current destination — nothing time-related is cached, so changing destination re-scores the whole list. The record shape is deliberately flat so a future server-backed version can sync the array as-is.

## Roadmap

- [x] Real computed travel-time bands (API-backed isochrones)
- [x] Custom destination, not just the CBD
- [x] Saved spots (per-browser)
- [ ] Saved spots synced across devices — needs accounts + a backend
- [ ] Per-mode filtering (train-only / bus-only) — needs a provider that separates transit modes (TravelTime supports this; Geoapify's transit mode is combined)
- [ ] Rent/price overlay per suburb
- [ ] Any-city support (currently Sydney-only)
- [ ] Exact timetable data via [Transport for NSW GTFS open data](https://opendata.transport.nsw.gov.au/)

## Credits

- Map tiles: [CARTO](https://carto.com/) / [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Map library: [Leaflet](https://leafletjs.com/)
- Isochrones: [Geoapify](https://www.geoapify.com/) (optionally [TravelTime](https://traveltime.com/))

## License

MIT — see [LICENSE](LICENSE).
