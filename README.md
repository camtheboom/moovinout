# Moovin

Find where to live, by commute — not by vibes.

Moovin is a Google-Maps-style site that draws coloured travel-time bands (like isochrones) around a destination — a capital's CBD by default, or any point you pick — showing how far you can live away and still keep your public-transport commute under a time budget you choose. **Sydney and Melbourne** are wired up so far.

![Moovin screenshot](screenshots/moovin.png)

## Why

Built while house-hunting for a move to Sydney: existing suburb/rent tools show distance, not actual public-transport travel time. A suburb 5 km from the city can be a 12-minute express-train ride or a 40-minute two-bus slog — Moovin tries to show that difference on a map instead of a spreadsheet.

## Features

- **Live travel-time isochrones** from [TravelTime](https://traveltime.com/) or [Geoapify](https://www.geoapify.com/) — real computed shapes, not simple circles, that hug the transit network and leave gaps where a spot genuinely isn't well served.
- **Custom destination** — click "Change" or use a station popup's "Set as destination" to recolour the whole map relative to any point (your future office, a friend's place, etc.), not just the CBD.
- **Arrive-by time picker** — morning peak, off-peak, evening peak, Saturday. TravelTime only: it reads real timetables, whereas Geoapify's transit shapes don't vary by time of day (the picker greys out on Geoapify).
- **City picker** — Sydney or Melbourne. Switching swaps the station dataset, the CBD anchor the built-in times are measured to, the timezone the arrival picker resolves against, the rent source and the framing, all at once. Cities are rows in `cities.js`, not branches in the app — see [Adding a city](#adding-a-city).
- **Search** for any built-in stop in the active city — 195 Sydney train/metro/light rail/ferry/bus stops, 399 Melbourne train and tram stops.
- **Click anywhere** on the map for an instant commute estimate.
- **Saved spots** — bookmark candidate suburbs from any popup and compare them side by side, sorted best-commute-first. Change the destination and every saved spot re-scores against it. Stored in your browser only (`localStorage`) — no account, no server, nothing leaves the device.
- **Rent overlay** — a price marker per suburb, colour-coded cheap→dear, with a filter panel for weekly budget, bedrooms and property type. The filter that matters is "only inside my travel-time bands": it answers *where can I afford to live that's still within my commute*, which is the whole point of the site. Click any marker for the breakdown by bedrooms and dwelling type. Real figures from state bond boards — NSW Fair Trading and Victoria's RTBA — bundled in the page, no key needed. See [Rent data](#rent-data).
- **Shareable links** — "Copy shareable link" bakes the destination, time budget and arrival time into the URL, so sending someone a link reopens exactly what you were looking at. The address bar tracks your changes as you go.
- **Two-tier caching** — computed bands are cached for the session and mirrored into `localStorage`, so revisiting a destination (or just reloading) costs no API quota for a week.
- **Automatic fallback** — if a live request fails, the site drops silently to a built-in approximate dataset (hand-compiled off-peak timetable estimates) so it's never blank. Visitors are never shown a key prompt; the only thing that changes is the status chip.
- **Shared-key proxy** (`worker/`) — a small Cloudflare Worker that keeps the provider key server-side and caches aggressively. This is how deployed copies serve live bands: visitors never supply a key, and there is no in-app panel to paste one into. See [Deploying](#serving-visitors-from-your-key-worker).

## Providers

Visitors never choose a provider or supply a key — the deployed site answers everyone from its own. These two are what it can be pointed at, and you only need one:

| | Accuracy | Signup | Free tier |
|---|---|---|---|
| **TravelTime** | Timetable-exact, varies by arrival time | Asks for a business name — your own name or project name generally works | Tighter — every page load spends from it |
| **Geoapify** | Transit shapes partly modelled, same at any hour | Email only, no card | ~3,000 credits/day |

`config.js` is a **local-development** convenience only — it's gitignored, so it never reaches a deployed copy. If both keys are in it, **TravelTime is used**; Geoapify is the fallback. A configured proxy (see [Deploying](#serving-visitors-from-your-key-worker)) overrides both and is the only one of the three that works for visitors. With none of them, the site runs on built-in approximate data.

Precedence lives in `app.js` near the top, if you'd rather flip it.

## Quick start

This is the **local development** path. To set up a deployment that serves visitors, see [Deploying](#serving-visitors-from-your-key-worker) — the two are configured differently on purpose.

1. Clone this repo.
2. Get a key from whichever provider suits you:
   - **TravelTime** (recommended) — [account.traveltime.com/signup](https://account.traveltime.com/signup), gives you an Application ID *and* an API key.
   - **Geoapify** — [myprojects.geoapify.com](https://myprojects.geoapify.com/), a single key, easiest signup.
3. Copy the config template and paste your credentials in:
   ```
   cp config.example.js config.js
   ```
   then edit `config.js` — fill in the provider you signed up for and leave the other blank:
   ```js
   const MOOVIN_CONFIG = {
     travelTimeAppId: "your-app-id",
     travelTimeApiKey: "your-api-key",
     geoapifyKey: "",
   };
   ```
4. Uncomment the `config.js` script tag in `index.html` — it ships commented out, because `config.js` is gitignored and never deployed, so on a live host the tag would be a guaranteed 404 on every page load:
   ```html
   <script src="config.js"></script>
   ```
   Leave it commented if you only want the built-in approximate data. **Re-comment it before deploying.**
5. Open `index.html` in a browser. If your browser blocks `fetch` requests from a plain `file://` page, serve the folder locally instead:
   ```
   python3 -m http.server 8000
   ```
   then visit `http://localhost:8000`.

No `config.js`? The site still works — it just runs on the built-in approximate data. There is no in-app panel for pasting a key; that flow was removed deliberately, so a visitor's only source of live data is the site's own.

## Deploying

This is a static site — `index.html`, `privacy.html`, `styles.css`, `app.js`, `cities.js`, the station files (`stations.js`, `stations-mel.js`), the rent files (`rentdata.js`, `rentdata-vic.js`), `rentals.js`, and `_headers`. GitHub Pages, Netlify, Vercel, or any static host all work with zero build step. Do **not** upload `config.js`.

**Prefer Cloudflare Pages, and deploy it from Git rather than by uploading a folder.** Two reasons, both about not leaking your key: a Git-connected deploy physically cannot pick up `config.js` (it's gitignored), whereas `wrangler pages deploy .` from your working copy would upload it. And `_headers` — the site's Content-Security-Policy and other security headers — is honoured by Pages and Netlify, but **silently ignored by GitHub Pages**, which offers no way to set response headers at all.

The CSP in `_headers` names every origin the site is allowed to talk to, so it has to be kept in step with the code: if you change `DEFAULT_API_BASE` in `app.js` (a custom domain for the Worker, say), change `connect-src` in `_headers` to match, or the browser will block the call and every visitor will silently drop to approximate data. Same for swapping the basemap (`img-src`) or the CDN Leaflet comes from (`script-src`).

The policy is also the reason the popup buttons carry their arguments in `data-*` attributes and are dispatched by one delegated listener in `app.js`, rather than using inline `onclick`. Adding an inline handler anywhere would mean putting `'unsafe-inline'` back into `script-src`, which gives away most of what the policy buys.

Note: `config.js` is gitignored on purpose, so a public deployment won't have your key baked in. **A static deployment on its own therefore serves approximate data to everyone** — deploying the Worker below is what makes it live. Don't work around this by committing a real key: anything in a static page is readable by anyone who opens devtools, and a harvested key gets spent.

### Serving visitors from your key (`worker/`)

**This step is what makes a deployment show live data.** Deploy the Cloudflare Worker in `worker/`: it holds the provider key server-side, and the browser only ever talks to your endpoint. Since the site asks visitors for nothing, without this there is no path to live bands and every visitor gets the approximate fallback.

**The Worker speaks Geoapify only.** Routing TravelTime through it would mean adding a second upstream path — a different request shape (`POST` with a JSON body and an arrival time, rather than a `GET`). So with the proxy enabled, visitors get Geoapify bands and the arrival-time picker greys out, even if your own `config.js` uses TravelTime.

A key can't be hidden in a static page, so this is the only way to do it — but it also means you're paying for everyone's lookups. The Worker is built around that: it snaps incoming coordinates to a ~300 m grid before they become a cache key, so nearby lookups collapse onto one stored response, and since most people are asking about the same handful of destinations, most requests never reach Geoapify. It also refuses any destination outside the boxes listed in `SERVED_AREAS` (`wrangler.toml`) and rate-limits cache misses only.

```
cd worker
npx wrangler login
npx wrangler kv namespace create ISO_CACHE   # paste the printed id into wrangler.toml
npx wrangler secret put GEOAPIFY_KEY         # your key, stored server-side
# in wrangler.toml: set ALLOWED_ORIGINS to your site's origin, and check
# SERVED_AREAS lists every city in cities.js
npx wrangler deploy
```

Then put the deployed URL into `DEFAULT_API_BASE` near the top of `app.js`:

```js
const DEFAULT_API_BASE = "https://moovin-api.you.workers.dev";
```

This repo's own deployment is already set to `https://moovin-api.cameron-02e.workers.dev`.

That value is public by design, so unlike the API keys it belongs in the committed file. With it set, the site boots straight into live data and the status chip reads "Live data · shared key". A visitor who trips the rate limit sees a "wait a moment" toast and the approximate bands, then gets live data again on their next try — there is no key for them to fall back on.

`SERVED_AREAS` is the spend guard: `name:minLat,maxLat,minLon,maxLon`, semicolon-separated, and anything outside every listed box is rejected before it reaches Geoapify. It ships covering Sydney and Melbourne. **Each box has to match that city's `bbox` in `cities.js`** — if the site offers a city the endpoint doesn't list, those visitors get an error instead of bands. A malformed entry is skipped and the rest keep serving; if every entry is malformed it falls back to the Sydney box built into `src/index.js` rather than serving nowhere. `node worker/test-served-areas.mjs` exercises all of that offline, with the upstream call stubbed.

To run the Worker locally, put `GEOAPIFY_KEY=…` in `worker/.dev.vars` (gitignored), run `npx wrangler dev`, and set `apiBase` in your `config.js` to the address it prints.

Worth knowing: Cloudflare's rate-limit binding is not enforced by `wrangler dev` — it always reports success locally and only takes effect once deployed. Everything else behaves the same in both.

## Rent data

**The rent overlay shows real rents, out of the box, with no key.** They come from the state bond boards — every residential bond is recorded when a tenancy starts, and each state publishes the aggregate as open data under CC BY.

Two things make this the right default. It needs nothing — no key, no signup, no proxy, no quota — because the figures ship in the page as `rentdata.js` / `rentdata-vic.js`, the same way the station files do. And it is what tenants *actually agreed to pay* at the start of a tenancy, not what a listing was advertised at, which is the number you want when working out whether you can afford a suburb.

Rent is a per-state question — every bond board runs its own format, geography and cadence — so each city names its source in `cities.js` and gets its own bundled file. A city with no source wired up shows no markers and says so, rather than borrowing a neighbouring state's figures.

| City | Source | Geography | Coverage | Cadence |
|---|---|---|---|---|
| Sydney | [NSW Fair Trading](https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data) bond lodgements | Postcodes | 478 postcodes, 290,710 bonds | Monthly, per-bond rows |
| Melbourne | [Victorian Rental Report](https://www.dffh.vic.gov.au/publications/rental-report) (RTBA bonds, DFFH) | DFFH suburb groups | 146 groups | Quarterly, published medians |

### New South Wales

The bundled file covers **478 NSW postcodes from 290,710 bonds** over a rolling 12 months. Each postcode carries a median weekly rent by bedroom count, by dwelling type, and by the two crossed — so "2-bed apartment" is a real median over 2-bed apartments, not a guess stitched together from the other two.

Fair Trading publishes per-bond rows, so the medians and the suppression thresholds are ours.

#### Refreshing it

Fair Trading publishes a new month roughly mid-month. To pull the latest:

```
pip install openpyxl
python tools/build-rent-data.py
```

That scrapes the source page for the newest 12 monthly spreadsheets, aggregates them, and rewrites `rentdata.js`. Downloads are cached under `tools/.cache` (gitignored), so re-runs only fetch what's new. Never edit `rentdata.js` by hand — it's generated.

#### What the NSW numbers do and don't tell you

- **They're bonds, not listings.** A bond is lodged when a tenancy starts, so the data lags the market by however long leases run, and it says nothing about what's available right now.
- **A rolling 12-month window** evens out seasonality and gives thin postcodes enough observations to be worth reporting, at the cost of blurring a fast-moving market.
- **Sparse cells are hidden, not filled in.** A postcode needs 25 bonds to appear at all, and any single median needs 8 behind it. Only 65 of the 478 postcodes have enough studio bonds to report one, so filtering to Studio genuinely empties most of the map — that's the data being honest rather than a broken filter.
- **Postcodes aren't suburbs.** Markers sit at the postcode centroid and are labelled with its principal locality, so 2042 reads "Enmore" though it covers Newtown too. The postcode is always shown next to the name.
- **Garages, car spaces and rented rooms are excluded** (Fair Trading's "other" and "unknown" dwelling types), so they can't drag a bedroom median down.

### Victoria

Melbourne's figures come from the [Victorian Rental Report](https://www.dffh.vic.gov.au/publications/rental-report), DFFH's quarterly publication of Residential Tenancies Bond Authority lodgements — same idea as NSW, same licence, different shape. `rentdata-vic.js` bundles **146 DFFH suburb groups**, the moving annual median to Sep 2025.

```
pip install openpyxl
python tools/build-rent-data-vic.py
```

Three differences are worth knowing before you read a Melbourne marker:

- **DFFH publishes finished medians, not per-bond rows.** Suppression of thin cells is theirs, not ours, so the NSW thresholds don't apply here and a suppressed cell is simply absent.
- **Bedroom and dwelling-type figures are derived.** Victoria publishes only the bedrooms × type crossing plus an all-properties median. Bedroom-only and type-only medians can't be recovered from that — a median of medians isn't a median — so those are count-weighted blends, flagged `derived: true` and labelled as combined in the popup rather than passed off as published figures. The all-properties number is real.
- **No studio and no townhouse category exists at all**, so filtering to either empties Melbourne.

The geography is DFFH's own suburb groups ("Carlton-Parkville", "CBD-St Kilda Rd"), not postcodes, so there's no postcode to join a centroid to — names are split, geocoded against the same open locality dataset the NSW build uses, and the parts averaged. Anything that won't resolve is reported and dropped, never guessed.

### Optional: Domain listings instead

If you want asking prices from live listings rather than agreed rents from bonds, put a Domain API key in `config.js`:

```js
domainApiKey: "your-key-here",
```

Free "innovation" tier at [developer.domain.com.au](https://developer.domain.com.au/). When the key is present the overlay uses it in preference to the bond data, fetching per viewport and grouping listings per postcode into medians.

Worth knowing before you bother: the key authenticates and Domain does send permissive CORS headers, so the browser-direct call works and doesn't need the `worker/` proxy. But residential listing search is a *Production*-environment operation, and projects are provisioned Sandbox-only by default — so a fresh innovation-tier key gets you a 403 until you add the Production variant of the Agents & Listings package. The free tier is also small enough that a busy public deployment would exhaust it.

If the Domain call fails for any reason, the overlay drops back to the bundled bond data and says so, rather than going blank.

### Sample data

`rentals.js` still carries a small set of invented figures for ~50 Sydney postcodes. They're the last-resort fallback if the bundled file for the active city is missing entirely, and they're labelled as sample data everywhere they appear — the panel and every popup. Nothing should be read into them.

## How the data works

- **Isochrones**: on connect, the site asks the active provider for one shape per band threshold (10/20/30… min) around your destination.
  - *TravelTime* takes a single `POST` to its `time-map` endpoint carrying all bands at once, plus the arrival time from the "Arrive by" picker — so the shapes reflect the actual timetable at that hour.
  - *Geoapify* takes one `GET` per request to its isoline endpoint, asking for `transit` mode first and falling back to `approximated_transit` where exact transit coverage isn't available. It has no notion of arrival time.

  Either way the returned shapes are simplified (near-duplicate points dropped) before rendering, for smoother pan/zoom, and results are cached in memory per destination + bands + arrival time.
- **Built-in station data**: a list of stops per city with an approximate off-peak travel time to that city's CBD anchor, used as the no-API-key fallback and for the search/click-estimate features.
  - *Sydney* (`stations.js`): 195 train/metro/light rail/ferry/bus stops, hand-compiled.
  - *Melbourne* (`stations-mel.js`): 399 train and tram stops, derived from the PTV GTFS feed by `tools/build-stations.py melbourne` — the median off-peak weekday run time on trips that actually serve both the stop and a city station, with one-transfer stops (the Alamein and Stony Point shuttles) resolved through their interchange plus a 5-minute penalty. Anything needing two transfers is left out rather than guessed at.

  Both are estimates in the same accuracy tier, not live timetable data — good for "roughly how far out is this", not a substitute for checking an actual trip planner before signing a lease. Neither file is hand-edited once generated.
- **Arrival times** are resolved against the active city's IANA timezone via `Intl`, not a fixed offset — half the country doesn't observe daylight saving and two zones sit on the half hour.
- **Saved spots**: kept under the `moovin.saved.v1` key in `localStorage` as `{v:1, spots:[{id, label, lat, lon}]}`. Times shown next to each spot are always derived on the fly from the built-in dataset relative to the current destination — nothing time-related is cached, so changing destination re-scores the whole list. The record shape is deliberately flat so a future server-backed version can sync the array as-is.

## Adding a city

A city is a row in `cities.js` plus its datasets — never a branch inside `app.js`. The row carries:

| Field | What it's for |
|---|---|
| `cbd` | The anchor the built-in station times are measured to. This and the station dataset have to agree. |
| `view` | Opening framing. Deliberately not the same as `cbd`, which usually sits at the edge of the metro area. |
| `tz` | IANA zone for the arrive-by picker. |
| `bbox` | Greater metro, roughly. Keeps the proxy from being repurposed as a free global API, and sanity-checks geocoded rent areas. Must match `SERVED_AREAS` in `worker/wrangler.toml`. |
| `stations` | A thunk returning the station array, so load order and missing optional files don't matter. |
| `rent` | Which provider in `rentals.js` serves this city, or omitted for none. |

Then:

1. A `CITIES` entry in `tools/build-stations.py` — the agency's GTFS feed URL, which modes to read, and which stops count as "the city" — then `python tools/build-stations.py <city>` to write the station file, and a `<script>` tag for it in `index.html`. Agencies that ship a single flat zip rather than PTV's nested one need a sibling of `open_ptv_feed()`; the rest of that script is ordinary GTFS.
2. A rent provider for the state, if its bond board publishes something — one adapter per state, registered in `RENT_PROVIDERS` and listed in `BOND_DATA`.
3. The city's `bbox` into `SERVED_AREAS`, if you run the proxy.

The first entry in `CITIES` is the default a bare visit opens on, so reordering the list changes that. The picker hides itself entirely when there's only one city, and share links omit the `city` key in that case so a single-city build emits exactly the links it always did.

## Roadmap

- [x] Real computed travel-time bands (API-backed isochrones)
- [x] Custom destination, not just the CBD
- [x] Saved spots (per-browser)
- [ ] Saved spots synced across devices — needs accounts + a backend
- [ ] Per-mode filtering (train-only / bus-only) — unblocked now that TravelTime is wired up: it separates transit modes, where Geoapify's are combined
- [x] Rent/price overlay per suburb — real NSW bond data, no key required (see [Rent data](#rent-data))
- [x] Rent data beyond NSW — Victoria (RTBA / DFFH) shipped
- [ ] Rent data for the remaining states — one adapter each, since every bond board has its own format and geography; NT has no bond board at all
- [x] City registry, so a city is a row in `cities.js` rather than constants in `app.js`
- [x] A second city — Melbourne, with its stations derived from GTFS rather than hand-compiled
- [ ] The remaining capitals — Brisbane, Perth, Adelaide, Canberra, Hobart (see [Adding a city](#adding-a-city))
- [ ] Exact timetable data via [Transport for NSW GTFS open data](https://opendata.transport.nsw.gov.au/)

## Credits

- Map tiles: [Esri](https://www.esri.com/) Light Gray Canvas — Esri, HERE, Garmin, [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Map library: [Leaflet](https://leafletjs.com/)
- Isochrones: [TravelTime](https://traveltime.com/) or [Geoapify](https://www.geoapify.com/)
- Rent data (NSW): [NSW Fair Trading](https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data) rental bond lodgements, CC BY 4.0
- Rent data (VIC): [Victorian Rental Report](https://www.dffh.vic.gov.au/publications/rental-report), DFFH / Residential Tenancies Bond Authority, CC BY 4.0
- Melbourne timetables: [PTV GTFS](https://data.ptv.vic.gov.au/downloads/gtfs.zip) feed, CC BY 4.0
- Postcode and locality centroids: [australianpostcodes](https://github.com/matthewproctor/australianpostcodes)

## License

MIT — see [LICENSE](LICENSE).
