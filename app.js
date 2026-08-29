// ======================= config =======================
const CFG = (typeof MOOVIN_CONFIG !== "undefined") ? MOOVIN_CONFIG : {};
const BAKED_APP_ID = CFG.travelTimeAppId || "";
const BAKED_API_KEY = CFG.travelTimeApiKey || "";
const BAKED_GEOAPIFY_KEY = CFG.geoapifyKey || "";

// Deployed isochrone proxy (worker/). This is how visitors get live data: the
// Worker holds the provider key, so the browser never sees one and is never asked
// for one. The URL is public by design, so unlike the keys above it belongs in
// the committed file rather than the gitignored config.js.
//
// Left "" the site has no path to live data at all and every visitor gets the
// built-in approximate bands — so filling this in is the deploy step that matters.
const DEFAULT_API_BASE = "https://moovin-api.cameron-02e.workers.dev";
const API_BASE = String(CFG.apiBase || DEFAULT_API_BASE).trim().replace(/\/+$/, "");

const BANDS = [
  {max:10, color:"#1a9850"},
  {max:20, color:"#f59e0b"},
  {max:30, color:"#e5484d"},
  {max:40, color:"#c026d3"},
  {max:50, color:"#7c3aed"},
  {max:60, color:"#4338ca"},
];
const MODE_LABEL = {train:"Train", metro:"Metro", lightrail:"Light rail", tram:"Tram", ferry:"Ferry", bus:"Bus"};
// Melbourne trams stop every couple of hundred metres, so their catchment is much
// tighter than Sydney light rail even though the mode is nearly the same thing.
const MODE_RADIUS = {train:950, metro:950, lightrail:650, tram:450, ferry:700, bus:600};
const WALK_M_PER_MIN = 80;

// ======================= state =======================
// Fixed at boot and never changed afterwards. Visitors don't bring a key and can't
// be asked for one, so the only question is which of the site's own paths is available:
// the proxy when it's deployed (the production answer — the key stays on the Worker),
// otherwise the keys a developer put in their gitignored config.js, TravelTime first
// because it reads real timetables. With none of them, the built-in data carries the map.
const creds = {
  provider: API_BASE ? "proxy"
    : ((BAKED_APP_ID && BAKED_API_KEY) ? "traveltime" : "geoapify"),
  appId: BAKED_APP_ID, apiKey: BAKED_API_KEY, gaKey: BAKED_GEOAPIFY_KEY
};
// Active city. Everything that used to be a Sydney constant is read off this, so the
// only Sydney-specific thing left in this file is that Sydney happens to be first in
// the registry.
let city = DEFAULT_CITY;
let stations = city.stations();
let dest = {...city.cbd};
let maxMin = 30;
let picking = false;
let liveMode = false;           // true once API works
const isoCache = new Map();     // key -> {shapes, ts}; see the isochrone cache section

// ======================= map =======================
const map = L.map("map", {zoomControl:false, preferCanvas:true})
  .setView([city.view.lat, city.view.lon], city.view.zoom);
// ======================= recenter control =======================
// Declared up here because onAdd runs during addControl, below.
let recenterBtn = null;
let atHome = true;          // true while the map already sits where recenter would put it

function setAtHome(on){
  atHome = on;
  if(recenterBtn) recenterBtn.classList.toggle("off", on);
}

// The bands are the thing worth framing; without them the destination alone will do.
// layerGroup has no getBounds, so the extent is accumulated by hand. Cached rather than
// recomputed, because the check below runs on every frame of a drag.
let homeB = null;
function updateHome(){
  let b = null;
  isoLayer.eachLayer(l => {
    if(typeof l.getBounds !== "function") return;
    const lb = l.getBounds();
    if(lb && lb.isValid()) b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
  });
  homeB = b;
}

const HOME_PAD = 60;                    // px of breathing room left around the bands
// fitBounds sums its two padding edges when picking a zoom, so the "are we already
// there?" check has to pass the same total or it targets a different zoom and never matches.
const HOME_PAD_SUM = L.point(HOME_PAD * 2, HOME_PAD * 2);

// Whether the map is already framed the way recenter would frame it. Derived from the
// current view rather than remembered, because Leaflet fires zoomstart *after* moveend
// on a fitBounds — so anything that tracks movement events un-sets itself.
function viewIsHome(){
  if(!homeB) return map.getBounds().contains([dest.lat, dest.lon]);
  // "Fully framed at the zoom recenter would pick" rather than "centred on the midpoint":
  // fitBounds centres in projected space, so it lands just off the geographic centre and
  // a distance test never quite matches. This asks the question the user can actually see.
  return map.getZoom() === map.getBoundsZoom(homeB, false, HOME_PAD_SUM) &&
         map.getBounds().contains(homeB);
}

function recenter(){
  if(atHome) return;
  // No explicit animate option: left to itself Leaflet eases short moves and cuts long
  // ones, which is the behaviour you want. Forcing animate:true makes it refuse the long
  // jumps instead of falling back to a straight cut.
  if(homeB) map.fitBounds(homeB, {padding:[HOME_PAD, HOME_PAD]});
  else map.setView([dest.lat, dest.lon], 12);
}

// Recomputed on every one of these rather than forced true/false by any single one:
// Leaflet can emit a trailing movestart *after* moveend, which would otherwise clobber
// the state the settle just worked out.
map.on("movestart move moveend zoomstart zoom zoomend", () => setAtHome(viewIsHome()));

// Leaflet inserts into *bottom* corners in reverse, so this is added after the zoom
// control in order to sit above it — the way map apps conventionally order these.
const RecenterControl = L.Control.extend({
  options: {position: "bottomright"},
  onAdd(){
    const wrap = L.DomUtil.create("div", "leaflet-bar recenter");
    const a = L.DomUtil.create("a", "", wrap);
    a.href = "#";
    a.title = "Recenter on destination";
    a.setAttribute("role", "button");
    a.setAttribute("aria-label", "Recenter on destination");
    a.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 1.8v3.4M12 18.8v3.4' +
      'M22.2 12h-3.4M5.2 12H1.8"/></svg>';
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.on(a, "click", L.DomEvent.stop);
    L.DomEvent.on(a, "click", recenter);
    recenterBtn = a;
    a.classList.toggle("off", atHome);
    return wrap;
  }
});
L.control.zoom({position:"bottomright"}).addTo(map);
map.addControl(new RecenterControl());
// Basemap. This was CARTO's light_all until CARTO put their tiles behind a key —
// they didn't start failing, they started returning a valid 200 PNG stamped
// "API KEY REQUIRED", so it looked like an app error plastered over every tile.
// Esri's Light Gray Canvas is the keyless equivalent: same job, same muted palette,
// nothing to sign up for, so a deployed copy can never regress to that state.
//
// Real tiles stop at z16; maxNativeZoom lets Leaflet upscale rather than go blank
// past that, which matters because the zoom control still goes to 19.
const ESRI_CANVAS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
const ESRI_MAX_NATIVE = 16;
const ATTRIB = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  'isochrones by <a href="https://traveltime.com">TravelTime</a> / ' +
  '<a href="https://www.geoapify.com">Geoapify</a>';

L.tileLayer(ESRI_CANVAS + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  attribution: ATTRIB, maxZoom: 19, maxNativeZoom: ESRI_MAX_NATIVE
}).addTo(map);

// Esri ships place names as a separate transparent overlay, which turns out to be an
// improvement rather than a chore: on its own pane above the overlay pane, suburb
// labels stay readable *through* the travel-time bands instead of being buried under
// them. pointerEvents:none keeps click-to-set-destination working across the map.
map.createPane("labels");
map.getPane("labels").style.zIndex = 450;
map.getPane("labels").style.pointerEvents = "none";
L.tileLayer(ESRI_CANVAS + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19, maxNativeZoom: ESRI_MAX_NATIVE, pane: "labels"
}).addTo(map);

const isoLayer = L.layerGroup().addTo(map);
const stationLayer = L.layerGroup();

const destIcon = L.divIcon({className:"", html:'<div style="width:20px;height:20px;border-radius:50%;background:#0b6e4f;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4)"></div>', iconSize:[20,20], iconAnchor:[10,10]});
const destMarker = L.marker([dest.lat, dest.lon], {icon:destIcon, zIndexOffset:1000}).addTo(map);

// ======================= helpers =======================
function bandOf(t){ return BANDS.find(b => t <= b.max) || BANDS[BANDS.length-1]; }
function toast(msg, ms=4200){
  const el = document.getElementById("toast");
  el.textContent = msg; el.style.display = "block";
  clearTimeout(el._t); el._t = setTimeout(() => el.style.display = "none", ms);
}
function spinner(on){ document.getElementById("spinner").classList.toggle("show", !!on); }
function haversine(a, b, c, d){
  const R = 6371000, toR = x => x*Math.PI/180;
  const h = Math.sin(toR(c-a)/2)**2 + Math.cos(toR(a))*Math.cos(toR(c))*Math.sin(toR(d-b)/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

// Local UTC offset for an IANA zone at a given instant, in minutes.
//
// This used to be hand-rolled AEDT/AEST rules. Intl already ships every Australian
// daylight-saving rule, so going national is a table lookup rather than eight more sets
// of rules — including the three states that don't observe DST at all (QLD, WA, NT) and
// the two zones that sit on the half hour (Adelaide, Darwin).
//
// Read the instant as wall-clock in the target zone, reinterpret those components as if
// they were UTC, and the difference is the offset. Done this way rather than via
// timeZoneName:"longOffset" because the parts form works on older engines too.
function zoneOffsetMinutes(d, tz){
  const parts = {};
  for(const {type, value} of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d)) parts[type] = value;
  // hour12:false renders midnight as "24" on some engines.
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
                         +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUTC - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

// "+11:00", "+09:30". Minutes rather than whole hours because Adelaide and Darwin are
// half an hour off and the old whole-hour formatting would have emitted "+9:00" for them.
function offsetLabel(mins){
  const a = Math.abs(mins);
  return (mins < 0 ? "-" : "+") +
         String(Math.floor(a / 60)).padStart(2, "0") + ":" +
         String(a % 60).padStart(2, "0");
}

function nextArrivalISO(sel){
  // returns an ISO string with an explicit offset for the active city, on the next
  // matching day
  const now = new Date();
  const wantSat = sel.startsWith("sa");
  const hh = +sel.slice(2,4), mm = +sel.slice(4,6);
  for(let i = 1; i <= 8; i++){
    const cand = new Date(now.getTime() + i*86400000);
    const dow = cand.getUTCDay();
    const ok = wantSat ? dow === 6 : (dow >= 2 && dow <= 4); // prefer Tue-Thu for typical weekday
    if(!ok) continue;
    const y = cand.getUTCFullYear(), mo = String(cand.getUTCMonth()+1).padStart(2,"0"), da = String(cand.getUTCDate()).padStart(2,"0");
    // The offset wanted is the one in force at the arrival itself, not the one in force
    // now — those differ across a DST boundary. Probe at roughly the target instant
    // (any Australian zone is within a couple of hours of +10, and transitions happen at
    // 2am local, so a rough probe lands on the correct side of one).
    const probe = new Date(Date.UTC(y, cand.getUTCMonth(), cand.getUTCDate(), hh - 10, mm));
    const off = offsetLabel(zoneOffsetMinutes(probe, city.tz));
    return `${y}-${mo}-${da}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00${off}`;
  }
}

// ======================= isochrone cache =======================
// Two tiers over one Map: the Map is the session cache, and it's mirrored into
// localStorage so a reload doesn't re-spend API quota on the same lookups. Every
// provider call is metered, so a cache hit is real money saved, not just latency.
const ISO_KEY = "moovin.iso.v1";
const ISO_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // a week; transit networks don't move fast
const ISO_MAX_ENTRIES = 12;                   // shapes are big and localStorage is ~5 MB

// Coordinates land with far more precision than a map needs. 5 dp is ~1 m, and the
// rounding roughly halves what gets written.
const r5 = n => Math.round(n * 1e5) / 1e5;
function compactShapes(shapes){
  const out = {};
  for(const [level, list] of Object.entries(shapes)){
    out[level] = list.map(s => ({
      shell: s.shell.map(p => ({lat: r5(p.lat), lng: r5(p.lng)})),
      holes: (s.holes || []).map(h => h.map(p => ({lat: r5(p.lat), lng: r5(p.lng)}))),
    }));
  }
  return out;
}

function loadIsoCache(){
  let raw;
  try{ raw = localStorage.getItem(ISO_KEY); }catch{ return; }   // private mode, etc.
  if(!raw) return;
  try{
    const cutoff = Date.now() - ISO_TTL_MS;
    for(const [key, entry] of Object.entries(JSON.parse(raw) || {})){
      if(entry && entry.ts > cutoff && entry.shapes) isoCache.set(key, entry);
    }
  }catch{ /* corrupt or from an older shape — just start empty */ }
}

function persistIsoCache(){
  // Newest first, then truncated: the cap is an eviction policy, not just a size guard.
  const entries = [...isoCache.entries()].sort((a, b) => b[1].ts - a[1].ts);
  for(let n = Math.min(entries.length, ISO_MAX_ENTRIES); n > 0; n--){
    const obj = {};
    for(const [key, e] of entries.slice(0, n)) obj[key] = {ts: e.ts, shapes: compactShapes(e.shapes)};
    try{ localStorage.setItem(ISO_KEY, JSON.stringify(obj)); return; }
    catch{ /* over quota — drop the oldest entry and try again */ }
  }
  try{ localStorage.removeItem(ISO_KEY); }catch{}
}


// ======================= isochrone providers =======================
function isoCacheKey(arriveSel, levels){
  return [creds.provider, dest.lat.toFixed(5), dest.lon.toFixed(5),
          creds.provider === "traveltime" ? arriveSel : "-", levels.join(",")].join("|");
}

async function fetchIsochrones(){
  const arriveSel = document.getElementById("arriveSel").value;
  const levels = BANDS.map(b => b.max).filter(m => m <= maxMin);
  const key = isoCacheKey(arriveSel, levels);
  const hit = isoCache.get(key);
  if(hit) return hit.shapes;
  const shapes = creds.provider === "proxy" ? await fetchProxy(levels)
    : creds.provider === "geoapify" ? await fetchGeoapify(levels)
    : await fetchTravelTime(levels, arriveSel);
  isoCache.set(key, {shapes, ts: Date.now()});
  persistIsoCache();
  return shapes;
}

// Shared-key path: the Worker holds the provider key, picks transit vs
// approximated_transit, and caches — so from here it's one plain request.
async function fetchProxy(levels){
  const url = API_BASE + "/isochrone?lat=" + dest.lat.toFixed(5) +
    "&lon=" + dest.lon.toFixed(5) + "&range=" + levels.map(m => m*60).join(",");
  const res = await fetch(url);
  if(!res.ok){
    let msg = "Shared travel-time service error (" + res.status + ")";
    try{ const j = await res.json(); if(j.error) msg = j.error; }catch(e){}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return geojsonToShapes(await res.json());
}

async function fetchGeoapify(levels){
  async function call(mode){
    const url = "https://api.geoapify.com/v1/isoline?lat=" + dest.lat + "&lon=" + dest.lon +
      "&type=time&mode=" + mode + "&range=" + levels.map(m => m*60).join(",") +
      "&apiKey=" + encodeURIComponent(creds.gaKey);
    const res = await fetch(url);
    if(!res.ok){
      let msg = "Geoapify API error (" + res.status + ")";
      try{ const j = await res.json(); if(j.message) msg += ": " + j.message; }catch(e){}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.json();
  }
  let data;
  try{ data = await call("transit"); }
  catch(err){
    if(err.status && err.status !== 401 && err.status !== 403){
      data = await call("approximated_transit"); // transit not covered here — fall back
    } else throw err;
  }
  if(!data.features || !data.features.length){
    data = await call("approximated_transit");
  }
  return geojsonToShapes(data);
}

// convert GeoJSON ([lon,lat]) to internal shape format keyed by minutes
function geojsonToShapes(data){
  const shapes = {};
  for(const f of (data.features || [])){
    const mins = Math.round((f.properties.range || 0) / 60);
    const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    shapes[mins] = shapes[mins] || [];
    for(const rings of polys){
      shapes[mins].push({
        shell: rings[0].map(c => ({lat: c[1], lng: c[0]})),
        holes: rings.slice(1).map(r => r.map(c => ({lat: c[1], lng: c[0]}))),
      });
    }
  }
  return shapes;
}

async function fetchTravelTime(levels, arriveSel){
  const arrival = nextArrivalISO(arriveSel);
  const body = {
    arrival_searches: levels.map(m => ({
      id: "band" + m,
      coords: {lat: dest.lat, lng: dest.lon},
      transportation: {type: "public_transport"},
      arrival_time: arrival,
      travel_time: m * 60,
    }))
  };
  const res = await fetch("https://api.traveltimeapp.com/v4/time-map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Application-Id": creds.appId,
      "X-Api-Key": creds.apiKey,
    },
    body: JSON.stringify(body),
  });
  if(!res.ok){
    let msg = "TravelTime API error (" + res.status + ")";
    try{ const j = await res.json(); if(j.description) msg += ": " + j.description; }catch(e){}
    throw new Error(msg);
  }
  const data = await res.json();
  const shapes = {};
  for(const r of data.results) shapes[+r.search_id.replace("band","")] = r.shapes;
  return shapes;
}

// drop vertices closer than ~35 m to the previous kept one — big perf win, no visible change
function simplifyRing(pts){
  if(pts.length < 80) return pts;
  const EPS = 0.00035;
  const out = [pts[0]];
  let last = pts[0];
  for(let i = 1; i < pts.length; i++){
    const p = pts[i];
    if(Math.abs(p.lat - last.lat) + Math.abs(p.lng - last.lng) > EPS){ out.push(p); last = p; }
  }
  return out.length >= 4 ? out : pts;
}

function renderIsochrones(shapes){
  isoLayer.clearLayers();
  const levels = Object.keys(shapes).map(Number).sort((a,b) => b - a); // big first (bottom)
  for(let i = 0; i < levels.length; i++){
    const m = levels[i];
    const inner = levels[i+1];               // next smaller band, punched out as a hole
    const band = bandOf(m);
    // multipolygon: this band's shapes (+ their holes), plus the inner band's shells
    // as extra rings — Leaflet's default evenodd fill rule subtracts them, so each
    // band renders as a pure-colour ring instead of stacking translucent fills.
    const multi = shapes[m].map(s => {
      const rings = [simplifyRing(s.shell).map(p => [p.lat, p.lng])];
      for(const hole of (s.holes || [])) rings.push(simplifyRing(hole).map(p => [p.lat, p.lng]));
      return rings;
    });
    if(inner !== undefined){
      for(const s of shapes[inner]) multi.push([simplifyRing(s.shell).map(p => [p.lat, p.lng])]);
    }
    L.polygon(multi, {
      color: band.color, weight: 1.2, opacity: .55, fillRule: "evenodd",
      fillColor: band.color, fillOpacity: .32, interactive: false,
    }).addTo(isoLayer);
  }
  updateHome();              // new bands mean a new frame to snap back to
  setAtHome(viewIsHome());
  // rentals.js filters suburbs against these bands; optional dependency, may be absent.
  if(typeof renderRentals === "function") renderRentals();
}

async function refreshLive(){
  if(!liveMode) return;
  spinner(true);
  try{
    const shapes = await fetchIsochrones();
    renderIsochrones(shapes);
  }catch(err){
    // Dropping to the built-in data is the whole point of having it, so an outage,
    // a quota wall or a flaky network just changes the badge and says nothing. A 4xx
    // is different: it means this particular request was wrong (a destination outside
    // the covered area, or too many lookups too fast), which the visitor can act on.
    console.warn("Live travel-time request failed:", err);
    if(err.status >= 400 && err.status < 500) toast(err.message);
    setLiveMode(false);
  }finally{
    spinner(false);
  }
}

// ======================= built-in fallback =======================
function stationTimeTo(s){
  // station time to custom destination: time to CBD + estimated hop from CBD to dest (crow-fly at 30km/h PT)
  const dCbd = haversine(dest.lat, dest.lon, city.cbd.lat, city.cbd.lon);
  if(dCbd < 1200) return s.t;
  const hop = Math.round(dCbd / 500); // ~30 km/h
  return s.t + hop;
}
function popupHtml(s){
  const t = stationTimeTo(s);
  const b = bandOf(t);
  const walk = Math.round(MODE_RADIUS[s.m] / WALK_M_PER_MIN);
  const q = s.n.replace(/'/g, "\\'");
  return `<span class="pn">${s.n}</span><br>
    <span class="badge" style="background:${b.color}">≈ ${t} min to ${escapeHtml(dest.name)}</span>
    <div class="meta">${MODE_LABEL[s.m]} · door-to-door roughly ${t + Math.round(walk/2)}–${t + walk} min incl. walk</div>
    <div class="popactions">
      <button class="setdest" onclick="setDestination(${s.lat}, ${s.lon}, '${q}')">Set as destination</button>
      <button class="setdest" onclick="saveSpot(${s.lat}, ${s.lon}, '${q}')">Save spot</button>
    </div>`;
}
function renderStations(){
  stationLayer.clearLayers();
  const sorted = [...stations].map(s => ({...s, tt: stationTimeTo(s)})).sort((a,b) => b.tt - a.tt);
  for(const s of sorted){
    if(s.tt > maxMin) continue;
    const b = bandOf(s.tt);
    L.circle([s.lat, s.lon], {
      radius: MODE_RADIUS[s.m],
      color: b.color, weight: 1, opacity: .5,
      fillColor: b.color, fillOpacity: .30,
    }).addTo(stationLayer).bindPopup(popupHtml(s));
  }
}

// ======================= saved spots =======================
// Per-browser only, on purpose: no account, no server, nothing leaves the device.
// Records are deliberately plain {id,label,lat,lon} so that syncing them to a
// backend later is a matter of POSTing the array, not reshaping it.
const SAVED_KEY = "moovin.saved.v1";
const savedLayer = L.layerGroup().addTo(map);
let savedSpots = loadSaved();

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c =>
    ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
}

function loadSaved(){
  try{
    const data = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    const list = Array.isArray(data) ? data : (data.spots || []);   // tolerate a bare array too
    return list
      .filter(s => s && Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map(s => ({id: s.id || uid(), label: String(s.label || "Saved spot"), lat: s.lat, lon: s.lon}));
  }catch(err){
    return [];   // corrupt entry, or storage blocked (private mode) — start empty, don't break boot
  }
}
function persistSaved(){
  try{ localStorage.setItem(SAVED_KEY, JSON.stringify({v:1, spots:savedSpots})); }
  catch(err){ toast("Couldn't save — this browser's storage is full or blocked."); }
}

// Nearest-station estimate for an arbitrary point. Same maths the click popup
// already used, pulled out so saved spots can score themselves against the
// current destination too.
function estimateAt(lat, lon){
  let best = null, bestTotal = Infinity;
  for(const s of stations){
    const d = haversine(lat, lon, s.lat, s.lon);
    if(d > 2500) continue;
    const total = stationTimeTo(s) + d / WALK_M_PER_MIN;
    if(total < bestTotal){ bestTotal = total; best = {s, d}; }
  }
  if(!best) return null;
  const walkMin = Math.round(best.d / WALK_M_PER_MIN);
  const rideMin = stationTimeTo(best.s);
  return {station: best.s, walkMin, rideMin, total: rideMin + walkMin};
}

function saveSpot(lat, lon, label){
  const dupe = savedSpots.find(s => haversine(s.lat, s.lon, lat, lon) < 60);
  if(dupe){ toast(`Already saved here as “${dupe.label}”.`); return; }
  if(!label){
    const est = estimateAt(lat, lon);
    label = est ? "Near " + est.station.n : lat.toFixed(3) + ", " + lon.toFixed(3);
  }
  savedSpots.push({id: uid(), label, lat, lon});
  persistSaved();
  renderSaved();
  map.closePopup();
  toast(`Saved “${label}” — kept in this browser only.`);
}
function removeSpot(id){
  savedSpots = savedSpots.filter(s => s.id !== id);
  persistSaved(); renderSaved(); map.closePopup();
}
function renameSpot(id, label){
  const spot = savedSpots.find(s => s.id === id);
  const clean = label.trim().slice(0, 60);
  if(spot && clean && clean !== spot.label){ spot.label = clean; persistSaved(); }
  renderSaved();
}
// Popup handlers are inline, so hand them only the id — never user-entered text.
window.saveSpot = saveSpot;
window.removeSpot = removeSpot;
window.destFromSaved = function(id){
  const s = savedSpots.find(x => x.id === id);
  if(s) setDestination(s.lat, s.lon, s.label);
};

function savedIcon(color){
  return L.divIcon({
    className: "",
    html: `<div style="width:15px;height:15px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)"></div>`,
    iconSize: [15,15], iconAnchor: [7.5,7.5],
  });
}
function savedPopupHtml(spot){
  const est = estimateAt(spot.lat, spot.lon);
  const body = est
    ? `<span class="badge" style="background:${bandOf(est.total).color}">≈ ${est.total} min to ${escapeHtml(dest.name)}</span>
       <div class="meta">${est.walkMin} min walk + ${est.rideMin} min ride via ${escapeHtml(est.station.n)}</div>`
    : `<div class="meta">No built-in stop within 2.5 km, so there's no estimate for this one.</div>`;
  return `<span class="pn">${escapeHtml(spot.label)}</span><br>${body}
    <div class="popactions">
      <button class="setdest" onclick="destFromSaved('${spot.id}')">Set as destination</button>
      <button class="setdest" onclick="removeSpot('${spot.id}')">Remove</button>
    </div>`;
}

function renderSaved(){
  savedLayer.clearLayers();
  const listEl = document.getElementById("savedList");
  listEl.innerHTML = "";
  document.getElementById("savedCount").textContent = savedSpots.length ? " · " + savedSpots.length : "";

  if(!savedSpots.length){
    const empty = document.createElement("div");
    empty.className = "saved-empty";
    empty.textContent = "None yet — click anywhere on the map, or open a station, then hit “Save spot”.";
    listEl.appendChild(empty);
    return;
  }

  // best commute first; unreachable ones sink to the bottom
  const scored = savedSpots.map(spot => ({spot, est: estimateAt(spot.lat, spot.lon)}));
  scored.sort((a, b) => (a.est ? a.est.total : Infinity) - (b.est ? b.est.total : Infinity));

  for(const {spot, est} of scored){
    const color = est ? bandOf(est.total).color : "#94a3b8";
    L.marker([spot.lat, spot.lon], {icon: savedIcon(color)})
      .addTo(savedLayer).bindPopup(savedPopupHtml(spot));

    const row = document.createElement("div");
    row.className = "row";

    const lbl = document.createElement("button");
    lbl.className = "lbl";
    lbl.textContent = spot.label;               // textContent, not innerHTML — labels are user-entered
    lbl.title = "Zoom to " + spot.label;
    lbl.addEventListener("click", () => {
      map.flyTo([spot.lat, spot.lon], 14, {duration:.8});
      L.popup().setLatLng([spot.lat, spot.lon]).setContent(savedPopupHtml(spot)).openOn(map);
    });

    const badge = document.createElement("span");
    badge.className = "t";
    badge.style.background = color;
    badge.textContent = est ? est.total + "m" : "—";

    const ren = document.createElement("button");
    ren.className = "ico"; ren.title = "Rename";
    ren.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>`;
    ren.addEventListener("click", () => startRename(row, lbl, spot));

    const del = document.createElement("button");
    del.className = "ico"; del.title = "Remove";
    del.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    del.addEventListener("click", () => removeSpot(spot.id));

    row.append(lbl, badge, ren, del);
    listEl.appendChild(row);
  }
}

function startRename(row, lbl, spot){
  const input = document.createElement("input");
  input.className = "rename";
  input.value = spot.label;
  input.maxLength = 60;
  row.replaceChild(input, lbl);
  input.focus(); input.select();
  let settled = false;
  const commit = keep => {
    if(settled) return;
    settled = true;
    if(keep) renameSpot(spot.id, input.value); else renderSaved();
  };
  input.addEventListener("keydown", e => {
    if(e.key === "Enter") commit(true);
    if(e.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
}

// ======================= mode switching =======================
function setLiveMode(on){
  liveMode = on;
  const ds = document.getElementById("datasource");
  ds.classList.toggle("live", on);
  ds.classList.toggle("approx", !on);
  document.getElementById("dslabel").textContent = on
    ? (creds.provider === "proxy" ? "Live data · shared key"
      : creds.provider === "geoapify" ? "Live Geoapify data" : "Live TravelTime data")
    : "Approximate built-in data";
  const arriveSel = document.getElementById("arriveSel");
  // only TravelTime varies by time of day; the proxy is Geoapify underneath
  arriveSel.disabled = on && creds.provider !== "traveltime";
  arriveSel.title = arriveSel.disabled ? "Geoapify isochrones don't vary by time of day" : "";
  document.getElementById("hintExtra").style.display = on ? "none" : "inline";
  const cb = document.getElementById("showStations");
  if(on){
    cb.checked = false;                       // isochrones replace station circles
    if(map.hasLayer(stationLayer)) map.removeLayer(stationLayer);
    refreshLive();
  }else{
    isoLayer.clearLayers();
    updateHome();                             // bands are gone; recenter falls back to the pin
    setAtHome(viewIsHome());
    cb.checked = true;
    if(!map.hasLayer(stationLayer)) map.addLayer(stationLayer);
    renderStations();
  }
}

// ======================= city =======================
// The state half of a city switch, with no rendering. Split out because the picker and
// an incoming shared link both need it but re-render on different schedules — the link
// applies a destination on top of this, and boot renders once at the end either way.
function applyCity(next){
  city = next;
  stations = city.stations();
  dest = {...city.cbd};
  document.getElementById("cityTag").textContent = "· " + city.name;
  destMarker.setLatLng([dest.lat, dest.lon]);
  document.getElementById("destName").textContent = dest.name;
  const sel = document.getElementById("citySel");
  if(sel) sel.value = city.id;
  map.setView([city.view.lat, city.view.lon], city.view.zoom);
}

// Switching city is a bigger move than switching destination: the station dataset, the
// CBD the built-in times are measured to, and the framing all change together. The
// destination resets to the new city's CBD rather than being carried across, because a
// Sydney address is not a meaningful destination on a Melbourne map.
function setCity(id){
  const next = cityById(id);
  if(!next || next === city) return;
  map.closePopup();
  applyCity(next);
  renderStations();
  renderSaved();
  refreshLive();
  // rentals.js defines this when it's loaded; typeof so app.js doesn't depend on it.
  if(typeof onCityChanged === "function") onCityChanged(city);
  syncShareUrl();
}

function renderCityPicker(){
  const sel = document.getElementById("citySel");
  sel.innerHTML = "";
  for(const c of CITIES){
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
  sel.value = city.id;
  // One city is not a choice. Hidden rather than disabled so a single-city build looks
  // exactly like it did before there was a registry at all.
  document.getElementById("citySection").style.display = CITIES.length > 1 ? "" : "none";
}

document.getElementById("citySel").addEventListener("change", e => setCity(e.target.value));

// ======================= destination =======================
function setDestination(lat, lon, name){
  dest = {lat, lon, name: name || (lat.toFixed(3) + ", " + lon.toFixed(3))};
  destMarker.setLatLng([lat, lon]);
  document.getElementById("destName").textContent = dest.name;
  map.closePopup();
  setAtHome(viewIsHome());   // the target moved, so recenter likely has somewhere to go
  renderStations();
  renderSaved();      // saved-spot times are relative to the destination
  refreshLive();
  syncShareUrl();
}
window.setDestination = setDestination;

document.getElementById("pickDest").addEventListener("click", () => {
  picking = true;
  document.getElementById("pickingNote").style.display = "block";
  document.getElementById("map").style.cursor = "crosshair";
});

// ======================= UI wiring =======================
function renderLegend(){
  const el = document.getElementById("legend");
  el.innerHTML = "";
  let prev = 0;
  for(const b of BANDS){
    if(b.max > maxMin) break;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="sw" style="background:${b.color}"></span> ${prev} – ${b.max} min`;
    el.appendChild(row);
    prev = b.max;
  }
}

const slider = document.getElementById("slider");
slider.addEventListener("change", () => {
  maxMin = +slider.value;
  document.getElementById("maxmin").textContent = "≤ " + maxMin + " min";
  renderLegend(); renderStations(); refreshLive(); syncShareUrl();
});
slider.addEventListener("input", () => {
  document.getElementById("maxmin").textContent = "≤ " + slider.value + " min";
});

document.getElementById("arriveSel").addEventListener("change", () => { refreshLive(); syncShareUrl(); });

document.getElementById("showStations").addEventListener("change", e => {
  if(e.target.checked){ map.addLayer(stationLayer); renderStations(); }
  else if(liveMode){ map.removeLayer(stationLayer); }
  else { e.target.checked = true; toast("Station zones stay on while using built-in data."); }
});

// search
const searchEl = document.getElementById("search");
const suggestEl = document.getElementById("suggest");
searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  suggestEl.innerHTML = "";
  if(q.length < 2){ suggestEl.style.display = "none"; return; }
  const hits = stations.filter(s => s.n.toLowerCase().includes(q)).sort((a,b) => a.t - b.t).slice(0, 8);
  if(!hits.length){ suggestEl.style.display = "none"; return; }
  for(const s of hits){
    const t = stationTimeTo(s);
    const b = bandOf(t);
    const btn = document.createElement("button");
    btn.innerHTML = `<span>${s.n} <span style="color:var(--muted);font-size:11px">· ${MODE_LABEL[s.m]}</span></span><span class="t" style="background:${b.color}">${t}m</span>`;
    btn.addEventListener("click", () => {
      suggestEl.style.display = "none"; searchEl.value = s.n;
      map.flyTo([s.lat, s.lon], 14, {duration:.8});
      L.popup().setLatLng([s.lat, s.lon]).setContent(popupHtml(s)).openOn(map);
    });
    suggestEl.appendChild(btn);
  }
  suggestEl.style.display = "block";
});
document.addEventListener("click", e => { if(!e.target.closest(".searchwrap")) suggestEl.style.display = "none"; });

// map click: destination picking or estimator
map.on("click", e => {
  if(picking){
    picking = false;
    document.getElementById("pickingNote").style.display = "none";
    document.getElementById("map").style.cursor = "";
    setDestination(e.latlng.lat, e.latlng.lng, "Custom pin (" + e.latlng.lat.toFixed(3) + ", " + e.latlng.lng.toFixed(3) + ")");
    return;
  }
  const est = estimateAt(e.latlng.lat, e.latlng.lng);
  if(!est) return;
  const b = bandOf(est.total);
  L.popup().setLatLng(e.latlng).setContent(
    `<span class="pn">≈ ${est.total} min to ${escapeHtml(dest.name)}</span><br>
     <span class="badge" style="background:${b.color}">${est.walkMin} min walk + ${est.rideMin} min ride</span>
     <div class="meta">via ${escapeHtml(est.station.n)} (${MODE_LABEL[est.station.m]}) · rough estimate from built-in data</div>
     <div class="popactions">
       <button class="setdest" onclick="saveSpot(${e.latlng.lat}, ${e.latlng.lng})">Save this spot</button>
     </div>`
  ).openOn(map);
});

// mobile collapse
document.getElementById("collapseBtn").addEventListener("click", () => {
  const p = document.getElementById("panel");
  p.classList.toggle("min");
  document.getElementById("collapseBtn").textContent = p.classList.contains("min") ? "+" : "–";
});

// ======================= shareable links =======================
// State lives in the hash rather than the query string so it costs no server config on
// any static host, and so changing it never triggers a navigation.
const ARRIVE_VALUES = [...document.getElementById("arriveSel").options].map(o => o.value);
const MAX_NAME_LEN = 80;

function shareUrl(){
  const p = new URLSearchParams({
    lat: dest.lat.toFixed(5),
    lon: dest.lon.toFixed(5),
    max: String(maxMin),
    arrive: document.getElementById("arriveSel").value,
  });
  // Omitted while Sydney is the only city, so a single-city build emits exactly the
  // links it always did and old links keep resolving.
  if(CITIES.length > 1) p.set("city", city.id);
  if(dest.name) p.set("name", dest.name.slice(0, MAX_NAME_LEN));
  return location.origin + location.pathname + "#" + p.toString();
}

// Rewrites the address bar in place, so whatever is on screen is always what a copied
// URL would reproduce. replaceState rather than pushState: panning around the map
// shouldn't bury the back button under a hundred history entries.
function syncShareUrl(){
  try{ history.replaceState(null, "", shareUrl()); }catch{}
}

// Everything here is attacker-controllable — it arrives in a link someone was sent — so
// each field is range-checked and nothing is trusted to be the right type or shape.
function applyShareUrl(){
  if(!location.hash || location.hash.length < 2) return;
  const p = new URLSearchParams(location.hash.slice(1));

  // City first: it resets the destination, so the destination in the link has to be
  // applied on top of it. An unknown id falls through to the default rather than
  // failing the whole link.
  const wanted = cityById(p.get("city") || "");
  if(wanted && wanted !== city) applyCity(wanted);

  const lat = Number(p.get("lat")), lon = Number(p.get("lon"));
  if(Number.isFinite(lat) && Number.isFinite(lon) &&
     lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180){
    const name = (p.get("name") || "").slice(0, MAX_NAME_LEN).trim();
    dest = {lat, lon, name: name || (lat.toFixed(3) + ", " + lon.toFixed(3))};
    destMarker.setLatLng([lat, lon]);
    document.getElementById("destName").textContent = dest.name;   // textContent, never HTML
    map.setView([lat, lon], map.getZoom());
  }

  // Only the discrete values the slider can actually produce.
  const max = Number(p.get("max"));
  if(BANDS.some(b => b.max === max)){
    maxMin = max;
    document.getElementById("slider").value = String(max);
    document.getElementById("maxmin").textContent = "≤ " + max + " min";
  }

  const arrive = p.get("arrive");
  if(ARRIVE_VALUES.includes(arrive)) document.getElementById("arriveSel").value = arrive;
}

// Pasting a share link into a tab that's already open changes only the hash, which is
// not a navigation — boot never re-runs. Without this the link would appear to do nothing.
// (replaceState doesn't fire this event, so syncShareUrl can't feed back into it.)
window.addEventListener("hashchange", () => {
  if(location.href === shareUrl()) return;
  applyShareUrl();
  renderLegend(); renderStations(); renderSaved(); refreshLive();
});

document.getElementById("shareBtn").addEventListener("click", async () => {
  const url = shareUrl();
  try{
    await navigator.clipboard.writeText(url);
    toast("Link copied — it reopens this destination and time budget.");
  }catch{
    // Clipboard needs a secure context; plain http://<lan-ip> during dev isn't one.
    syncShareUrl();
    toast("Couldn't reach the clipboard — the link is in the address bar, copy it from there.");
  }
});

// ======================= boot =======================
loadIsoCache();       // before the first fetch, so a reload can answer from disk
renderCityPicker();   // before applyShareUrl, which may select a city into it
document.getElementById("cityTag").textContent = "· " + city.name;
applyShareUrl();      // a shared link overrides the defaults above
renderLegend();
map.addLayer(stationLayer);
document.getElementById("showStations").checked = true;
renderStations();
renderSaved();
// Live data is opt-out, not opt-in: if the site has a path to it, take it without
// asking. refreshLive drops back to approximate data on its own if the call fails,
// so the flag is re-checked rather than trusted.
if(API_BASE || (BAKED_APP_ID && BAKED_API_KEY) || BAKED_GEOAPIFY_KEY){
  liveMode = true;
  refreshLive().then(() => { if(liveMode) setLiveMode(true); });
}
