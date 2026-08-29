/**
 * Moovin isochrone proxy.
 *
 * Exists so visitors don't need a Geoapify key of their own: the key lives here
 * as a Worker secret and never reaches the browser.
 *
 * The catch is that a shared key means the site owner pays for everyone, so the
 * real job of this Worker is less "forward the request" than "avoid forwarding
 * the request". Incoming coordinates are snapped to a coarse grid before they
 * become a cache key, which collapses everyone poking around the same block
 * onto a single stored response — and since the destinations people actually
 * care about are a short list, most requests never reach the provider at all.
 */

const GEOAPIFY = "https://api.geoapify.com/v1/isoline";

// ~300 m at Sydney's latitude. An isochrone barely moves over that distance,
// so snapping to it costs nothing visually and buys a much higher hit rate.
const GRID = 0.003;

// The areas this endpoint will answer for, as a fallback when SERVED_AREAS is unset.
// Greater Sydney, roughly — the point is to keep the endpoint from being repurposed as a
// free global isochrone API on the owner's credit balance, so it stays deny-by-default.
// Adding a city is a wrangler.toml edit, not a code change; see SERVED_AREAS there.
const DEFAULT_AREAS = [
  {name: "sydney", minLat: -34.30, maxLat: -33.30, minLon: 150.30, maxLon: 151.60},
];

const MAX_RANGES = 8;
const MIN_RANGE_S = 60;
const MAX_RANGE_S = 7200;
const CACHE_TTL_S = 60 * 60 * 24 * 7;   // a week; transit networks don't move fast

export default {
  async fetch(request, env, ctx){
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if(request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors});
    if(request.method !== "GET") return fail(405, "Use GET.", cors);

    const url = new URL(request.url);
    if(!url.pathname.replace(/\/+$/, "").endsWith("/isochrone")) return fail(404, "Not found.", cors);

    // Browsers attach Origin on cross-origin calls; same-origin and curl don't,
    // so an absent Origin is allowed through and only a wrong one is rejected.
    if(origin && !isAllowed(origin, env)) return fail(403, "This origin isn't allowed to use this endpoint.", cors);

    let params;
    try{ params = parseParams(url.searchParams, env); }
    catch(err){ return fail(400, err.message, cors); }

    const cacheKey = `iso:v1:${params.lat}:${params.lon}:${params.ranges.join(",")}`;

    const hit = env.ISO_CACHE ? await env.ISO_CACHE.get(cacheKey) : null;
    if(hit) return new Response(hit, {headers: {...cors, ...okHeaders("HIT")}});

    // Only misses cost anything, so only misses are metered.
    if(env.MISS_LIMIT && typeof env.MISS_LIMIT.limit === "function"){
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const {success} = await env.MISS_LIMIT.limit({key: ip});
      if(!success){
        return fail(429, "Too many new lookups from this address just now. " +
                         "Wait a moment and try again.", cors);
      }
    }

    if(!env.GEOAPIFY_KEY) return fail(500, "This endpoint is missing its provider key.", cors);

    let upstream;
    try{ upstream = await fetchUpstream(params, env.GEOAPIFY_KEY); }
    catch(err){ return fail(502, err.message, cors); }

    if(env.ISO_CACHE){
      ctx.waitUntil(env.ISO_CACHE.put(cacheKey, upstream.body, {expirationTtl: CACHE_TTL_S}));
    }
    return new Response(upstream.body, {headers: {...cors, ...okHeaders("MISS", upstream.mode)}});
  },
};

// ======================= served areas =======================
// "sydney:-34.30,-33.30,150.30,151.60; melbourne:-38.50,-37.40,144.30,145.60"
// — name, then minLat,maxLat,minLon,maxLon. Parsed per request but memoised on the raw
// string, because env is the same object for the life of the isolate.
let areasCache = {raw: null, areas: null};

function servedAreas(env){
  const raw = String(env.SERVED_AREAS || "").trim();
  if(!raw) return DEFAULT_AREAS;
  if(areasCache.raw === raw) return areasCache.areas;

  const areas = [];
  for(const chunk of raw.split(";").map(s => s.trim()).filter(Boolean)){
    const [name, nums] = chunk.includes(":") ? chunk.split(":") : ["area", chunk];
    const n = nums.split(",").map(v => Number(v.trim()));
    // A malformed entry is skipped rather than thrown: a typo in one city should not
    // take the whole endpoint down for the others.
    if(n.length !== 4 || n.some(v => !Number.isFinite(v))) continue;
    areas.push({name: name.trim(), minLat: Math.min(n[0], n[1]), maxLat: Math.max(n[0], n[1]),
                minLon: Math.min(n[2], n[3]), maxLon: Math.max(n[2], n[3])});
  }
  // Every entry malformed is indistinguishable from a broken deploy, so fall back to
  // the built-in area rather than silently serving nowhere.
  const out = areas.length ? areas : DEFAULT_AREAS;
  areasCache = {raw, areas: out};
  return out;
}

const inArea = (a, lat, lon) =>
  lat >= a.minLat && lat <= a.maxLat && lon >= a.minLon && lon <= a.maxLon;

// ======================= request parsing =======================
const snap = v => +(Math.round(v / GRID) * GRID).toFixed(4);

function parseParams(sp, env){
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("lat and lon must be numbers.");
  if(!servedAreas(env).some(a => inArea(a, lat, lon))){
    throw new Error("That destination is outside the area this endpoint covers.");
  }

  // Split before converting: "".split(",") yields [""], and Number("") is 0,
  // so a missing range would otherwise look like a single out-of-bounds value.
  const raw = (sp.get("range") || "").split(",").map(s => s.trim()).filter(Boolean);
  if(!raw.length) throw new Error("range must be a comma-separated list of seconds.");
  const ranges = raw.map(Number);
  if(ranges.some(n => !Number.isFinite(n))) throw new Error("range values must be numbers.");
  if(ranges.length > MAX_RANGES) throw new Error(`At most ${MAX_RANGES} range values.`);
  if(ranges.some(r => r < MIN_RANGE_S || r > MAX_RANGE_S)){
    throw new Error(`Each range must be between ${MIN_RANGE_S} and ${MAX_RANGE_S} seconds.`);
  }

  // Sorted + deduped so that ?range=1800,600 and ?range=600,1800 share a cache entry.
  return {lat: snap(lat), lon: snap(lon), ranges: [...new Set(ranges)].sort((a, b) => a - b)};
}

// ======================= upstream =======================
async function fetchUpstream(params, apiKey){
  // "transit" is timetable-aware but isn't available everywhere; the modelled
  // variant is the fallback. Doing this here rather than in the browser means
  // both attempts happen behind one cache entry.
  for(const mode of ["transit", "approximated_transit"]){
    const u = new URL(GEOAPIFY);
    u.searchParams.set("lat", params.lat);
    u.searchParams.set("lon", params.lon);
    u.searchParams.set("type", "time");
    u.searchParams.set("mode", mode);
    u.searchParams.set("range", params.ranges.join(","));
    u.searchParams.set("apiKey", apiKey);

    const res = await fetch(u, {cf: {cacheTtl: 3600, cacheEverything: true}});
    if(res.status === 401 || res.status === 403) throw new Error("The provider rejected this endpoint's key.");
    if(!res.ok){
      if(mode === "approximated_transit") throw new Error(`Provider error (${res.status}).`);
      continue;
    }

    const body = await res.text();
    let data;
    try{ data = JSON.parse(body); }
    catch{ throw new Error("The provider returned an unreadable response."); }

    // An empty feature list means "no transit coverage here", not "no answer".
    if(!data.features || !data.features.length){
      if(mode === "transit") continue;
      throw new Error("The provider returned no shapes for that destination.");
    }
    return {body, mode};
  }
  throw new Error("The provider returned no usable data for that destination.");
}

// ======================= responses =======================
function allowList(env){
  return String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
}
function isAllowed(origin, env){
  const list = allowList(env);
  return !list.length || list.includes(origin.replace(/\/+$/, ""));   // unset = allow all, for local dev
}
function corsHeaders(origin, env){
  const headers = {"Vary": "Origin"};
  if(origin && isAllowed(origin, env)){
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Max-Age"] = "86400";
    headers["Access-Control-Expose-Headers"] = "X-Moovin-Cache, X-Moovin-Mode";
  }
  return headers;
}
function okHeaders(cacheState, mode){
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    "X-Moovin-Cache": cacheState,
  };
  if(mode) headers["X-Moovin-Mode"] = mode;
  return headers;
}
function fail(status, message, cors){
  return new Response(JSON.stringify({error: message}), {
    status, headers: {...cors, "Content-Type": "application/json; charset=utf-8"},
  });
}
