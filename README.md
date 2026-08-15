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
- **Automatic fallback** — if no API key is connected (or a request fails), the site falls back to a built-in approximate dataset (hand-compiled off-peak timetable estimates) so it's never blank.
- Optional [TravelTime API](https://traveltime.com/) support for timetable-exact isochrones (their free tier currently requires a company email to sign up).

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

This is a static site — three files (`index.html`, `stations.js`, plus your local `config.js`). GitHub Pages, Netlify, Vercel, or any static host all work with zero build step.

Note: `config.js` is gitignored on purpose, so a public deployment won't have your key baked in — visitors would need to add their own via the API setup panel. That's intentional; don't commit a real API key to a public repo.

## How the data works

- **Isochrones**: on connect, the site calls Geoapify's isoline endpoint with your destination and the current band thresholds (10/20/30... min), requesting `transit` mode first and falling back to `approximated_transit` if exact transit coverage isn't available for the area. Shapes are simplified (near-duplicate points dropped) before rendering for smoother pan/zoom.
- **Built-in station data** (`stations.js`): ~195 Sydney PT stops with hand-compiled off-peak minutes-to-CBD, used as the no-API-key fallback and for the search/click-estimate features. These are estimates, not live timetable data — good for a first pass, not a substitute for checking an actual trip planner before signing a lease.

## Roadmap

- [x] Real computed travel-time bands (API-backed isochrones)
- [x] Custom destination, not just the CBD
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
