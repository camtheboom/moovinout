# Where this is up to

Working notes from the sessions on **2026-08-17** and **2026-08-19**. Three features built, all working,
**none committed yet**. Only the Worker (2) needs anything from you.

---

## 1. Saved spots — done, no deploy needed

Bookmark candidate suburbs from any map popup, compare them side by side. Sorted best-commute-first, and every spot re-scores when you change the destination.

Stored per-browser in `localStorage` under `moovin.saved.v1` as `{v:1, spots:[{id, label, lat, lon}]}`. No account, no server, nothing leaves the device.

Verified in Chrome: save from both popup types, auto-labelling from the nearest stop, 60 m dedupe, persistence across reload, rename, remove, empty state, and re-scoring on destination change.

Nothing to do here — it works as soon as you serve the page.

---

## 2. Isochrone proxy (`worker/`) — built and tested, **not deployed**

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

```
npx wrangler deploy
```

Finally, put the deployed URL into **`app.js:11`**:

```js
const DEFAULT_API_BASE = "https://moovin-api.you.workers.dev";
```

That value is public by design — unlike the API keys, it belongs in the committed file so it ships with the site.

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

End to end in the browser: a page with **no key in it at all** rendering live bands through the proxy, both modal toggles ("Use approximate data" / "Use shared key"), and error propagation — a Brisbane destination surfaced the Worker's own message and dropped cleanly to approximate data.

---

## Gotchas worth remembering

- **Orphaned `wrangler dev` processes on Windows.** Killing the port's PID isn't enough; the parent respawns `workerd` children, and a second instance can bind the same port while requests route to the dead one — it reports `Ready` and answers nothing. Kill by command line, not port:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
    Where-Object { $_.CommandLine -match 'wrangler|@cloudflare\\workerd' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
- **Browser caching of `config.js`** silently invalidated a test run — the page kept using an old key long after the file changed. Serving on a fresh port is the quickest way to get a clean cache.
- **Local dev secrets** go in `worker/.dev.vars` (`GEOAPIFY_KEY=…`), which is gitignored. It was deleted at the end of the session; recreate it if you go back to `wrangler dev`.

---

## Uncommitted state

```
 M .gitignore          node_modules/, .wrangler/, .dev.vars, tools/.cache/
 M README.md           saved spots + worker deploy docs + rewritten rent section
 M config.example.js   apiBase option, Domain now documented as optional
 M index.html          saved spots feature, proxy provider, escapeHtml, estimateAt,
                       rentdata.js script tag, Studio filter button, source line
 M styles.css          rent source line, combined-figure popup row
 M app.js              saved spots
?? worker/             package.json, wrangler.toml, src/index.js
?? rentals.js          rent overlay + NSW bond provider
?? rentdata.js         generated — 478 postcodes, do not hand-edit
?? tools/              build-rent-data.py
```

`config.js` and `worker/.dev.vars` are both confirmed gitignored, so neither key can be committed by accident.
