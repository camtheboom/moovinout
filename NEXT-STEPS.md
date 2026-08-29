# Where this is up to

Working notes from the sessions on **2026-08-17**, **2026-08-19** and **2026-08-29**.

**Read this first (2026-08-29).** Two things changed:

- **The "API KEY REQUIRED" text smeared across the map was the basemap, not Moovin.**
  CARTO put their tiles behind a key. They didn't start failing — they started returning
  a valid 200 PNG with "API KEY REQUIRED / carto.com/basemaps/apikey" stamped on it, so
  every tile rendered that message and nothing in the app could detect it. Swapped to
  Esri's keyless Light Gray Canvas (`app.js`, the basemap block). Fixed, nothing to do.
- **Bring-your-own-key is gone.** No API setup panel, no provider tabs, no key inputs.
  Visitors get the site's own data or the built-in approximate fallback, nothing else.
- **The Worker is deployed** (2026-08-30) at `https://moovin-api.cameron-02e.workers.dev`
  and wired into `app.js`. Live bands work with no key in the page. The one loose end is
  `ALLOWED_ORIGINS`, still `""` — see section 2.

---

## 1. Saved spots — done, no deploy needed

Bookmark candidate suburbs from any map popup, compare them side by side. Sorted best-commute-first, and every spot re-scores when you change the destination.

Stored per-browser in `localStorage` under `moovin.saved.v1` as `{v:1, spots:[{id, label, lat, lon}]}`. No account, no server, nothing leaves the device.

Verified in Chrome: save from both popup types, auto-labelling from the nearest stop, 60 m dedupe, persistence across reload, rename, remove, empty state, and re-scoring on destination change.

Nothing to do here — it works as soon as you serve the page.

---

## 2. Isochrone proxy (`worker/`) — **DEPLOYED and live (2026-08-30)**

```
https://moovin-api.cameron-02e.workers.dev
```

Wired into `DEFAULT_API_BASE` in `app.js`, so a page with no keys in it renders live
bands. Verified against the real endpoint: happy path (3 features, MultiPolygon, transit
mode), cache MISS then HIT, grid snapping collapsing nearby coords onto one entry, all
five validation rejections, 404 on wrong path, 405 on POST, Melbourne accepted and
Brisbane rejected. In the browser, a keyless copy booted straight to "Live data · shared
key" with real transit-shaped isochrones.

**Rate limiting is now verified in production** — the item below that couldn't be tested
locally. 25 rapid requests at distinct grid cells returned exactly 20 × 200 and 5 × 429.

### One thing still open: `ALLOWED_ORIGINS`

`wrangler.toml` line 9 is still `""`, which means **any** origin can call the endpoint and
spend the Geoapify credits. Nothing links to it yet, so it isn't exposed in practice, but
set it to the site's origin (comma-separated, no trailing slash) and redeploy before the
site goes public.

Note the two defaults wrangler warned about on deploy: `workers_dev` and `preview_urls`
are both enabled implicitly. Preview URLs mean every deployed version also gets its own
public hostname — same code and same guards, but more front doors than needed. Setting
`preview_urls = false` in `wrangler.toml` closes them if you'd rather.

### Original notes (kept for context)

A Cloudflare Worker that holds the Geoapify key server-side so visitors don't need one. The proxying is trivial; the real work is avoiding the upstream call — coordinates snap to a ~300 m grid before becoming a cache key, so nearby lookups share one cached response.

### Deploy checklist

```
cd worker
npx wrangler login
npx wrangler kv namespace create ISO_CACHE     # paste the printed id into wrangler.toml
npx wrangler secret put GEOAPIFY_KEY           # your key — stays server-side
```

Then, before deploying, edit `worker/wrangler.toml`:

- [ ] `id = "…"` under `[[kv_namespaces]]` — the id printed above
- [ ] `ALLOWED_ORIGINS = "…"` — your site's origin, e.g. `https://moovin.pages.dev`. Comma-separated, no trailing slash. Leaving it empty allows **any** origin, which is fine locally and wrong in production.
- [ ] `SERVED_AREAS` — already covers Sydney and Melbourne. Check it still lists every city in `cities.js` with a matching bbox, or those visitors get an error instead of bands. `node worker/test-served-areas.mjs` checks the parsing offline.

```
npx wrangler deploy
```

Finally, put the deployed URL into **`DEFAULT_API_BASE`** near the top of `app.js`:

```js
const DEFAULT_API_BASE = "https://moovin-api.you.workers.dev";
```

That value is public by design — unlike the API keys, it belongs in the committed file so it ships with the site.

**How to tell it worked:** load the deployed site and look at the status chip under the
title. "Live data · shared key" means the proxy is answering. "Approximate built-in data"
means it isn't, and the browser console will have the reason (the app itself stays quiet
about infrastructure failures on purpose — see the failure-handling note below).

### What visitors see when something breaks

Deliberate split in `refreshLive()`:

- **4xx** — a destination outside `SERVED_AREAS`, or the rate limit — is something the
  visitor can act on, so it surfaces as a toast and the map drops to approximate bands.
- **5xx, network failure, quota exhaustion** — nothing they can do — is silent. The chip
  flips to "Approximate built-in data", the console logs it, and the map keeps working.

All four cases were verified against a stubbed proxy: every one falls back cleanly with
the station layer restored, and only the 4xx pair raises a toast.

### After deploying, check the one untested thing

Rate limiting **could not be verified locally**. Cloudflare's rate-limit binding isn't enforced by `wrangler dev` — 24 rapid cache misses all returned 200. That was confirmed to be the emulator, not a bug: the binding is present and called on every miss, it just always reports success locally.

So once it's live, fire ~25 rapid requests at *distinct* locations (distinct = different grid cells, otherwise they're cache hits and deliberately not metered) and confirm you start getting 429s:

```
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " \
    "https://YOUR-WORKER/isochrone?lat=-33.$((800 + i * 4))&lon=151.10&range=600"
done
```

Limit is set to 20/min per IP in `wrangler.toml`.

---

---

## 3. NSW bond rent data — done, no key or deploy needed

The rent overlay now ships real figures instead of the sample ones. Source is NSW Fair
Trading's rental bond lodgements: every residential bond lodged in NSW, published monthly
as open data, so these are rents tenants actually agreed to rather than asking prices.

`tools/build-rent-data.py` scrapes the source page, rolls the newest 12 monthly
spreadsheets into medians per postcode, joins postcode centroids, and writes `rentdata.js`
— 478 postcodes from 290,710 bonds, bundled in the page like `stations.js`. No key, no
proxy, no quota. Re-run it (`pip install openpyxl` first) whenever you want fresher
numbers; Fair Trading posts a new month around mid-month.

This also settles the Domain question. A key is now optional and, on your current project,
still blocked — listing search is a Production-environment operation and the project is
Sandbox-only, so the call 403s and the overlay falls back to the bond data. That fallback
was verified in the browser with your real `config.js`.

Two things worth knowing:

- **The filters had a bug that only real data exposed.** Sample areas had every bedroom
  count and dwelling type, so a missing figure never came up. Real data is sparse — 413 of
  478 postcodes have no studio median — and `rentFor()` was falling through to the 2-bed
  figure, so filtering to Studio showed Eastlakes at $1000, its 2-bed rent. A missing
  segment now reads as missing and the area drops off the map.
- **Bedrooms and dwelling type are separate medians**, so neither can answer "2-bed
  apartment". `rentdata.js` now carries the two crossed as well (`x:{"2a":820}`), which is
  what the pin shows when both filters are set, called out at the top of the popup so it
  doesn't look like it disagrees with the breakdown under it.

Still NSW-only. Every other state runs its own bond board with its own format and cadence,
and the NT has no bond board at all, so going national means one adapter per state.

## Everything that was verified

Worker, against a real Geoapify call: happy path (200 / MISS / transit mode / 3 correct features), cache HIT on repeat, grid snapping collapsing same-cell requests, reordered range values sharing a cache entry, all five validation rejections (out of bbox, non-numeric lat/lon, missing range, non-numeric range, too many ranges), 405 on POST, 404 on wrong path, CORS preflight, and origin allow/deny.

End to end in the browser: a page with **no key in it at all** rendering live bands through the proxy, and error propagation — a Brisbane destination surfaced the Worker's own message and dropped cleanly to approximate data. (The two modal toggles that used to be tested here, "Use approximate data" and "Use shared key", no longer exist — the modal went with the bring-your-own-key flow on 2026-08-29.)

Re-verified 2026-08-29 after those changes, against a stubbed proxy so no Geoapify credits were spent: boots straight to "Live data · shared key" with three bands and no key UI anywhere; with no config and no proxy it falls to 146 station zones and the approximate chip; both popup types still open; the Esri basemap serves 72 tiles with 0 broken and upscales past z16 instead of going blank; Melbourne plus the rent overlay (64 markers) renders clean. Searched the rendered page for "api key" — no matches.

---

## Gotchas worth remembering

- **A tile provider can fail without failing.** CARTO's keyless basemap started returning
  HTTP 200, `image/png`, correct size — with "API KEY REQUIRED" printed on the image. No
  status code, console error or `onerror` fires, so nothing in the app can detect it; it
  only shows up by looking at the map. If the basemap ever looks wrong again, screenshot
  it before debugging code. Current provider (Esri Light Gray Canvas) needs no key, but
  the same thing could happen to it, so this is worth knowing rather than trusting.

- **Orphaned `wrangler dev` processes on Windows.** Killing the port's PID isn't enough; the parent respawns `workerd` children, and a second instance can bind the same port while requests route to the dead one — it reports `Ready` and answers nothing. Kill by command line, not port:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
    Where-Object { $_.CommandLine -match 'wrangler|@cloudflare\\workerd' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
- **Browser caching of `config.js`** silently invalidated a test run — the page kept using an old key long after the file changed. Serving on a fresh port is the quickest way to get a clean cache.
- **Local dev secrets** go in `worker/.dev.vars` (`GEOAPIFY_KEY=…`), which is gitignored. It was deleted at the end of the session; recreate it if you go back to `wrangler dev`.

---

## Commit state

All three features are committed and pushed. The Worker landed in `b57c13e`; the rent
overlay, its generated data and the build tool landed in `c5ec64b`:

```
b57c13e restructure        worker/ (package.json, wrangler.toml, src/index.js), saved spots
c5ec64b Half finished MVP  rentals.js, rentdata.js, tools/build-rent-data.py
```

Nothing is outstanding in the working tree. `config.js` and `worker/.dev.vars` are both confirmed gitignored, so neither key can be committed by accident.
