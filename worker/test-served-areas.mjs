// Served-area validation for the isochrone proxy. Runs offline: the upstream fetch is
// stubbed, so this never spends provider quota and needs no key.
//
//   node worker/test-served-areas.mjs

// src/index.js is ES-module syntax but package.json has no "type": "module", so Node
// would read it as CommonJS and choke on the export. Loading it through a data: URL
// forces module semantics without changing how wrangler builds the Worker. It has no
// imports of its own, so nothing needs resolving relative to the original path.
import {readFileSync} from "node:fs";
const src = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");
const worker = (await import("data:text/javascript," + encodeURIComponent(src))).default;

// Nothing may reach Geoapify from a test.
let upstreamCalls = 0;
globalThis.fetch = async () => {
  upstreamCalls++;
  return new Response(JSON.stringify({type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[[151,-33],[151.1,-33],[151.1,-33.1],[151,-33]]]}}]}), {status:200});
};

const ctx = {waitUntil(){}};
async function probe(lat, lon, env){
  const req = new Request(`https://w/isochrone?lat=${lat}&lon=${lon}&range=600`);
  const res = await worker.fetch(req, env, ctx);
  const body = await res.json().catch(()=>({}));
  return res.status === 200 ? "ACCEPT" : `${res.status} ${body.error||""}`.trim();
}

const SYD = [-33.8734, 151.2070], MEL = [-37.8136, 144.9631], BNE = [-27.4698, 153.0251];
const cases = [
  ["unset (must behave exactly as before)", {GEOAPIFY_KEY:"x"}],
  ["sydney only",      {GEOAPIFY_KEY:"x", SERVED_AREAS:"sydney:-34.30,-33.30,150.30,151.60"}],
  ["sydney+melbourne", {GEOAPIFY_KEY:"x", SERVED_AREAS:"sydney:-34.30,-33.30,150.30,151.60; melbourne:-38.50,-37.40,144.30,145.60"}],
  ["one entry malformed, other survives", {GEOAPIFY_KEY:"x", SERVED_AREAS:"broken:not,numbers; melbourne:-38.50,-37.40,144.30,145.60"}],
  ["all malformed -> falls back to built-in", {GEOAPIFY_KEY:"x", SERVED_AREAS:"garbage"}],
  ["bounds given reversed", {GEOAPIFY_KEY:"x", SERVED_AREAS:"melbourne:-37.40,-38.50,145.60,144.30"}],
];
for(const [label, env] of cases){
  const r = [];
  for(const [name, c] of [["Sydney",SYD],["Melbourne",MEL],["Brisbane",BNE]]){
    r.push(`${name}=${await probe(c[0], c[1], env)}`);
  }
  console.log(label.padEnd(40), r.join("  "));
}
console.log("\nupstream calls made:", upstreamCalls, "(stubbed, nothing real was hit)");
