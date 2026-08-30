# Where this is up to

Working notes across **2026-08-17**, **08-19**, **08-29** and **08-30**.
Last session ended 2026-08-30 with the Worker live and everything uncommitted.

---

## Start here tomorrow

Three things, in this order. Only the second costs money if skipped.

1. **Commit the working tree.** Nothing from the 08-29/08-30 session is in git yet — see
   [Uncommitted work](#uncommitted-work) for the full inventory. Check `git status` first;
   `config.js` and `worker/.dev.vars` are gitignored, so no key can go in by accident.

2. **Pick a host, then lock the Worker to it.** `ALLOWED_ORIGINS` in `worker/wrangler.toml`
   is still `""`, meaning *any* origin can call the endpoint and spend the Geoapify credits.
   Not yet a real exposure — nothing links to the endpoint and the site isn't published —
   but it must be set before Moovin goes public:

   ```toml
   ALLOWED_ORIGINS = "https://your-site-origin"    # no trailing slash, comma-separated for several
   ```

   Then redeploy (see [Redeploying](#redeploying)). Cloudflare Pages is the tidy choice —
   same account as the Worker, and a predictable `*.pages.dev` origin to lock against — but
   GitHub Pages or Netlify work identically for a static site.

3. **Publish the site.** It's still local-only. Static files, zero build step: `index.html`,
   `privacy.html`, `styles.css`, `app.js`, `cities.js`, `stations*.js`, `rentdata*.js`,
   `rentals.js`. Do **not** upload `config.js` — it's local-dev only and holds real keys.

---

## What is live, and what isn't

| | Status |
|---|---|
| **Worker** (`worker/`) | **Live** at `https://moovin-api.cameron-02e.workers.dev` |
| KV cache namespace | Created and bound — id `134fdcdd2afe4d1cb2199a0ac16307fb` |
| `GEOAPIFY_KEY` secret | Set on Cloudflare, server-side only |
| `ALLOWED_ORIGINS` | **Open (`""`)** — the one loose end |
| **The site itself** | **Not hosted anywhere.** Local only, so there are no visitors yet |
| Git | **Nothing committed** from the last two sessions |

---

## Uncommitted work

What changed on 2026-08-29 / 08-30 and why:

- **The basemap was the bug.** The "API KEY REQUIRED" text smeared over the whole map was
  never Moovin's — CARTO put their tiles behind a key and now serve a **valid 200 PNG with
  the message printed on the image**. No error, no failed request, nothing detectable in
  code. Swapped to Esri's keyless Light Gray Canvas (`app.js`, basemap block). Real tiles
  stop at z16 so `maxNativeZoom: 16` upscales past that; Esri ships place names as a
  separate layer, put on a `labels` pane at `z-index: 450` with `pointerEvents: none`,
  which puts suburb names *above* the bands and keeps click-to-set-destination working.

- **Bring-your-own-key removed entirely.** No API setup panel, no provider tabs, no key
  inputs, no "Use shared key" toggle. Visitors get the Worker's data or the built-in
  approximate fallback, nothing else. `config.js` is now local-development only.

- **Failure handling split deliberately** in `refreshLive()`. A **4xx** (destination outside
  `SERVED_AREAS`, or rate-limited) is something the visitor can act on, so it toasts. A
  **5xx, network failure or exhausted quota** is not, so it is silent — the chip flips to
  "Approximate built-in data", the console logs it, the map keeps working.

- **Worker URL wired in** at `app.js:14` (`DEFAULT_API_BASE`), KV id into `wrangler.toml`,
  and the Worker's 429 message no longer points at the API panel that no longer exists.

- **Docs realigned**: `README.md`, `config.example.js`, `privacy.html`, this file.

Files touched: `app.js`, `index.html`, `styles.css`, `worker/wrangler.toml`,
`worker/src/index.js`, `README.md`, `config.example.js`, `NEXT-STEPS.md`, `privacy.html` (new).

`rentals.js` also shows as modified — that is **earlier unrelated work**, not from these
sessions.

---

## Redeploying

Login, KV namespace and the secret are all done and persist — you will not be asked again.
To ship a config or code change:

```
cd worker
npx.cmd wrangler deploy
```

**Use `npx.cmd`, not `npx`.** PowerShell's execution policy is Restricted here, which
blocks the `npx.ps1` shim; the `.cmd` shim is not affected. Fixing it properly would be
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, but `npx.cmd` avoids needing to.

**Anything that prompts needs a real terminal window.** Claude Code's shell (and its `!`
prefix) is not a TTY, so wrangler auto-answers "no" to every prompt — that is what blocked
the workers.dev subdomain registration for three attempts. Open PowerShell from the Start
menu for those.

### Two defaults worth revisiting

Wrangler warned on deploy that both were enabled implicitly:

- `preview_urls` — every deployed version also gets its own public hostname. Same code and
  same guards, but more front doors than needed. `preview_urls = false` closes them.
- `workers_dev` — note that `*.workers.dev` is blocked by some corporate and school
  networks. Those visitors would silently get the approximate fallback. If a domain ever
  lands on this Cloudflare account, a custom domain removes that failure mode; it is a
  one-line change to `DEFAULT_API_BASE`.

---

## Reference: the three features

### 1. Saved spots — done, nothing outstanding

Bookmark suburbs from any popup, compare side by side, sorted best-commute-first; every
spot re-scores when the destination changes. Per-browser `localStorage` under
`moovin.saved.v1` as `{v:1, spots:[{id, label, lat, lon}]}`. No account, no server.

Verified: both popup types, auto-labelling from nearest stop, 60 m dedupe, persistence
across reload, rename, remove, empty state, re-scoring on destination change.

### 2. Isochrone proxy (`worker/`) — done and deployed

Holds the Geoapify key server-side. The proxying is trivial; the real work is *avoiding*
the upstream call — coordinates snap to a ~300 m grid before becoming a cache key, so
nearby lookups share one cached response, and since people ask about a short list of
destinations, most requests never reach Geoapify.

`SERVED_AREAS` is the spend guard: `name:minLat,maxLat,minLon,maxLon`, semicolon-separated.
Currently Sydney and Melbourne. **Each box must match that city's `bbox` in `cities.js`** or
the site offers a city the endpoint refuses. A malformed entry is skipped and the rest keep
serving; all-malformed falls back to the Sydney box in `src/index.js`.
`node worker/test-served-areas.mjs` checks the parsing offline.

### 3. Bond rent data — done, no key or deploy needed

Real figures from state bond boards (NSW Fair Trading, Victoria's RTBA) — rents tenants
actually agreed to, not asking prices. Bundled as `rentdata.js` / `rentdata-vic.js`, no
key, no proxy, no quota. Regenerate with `tools/build-rent-data.py` (`pip install openpyxl`
first); NSW posts a new month around mid-month.

Domain is optional and still blocked on your project — listing search is a Production
operation and the project is Sandbox-only, so it 403s and the overlay falls back to bond
data. That fallback was verified in the browser.

Two things real data exposed:

- **A filter bug that sample data hid.** Sample areas had every bedroom count, so a missing
  figure never arose. Real data is sparse — 413 of 478 NSW postcodes have no studio median
  — and `rentFor()` fell through to the 2-bed figure, showing Eastlakes at $1000 under a
  Studio filter. A missing segment now reads as missing and the area drops off the map.
- **Bedrooms and dwelling type are separate medians**, so neither answers "2-bed
  apartment". `rentdata.js` carries the two crossed (`x:{"2a":820}`), shown at the top of
  the popup so it does not look like it contradicts the breakdown below.

Still NSW + VIC only. Every other state runs its own bond board with its own format; the
NT has no bond board at all, so national means one adapter per state.

---

## Gotchas worth remembering

- **A tile provider can fail without failing.** CARTO returned HTTP 200, `image/png`,
  correct size — with "API KEY REQUIRED" printed on the image. Nothing in code can detect
  that. **If the map ever looks wrong, screenshot it before debugging code.** Esri needs no
  key today, but the same thing could happen to it.

- **`npx` vs `npx.cmd`**, and **prompts need a real TTY** — see [Redeploying](#redeploying).

- **KV writes take a few seconds to propagate.** An immediate repeat request can still
  report `X-Moovin-Cache: MISS`. That is eventual consistency, not a caching bug — the same
  request read `HIT` about 12 seconds later.

- **Grid-snapping boundaries.** Two coordinates a couple of hundred metres apart can land
  in different cells and both miss. Expected at `GRID = 0.003`, not a fault.

- **Orphaned `wrangler dev` processes on Windows.** Killing the port's PID is not enough —
  the parent respawns `workerd` children, and a second instance can bind the same port
  while requests route to the dead one. Kill by command line, not port:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
    Where-Object { $_.CommandLine -match 'wrangler|@cloudflare\\workerd' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```

- **Browser caching of `config.js`** silently invalidated a test run once — the page kept
  using an old key long after the file changed. Serve on a fresh port for a clean cache.

- **Local dev secrets** go in `worker/.dev.vars` (`GEOAPIFY_KEY=…`), gitignored. It was
  deleted at the end of the 08-17 session; recreate it if you go back to `wrangler dev`.

---

## Verification log

**Against the live endpoint (2026-08-30):** happy path — 3 features, MultiPolygon,
`X-Moovin-Mode: transit`. Cache MISS then HIT. Grid snapping collapsing nearby coords onto
one entry. All validation rejections (out of bbox, non-numeric lat/lon, missing range,
too many ranges, out-of-bounds range). 404 on wrong path, 405 on POST. Melbourne accepted,
Brisbane rejected.

**Rate limiting, finally verified in production.** It could never be tested locally —
Cloudflare's rate-limit binding always reports success under `wrangler dev`. Against the
live URL, 25 rapid requests at distinct grid cells returned **exactly 20 x 200 and 5 x 429**.

**In the browser (2026-08-30):** a page with *no keys in it at all*, served from a copy with
`config.js` removed, booted straight to "Live data · shared key" and rendered real
transit-shaped isochrones through the Worker. No key UI anywhere; searching the rendered
page for "api key" returns nothing. Esri basemap: 72 tiles, 0 broken, upscales past z16.

**Fallback behaviour (2026-08-29, stubbed proxy):** all four failure modes fall back cleanly
with the station layer restored — 400 and 429 raise a toast, 500 and network failure stay
silent. Keyless with no proxy gives 146 station zones and the approximate chip. Both popup
types open. Melbourne plus the rent overlay (64 markers) renders clean.

**Earlier (2026-08-17), against a real Geoapify call:** cache HIT on repeat, reordered range
values sharing a cache entry, CORS preflight, and origin allow/deny.
