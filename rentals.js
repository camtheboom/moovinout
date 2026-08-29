// Rent overlay for Moovin.
//
// Loaded after app.js: it builds on the map that file creates, and the site works
// perfectly well without this file present.
//
// Everything here is arranged around one seam — `RENT_PROVIDERS`. A provider takes
// filters and returns RentArea records; nothing downstream knows or cares where they
// came from. Swapping sample data for live Domain listings is a change to one function.
//
//   RentArea = {
//     id, name, postcode,
//     lat, lon,                     // where the marker goes
//     byBed:  {0,1,2,3,4},          // median weekly rent, may be partial; 0 = studio, 4 = 4+
//     byType: {apartment,house,townhouse},
//     count,                        // how many observations sit behind the medians
//     sample                        // true = illustrative figures, must be labelled
//   }

// ======================= filter state =======================
const rentFilters = {
  min: null,          // weekly $, null = unbounded
  max: null,
  beds: "any",        // "any" | "1".."4"
  type: "any",        // "any" | apartment | house | townhouse
  withinBands: true,  // only show suburbs the isochrones actually reach
};

let rentOn = false;
let rentAreas = [];
const rentLayer = L.layerGroup();

// ======================= sample data =======================
// Suburb centroids are real. The rent figures are NOT — they exist so the layer can be
// built and reviewed before a Domain key exists, and every surface that shows them says
// so. Presenting invented rents as real would be worse than showing nothing.
const SAMPLE_AREAS = [
  {postcode:"2000", name:"Sydney CBD",     lat:-33.8708, lon:151.2073, base:780},
  {postcode:"2007", name:"Ultimo",         lat:-33.8790, lon:151.1970, base:720},
  {postcode:"2008", name:"Newtown",        lat:-33.8983, lon:151.1790, base:700},
  {postcode:"2010", name:"Surry Hills",    lat:-33.8845, lon:151.2119, base:790},
  {postcode:"2015", name:"Alexandria",     lat:-33.9010, lon:151.1950, base:720},
  {postcode:"2016", name:"Redfern",        lat:-33.8925, lon:151.2040, base:730},
  {postcode:"2017", name:"Waterloo",       lat:-33.9010, lon:151.2090, base:740},
  {postcode:"2020", name:"Mascot",         lat:-33.9280, lon:151.1890, base:690},
  {postcode:"2021", name:"Paddington",     lat:-33.8850, lon:151.2270, base:850},
  {postcode:"2026", name:"Bondi",          lat:-33.8915, lon:151.2767, base:880},
  {postcode:"2031", name:"Randwick",       lat:-33.9145, lon:151.2410, base:780},
  {postcode:"2033", name:"Kensington",     lat:-33.9110, lon:151.2230, base:740},
  {postcode:"2037", name:"Glebe",          lat:-33.8790, lon:151.1860, base:760},
  {postcode:"2040", name:"Leichhardt",     lat:-33.8830, lon:151.1560, base:700},
  {postcode:"2041", name:"Balmain",        lat:-33.8570, lon:151.1800, base:820},
  {postcode:"2042", name:"Enmore",         lat:-33.9020, lon:151.1740, base:690},
  {postcode:"2044", name:"Tempe",          lat:-33.9240, lon:151.1590, base:650},
  {postcode:"2045", name:"Haberfield",     lat:-33.8800, lon:151.1400, base:680},
  {postcode:"2046", name:"Five Dock",      lat:-33.8690, lon:151.1290, base:670},
  {postcode:"2048", name:"Stanmore",       lat:-33.8960, lon:151.1640, base:700},
  {postcode:"2049", name:"Petersham",      lat:-33.8960, lon:151.1540, base:670},
  {postcode:"2050", name:"Camperdown",     lat:-33.8890, lon:151.1770, base:710},
  {postcode:"2060", name:"North Sydney",   lat:-33.8390, lon:151.2070, base:800},
  {postcode:"2061", name:"Kirribilli",     lat:-33.8480, lon:151.2130, base:820},
  {postcode:"2065", name:"St Leonards",    lat:-33.8230, lon:151.1950, base:760},
  {postcode:"2066", name:"Lane Cove",      lat:-33.8140, lon:151.1690, base:730},
  {postcode:"2067", name:"Chatswood",      lat:-33.7969, lon:151.1836, base:740},
  {postcode:"2088", name:"Mosman",         lat:-33.8290, lon:151.2430, base:880},
  {postcode:"2090", name:"Cremorne",       lat:-33.8290, lon:151.2270, base:800},
  {postcode:"2093", name:"Freshwater",     lat:-33.7780, lon:151.2870, base:800},
  {postcode:"2095", name:"Manly",          lat:-33.7970, lon:151.2870, base:870},
  {postcode:"2110", name:"Hunters Hill",   lat:-33.8330, lon:151.1450, base:790},
  {postcode:"2111", name:"Gladesville",    lat:-33.8330, lon:151.1290, base:690},
  {postcode:"2114", name:"West Ryde",      lat:-33.8070, lon:151.0910, base:640},
  {postcode:"2131", name:"Ashfield",       lat:-33.8890, lon:151.1250, base:620},
  {postcode:"2132", name:"Croydon",        lat:-33.8830, lon:151.1140, base:630},
  {postcode:"2134", name:"Burwood",        lat:-33.8770, lon:151.1040, base:650},
  {postcode:"2135", name:"Strathfield",    lat:-33.8730, lon:151.0950, base:660},
  {postcode:"2137", name:"Concord",        lat:-33.8530, lon:151.1030, base:670},
  {postcode:"2140", name:"Homebush",       lat:-33.8650, lon:151.0840, base:640},
  {postcode:"2141", name:"Lidcombe",       lat:-33.8650, lon:151.0430, base:590},
  {postcode:"2142", name:"Granville",      lat:-33.8330, lon:151.0100, base:550},
  {postcode:"2150", name:"Parramatta",     lat:-33.8150, lon:151.0000, base:620},
  {postcode:"2170", name:"Liverpool",      lat:-33.9200, lon:150.9230, base:520},
  {postcode:"2193", name:"Canterbury",     lat:-33.9110, lon:151.1180, base:580},
  {postcode:"2204", name:"Marrickville",   lat:-33.9110, lon:151.1550, base:670},
  {postcode:"2205", name:"Arncliffe",      lat:-33.9370, lon:151.1470, base:600},
  {postcode:"2216", name:"Rockdale",       lat:-33.9520, lon:151.1370, base:590},
  {postcode:"2217", name:"Kogarah",        lat:-33.9640, lon:151.1340, base:600},
  {postcode:"2218", name:"Carlton",        lat:-33.9700, lon:151.1210, base:570},
];

// Deterministic spread per bedroom count / dwelling type, so the sample layer looks
// plausible and is stable between reloads rather than jittering on every render.
const BED_FACTOR  = {1: 0.72, 2: 1.00, 3: 1.34, 4: 1.68};
const TYPE_FACTOR = {apartment: 0.94, townhouse: 1.12, house: 1.28};

function sampleAreas(){
  return SAMPLE_AREAS.map(a => {
    const byBed = {}, byType = {}, byBedType = {};
    for(const [b, f] of Object.entries(BED_FACTOR)) byBed[b] = Math.round(a.base * f / 5) * 5;
    for(const [t, f] of Object.entries(TYPE_FACTOR)) byType[t] = Math.round(a.base * f / 5) * 5;
    for(const [b, bf] of Object.entries(BED_FACTOR)){
      for(const [t, tf] of Object.entries(TYPE_FACTOR)){
        byBedType[b + t[0]] = Math.round(a.base * bf * tf / 5) * 5;
      }
    }
    return {
      id: "pc" + a.postcode, postcode: a.postcode, name: a.name,
      lat: a.lat, lon: a.lon, byBed, byType, byBedType, count: 0, sample: true,
    };
  });
}

// ======================= providers =======================
// Each returns RentArea[]. This is the seam: add a provider, register it, done.
const RENT_PROVIDERS = {
  async sample(){ return sampleAreas(); },

  // NSW Fair Trading rental bond lodgements, pre-aggregated into rentdata.js by
  // tools/build-rent-data.py. Every residential bond lodged in NSW is recorded, so
  // these are rents tenants actually agreed to rather than asking prices — and being
  // a bundled static file it needs no key, no proxy and no quota, which is why it is
  // the default. The trade-off is age: it is a rolling 12-month window refreshed only
  // when someone re-runs the build script, not a live feed.
  async nswbonds(){
    if(typeof NSW_RENT_DATA === "undefined") throw new Error("rentdata.js is not loaded.");
    return NSW_RENT_DATA.areas.map(a => ({
      id: "pc" + a.pc, postcode: a.pc, name: a.n,
      lat: a.lat, lon: a.lon,
      byBed: a.bed, byType: a.type, byBedType: a.x,
      count: a.c, sample: false,
    }));
  },

  // Victorian Rental Report figures, pre-aggregated into rentdata-vic.js by
  // tools/build-rent-data-vic.py. Same bond-based idea as NSW and the same licence, but
  // DFFH publishes finished medians rather than per-bond rows, and its geography is its
  // own named suburb groups rather than postcodes — hence no postcode field, and
  // derived:true on the bedroom and type figures, which are blends rather than published
  // medians. See the header of rentdata-vic.js.
  async vicbonds(){
    if(typeof VIC_RENT_DATA === "undefined") throw new Error("rentdata-vic.js is not loaded.");
    return VIC_RENT_DATA.areas.map(a => ({
      id: "vic" + a.n, postcode: "", name: a.n,
      lat: a.lat, lon: a.lon,
      byBed: a.bed, byType: a.type, byBedType: a.x, overall: a.all,
      count: a.c, sample: false, derived: true,
    }));
  },

  // UNVERIFIED — written against Domain's documented residential search but never run,
  // because it needs a key this project doesn't have yet. Two things may still bite:
  //   1. CORS. If Domain doesn't send permissive headers the browser blocks this outright,
  //      and the call has to move behind worker/ instead. The seam is here precisely so
  //      that move doesn't touch anything else.
  //   2. Quota. The free "innovation" tier is small; every pan would otherwise re-query,
  //      so results are cached per rounded viewport below.
  async domain(filters, bounds){
    const key = (typeof MOOVIN_CONFIG !== "undefined" && MOOVIN_CONFIG.domainApiKey) || "";
    if(!key) throw new Error("No Domain API key configured.");

    const body = {
      listingType: "Rent",
      pageSize: 100,
      propertyTypes: filters.type === "any" ? undefined : [domainType(filters.type)],
      minBedrooms: filters.beds === "any" ? undefined : Number(filters.beds),
      maxBedrooms: filters.beds === "4" ? undefined : (filters.beds === "any" ? undefined : Number(filters.beds)),
      minPrice: filters.min ?? undefined,
      maxPrice: filters.max ?? undefined,
      geoWindow: {box: {
        topLeft:     {lat: bounds.getNorth(), lon: bounds.getWest()},
        bottomRight: {lat: bounds.getSouth(), lon: bounds.getEast()},
      }},
    };

    const res = await fetch("https://api.domain.com.au/v1/listings/residential/_search", {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-Api-Key": key},
      body: JSON.stringify(body),
    });
    if(res.status === 401 || res.status === 403) throw new Error("Domain rejected the API key.");
    if(res.status === 429) throw new Error("Domain rate limit reached — try again shortly.");
    if(!res.ok) throw new Error("Domain API error (" + res.status + ").");
    return groupDomainListings(await res.json());
  },
};

function domainType(t){
  return {apartment: "ApartmentUnitFlat", house: "House", townhouse: "Townhouse"}[t] || t;
}

// Domain returns individual listings; this layer is per-suburb, so they're grouped by
// postcode and reduced to medians — the same shape the sample provider produces.
function groupDomainListings(json){
  const groups = new Map();
  for(const item of (Array.isArray(json) ? json : [])){
    const l = item && item.listing;
    if(!l || !l.propertyDetails) continue;
    const d = l.propertyDetails;
    const price = Number(l.priceDetails && l.priceDetails.price);
    if(!Number.isFinite(price) || price <= 0) continue;
    if(!d.postcode || !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) continue;

    if(!groups.has(d.postcode)){
      groups.set(d.postcode, {
        id: "pc" + d.postcode, postcode: d.postcode,
        name: d.suburb || d.postcode,
        lats: [], lons: [], beds: {}, types: {}, cross: {}, all: [],
      });
    }
    const g = groups.get(d.postcode);
    g.lats.push(d.latitude); g.lons.push(d.longitude); g.all.push(price);
    // 0 is a real bucket, not a missing value — it is how a studio is expressed here and
    // in the bond data, so both providers bucket bedrooms the same way.
    const b = Number.isFinite(d.bedrooms) ? Math.min(4, Math.max(0, Math.round(d.bedrooms))) : null;
    if(b != null){ (g.beds[b] = g.beds[b] || []).push(price); }
    const t = {ApartmentUnitFlat:"apartment", House:"house", Townhouse:"townhouse"}[d.propertyType];
    if(t){ (g.types[t] = g.types[t] || []).push(price); }
    if(b != null && t){ (g.cross[b + t[0]] = g.cross[b + t[0]] || []).push(price); }
  }

  return [...groups.values()].map(g => ({
    id: g.id, postcode: g.postcode, name: g.name,
    lat: avg(g.lats), lon: avg(g.lons),
    byBed:  mapValues(g.beds,  median),
    byType: mapValues(g.types, median),
    byBedType: mapValues(g.cross, median),
    count: g.all.length,
    sample: false,
  }));
}

const avg = a => a.reduce((s, n) => s + n, 0) / a.length;
const mapValues = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
function median(nums){
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

// ======================= filtering =======================
// The headline number for an area, given the current bedroom/type filter, or null when
// this area cannot answer the question being asked — visibleAreas() then drops it.
//
// Returning null matters. Real bond data is sparse: 413 of 478 postcodes have no studio
// median at all, so an earlier version that fell through to the 2-bed figure labelled
// Eastlakes as a $1000 studio. A missing segment has to read as missing, not as some
// other segment's rent.
function rentFor(area){
  const {beds, type} = rentFilters;
  // Bedrooms and dwelling type are separate medians over the same bonds, so neither can
  // stand in for both. Only the crossed figure answers "2-bed apartment".
  if(beds !== "any" && type !== "any"){
    const crossed = area.byBedType && area.byBedType[beds + type[0]];
    return crossed != null ? crossed : null;
  }
  if(beds !== "any") return area.byBed[beds] != null ? area.byBed[beds] : null;
  if(type !== "any") return area.byType[type] != null ? area.byType[type] : null;
  // Victoria publishes a real all-properties median; prefer it over inferring one.
  if(area.overall != null) return area.overall;
  if(area.byBed[2] != null) return area.byBed[2];           // 2-bed is the usual reference point
  const vals = Object.values(area.byBed).concat(Object.values(area.byType));
  return vals.length ? median(vals) : null;
}

// Is this point inside any rendered isochrone band? Leaflet has no public point-in-polygon,
// so this walks the rings directly with a standard ray cast.
function insideBands(lat, lon){
  const layers = isoLayer.getLayers();
  if(!layers.length) return true;              // nothing drawn yet — don't hide everything
  for(const poly of layers){
    if(typeof poly.getLatLngs !== "function") continue;
    for(const ring of flattenRings(poly.getLatLngs())){
      if(pointInRing(lat, lon, ring)) return true;
    }
  }
  return false;
}

function flattenRings(latlngs){
  const out = [];
  (function walk(node){
    if(!Array.isArray(node)) return;
    if(node.length && node[0] && typeof node[0].lat === "number") out.push(node);
    else node.forEach(walk);
  })(latlngs);
  return out;
}

function pointInRing(lat, lon, ring){
  let inside = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
    if(((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function visibleAreas(){
  return rentAreas.filter(a => {
    const rent = rentFor(a);
    if(rent == null) return false;
    if(rentFilters.min != null && rent < rentFilters.min) return false;
    if(rentFilters.max != null && rent > rentFilters.max) return false;
    if(rentFilters.withinBands && !insideBands(a.lat, a.lon)) return false;
    return true;
  });
}

// ======================= rendering =======================
// Colour runs cheap→dear. Thresholds are absolute rather than relative to the visible set,
// so a suburb doesn't change colour just because you filtered its neighbours away.
// Breakpoints are the quintiles of the headline rent across Sydney postcodes in the bond
// data (625 / 720 / 840 / 950), rounded. Sydney is the right thing to anchor on because it
// is what the site is for; anchoring on all of NSW would paint the whole commutable area red.
//
// Even so the inner suburbs skew red, because within half an hour of the CBD nothing is
// cheap — that is the finding, not a scale problem. Green appears as the time budget grows,
// which is exactly the trade the map exists to show.
const RENT_COLORS = [
  {max: 625, color: "#1a9850"},
  {max: 725, color: "#7cb342"},
  {max: 850, color: "#f59e0b"},
  {max: 950, color: "#f4703a"},
  {max: Infinity, color: "#e5484d"},
];
const rentColor = v => RENT_COLORS.find(c => v <= c.max).color;

function rentMarker(area, rent){
  const html =
    '<div class="rentpin" style="background:' + rentColor(rent) + '">$' + rent + '</div>';
  return L.divIcon({className: "", html, iconSize: [48, 20], iconAnchor: [24, 10]});
}

const BED_LABEL = {"0": "Studio", "1": "1 bed", "2": "2 bed", "3": "3 bed", "4": "4+ bed"};

function rentPopupHtml(area){
  const rows = [];
  for(const b of ["0", "1", "2", "3", "4"]){
    if(area.byBed[b] != null){
      rows.push('<div class="rrow"><span>' + BED_LABEL[b] +
                '</span><b>$' + area.byBed[b] + '</b></div>');
    }
  }
  for(const t of ["apartment", "townhouse", "house"]){
    if(area.byType[t] != null){
      rows.push('<div class="rrow"><span>' + t[0].toUpperCase() + t.slice(1) +
                '</span><b>$' + area.byType[t] + '</b></div>');
    }
  }
  // escapeHtml comes from app.js — suburb names arrive from an API on the Domain path.
  const title = (typeof escapeHtml === "function" ? escapeHtml : String)(area.name);
  const unit = rentProvider === "domain" ? " listings · median weekly"
                                        : " bonds lodged · median weekly rent";
  const note = area.sample
    ? '<div class="rsample">Sample figure — not real rent data</div>'
    : '<div class="meta">' + area.count + unit + "</div>";

  // With both filters set the marker shows the crossed figure, which appears in neither
  // list below — so state it, or the pin looks like it disagrees with its own popup.
  const bothSet = rentFilters.beds !== "any" && rentFilters.type !== "any";
  // Same problem one step along: on derived data a bedroom-only or type-only figure is a
  // blend of the published cells rather than one of the rows below, so it gets the same
  // callout, worded so it doesn't read as a published median.
  const oneSet = !bothSet && (rentFilters.beds !== "any" || rentFilters.type !== "any");
  let combined = "";
  if(bothSet){
    combined = '<div class="rrow rcombined"><span>' + BED_LABEL[rentFilters.beds].toLowerCase() +
      " " + rentFilters.type + '</span><b>$' + rentFor(area) + "</b></div>";
  }else if(oneSet && area.derived){
    const label = rentFilters.beds !== "any" ? BED_LABEL[rentFilters.beds].toLowerCase()
                                             : rentFilters.type;
    combined = '<div class="rrow rcombined"><span>' + label + ' · combined</span><b>$' +
      rentFor(area) + "</b></div>";
  }

  // Victoria publishes only the crossing, so everything in the breakdown is a blend.
  // Saying so once beats footnoting six rows.
  const derivedNote = area.derived
    ? '<div class="rderived">Bedroom and dwelling figures are combined from the published ' +
      'flat and house medians — Victoria publishes only the two crossed.</div>'
    : "";

  return '<div class="pn">' + title + (area.postcode ? " " + area.postcode : "") + "</div>" +
         note + '<div class="rtable">' + combined + rows.join("") + "</div>" + derivedNote +
         '<button class="setdest" onclick="setDestination(' + area.lat + "," + area.lon +
         ',&quot;' + title.replace(/"/g, "") + '&quot;)">Set as destination</button>';
}

function renderRentals(){
  rentLayer.clearLayers();
  const countEl = document.getElementById("rentCount");
  if(!rentOn){
    countEl.textContent = "";
    document.getElementById("rentActive").textContent = "";
    return;
  }

  const areas = visibleAreas();
  for(const area of areas){
    const rent = rentFor(area);
    L.marker([area.lat, area.lon], {icon: rentMarker(area, rent), zIndexOffset: 500})
      .bindPopup(rentPopupHtml(area))
      .addTo(rentLayer);
  }

  countEl.textContent = " · " + areas.length;
  document.getElementById("rentActive").textContent = describeFilters();
}

function describeFilters(){
  const bits = [];
  if(rentFilters.min != null || rentFilters.max != null){
    bits.push("$" + (rentFilters.min ?? 0) + "–" + (rentFilters.max != null ? rentFilters.max : "∞"));
  }
  if(rentFilters.beds !== "any") bits.push(BED_LABEL[rentFilters.beds]);
  if(rentFilters.type !== "any") bits.push(rentFilters.type);
  if(rentFilters.withinBands) bits.push("within bands");
  return bits.join(" · ");
}

// ======================= loading =======================
// Bumped on every load. A provider call is async, so switching city mid-flight would
// otherwise let the old city's response land after the new city's and win.
let rentLoadSeq = 0;
let rentProvider = "sample";     // which provider produced what is currently in rentAreas

// Each state ships its own bundled file, so "is there bond data" is a per-city question.
const BOND_DATA = {
  nswbonds: () => typeof NSW_RENT_DATA !== "undefined",
  vicbonds: () => typeof VIC_RENT_DATA !== "undefined",
};
const hasBondData = () => !!(BOND_DATA[city.rent] && BOND_DATA[city.rent]());

// A Domain key is an explicit opt-in to live asking prices, so it wins where present.
// Otherwise the bundled bond data, and sample figures only if that file is missing too.
//
// The active city has the first say. Rent data is per-state - every state runs its own
// bond board - so a city with no source wired up shows nothing and says so, rather than
// borrowing another state's figures onto its map.
function preferredProvider(){
  if(!city.rent) return null;
  if(typeof MOOVIN_CONFIG !== "undefined" && MOOVIN_CONFIG.domainApiKey) return "domain";
  return hasBondData() ? city.rent : "sample";
}

// One line under the checkbox saying where the numbers came from. Rent figures are the
// kind of thing people act on, so the layer never shows a number without its provenance.
function describeSource(){
  if(!rentProvider) return "No rent data for " + city.name + " yet — NSW and VIC so far.";
  if(rentProvider === "domain") return "Domain listings · asking rents";
  if(rentProvider === "nswbonds"){
    return "NSW Fair Trading bonds · " + NSW_RENT_DATA.months + " months to " +
           monthLabel(NSW_RENT_DATA.to);
  }
  if(rentProvider === "vicbonds"){
    return "Victorian RTBA bonds · " + VIC_RENT_DATA.months + " months to " + VIC_RENT_DATA.to;
  }
  return "";
}

function monthLabel(ym){
  const [y, m] = String(ym).split("-").map(Number);
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] + " " + y;
}

async function loadRentals(){
  const seq = ++rentLoadSeq;
  const wanted = preferredProvider();
  if(!wanted){
    rentAreas = [];
    rentProvider = null;
    document.getElementById("rentSampleWarn").style.display = "none";
    document.getElementById("rentSource").textContent = describeSource();
    renderRentals();
    return;
  }
  let areas, provider;
  try{
    areas = await RENT_PROVIDERS[wanted](rentFilters, map.getBounds());
    provider = wanted;
  }catch(err){
    // Live lookup failed: fall back rather than leaving the layer empty, and say why.
    // Bond data is real and already in the page, so it beats sample figures as a net.
    provider = (city.rent && hasBondData()) ? city.rent : "sample";
    areas = await RENT_PROVIDERS[provider]();
    if(seq === rentLoadSeq){
      toast("Rent data unavailable (" + err.message + ") — showing " +
            (provider === "sample" ? "sample figures." : "bond data."));
    }
  }
  // A newer load started while this one was in flight — its answer is the current one.
  if(seq !== rentLoadSeq) return;
  rentAreas = areas;
  rentProvider = provider;
  document.getElementById("rentSampleWarn").style.display =
    rentAreas.some(a => a.sample) ? "block" : "none";
  document.getElementById("rentSource").textContent = describeSource();
  renderRentals();
}

// Rent figures are per-state, so whatever is loaded is invalid the moment the city
// changes. app.js calls this if it's defined.
function onCityChanged(){
  rentAreas = [];
  rentProvider = "sample";
  if(rentOn) loadRentals();
  else renderRentals();
}

// ======================= UI wiring =======================
document.getElementById("showRent").addEventListener("change", async e => {
  rentOn = e.target.checked;
  if(rentOn){
    map.addLayer(rentLayer);
    if(!rentAreas.length) await loadRentals(); else renderRentals();
  }else{
    map.removeLayer(rentLayer);
    renderRentals();
  }
});

const rentOverlay = document.getElementById("rentOverlay");
document.getElementById("rentFiltersBtn").addEventListener("click", () => {
  document.getElementById("rentMin").value = rentFilters.min ?? "";
  document.getElementById("rentMax").value = rentFilters.max ?? "";
  document.getElementById("rentWithinBands").checked = rentFilters.withinBands;
  setToggle("rentBeds", "b", rentFilters.beds);
  setToggle("rentTypes", "t", rentFilters.type);
  document.getElementById("rentErr").style.display = "none";
  rentOverlay.classList.add("show");
});
rentOverlay.addEventListener("click", e => { if(e.target === rentOverlay) rentOverlay.classList.remove("show"); });

function setToggle(groupId, attr, value){
  for(const b of document.getElementById(groupId).children){
    b.classList.toggle("on", b.dataset[attr] === value);
  }
}
function wireToggle(groupId, attr, onPick){
  document.getElementById(groupId).addEventListener("click", e => {
    const btn = e.target.closest("button");
    if(!btn) return;
    setToggle(groupId, attr, btn.dataset[attr]);
    onPick(btn.dataset[attr]);
  });
}
wireToggle("rentBeds", "b", () => {});
wireToggle("rentTypes", "t", () => {});

document.getElementById("rentApply").addEventListener("click", async () => {
  const errEl = document.getElementById("rentErr");
  const rawMin = document.getElementById("rentMin").value.trim();
  const rawMax = document.getElementById("rentMax").value.trim();
  const min = rawMin === "" ? null : Number(rawMin);
  const max = rawMax === "" ? null : Number(rawMax);

  if((min != null && (!Number.isFinite(min) || min < 0)) ||
     (max != null && (!Number.isFinite(max) || max < 0))){
    errEl.textContent = "Rent values must be positive numbers.";
    errEl.style.display = "block"; return;
  }
  if(min != null && max != null && min > max){
    errEl.textContent = "Minimum rent is above the maximum.";
    errEl.style.display = "block"; return;
  }

  rentFilters.min = min;
  rentFilters.max = max;
  rentFilters.beds = document.querySelector("#rentBeds .on").dataset.b;
  rentFilters.type = document.querySelector("#rentTypes .on").dataset.t;
  rentFilters.withinBands = document.getElementById("rentWithinBands").checked;
  rentOverlay.classList.remove("show");

  if(!rentOn){
    document.getElementById("showRent").checked = true;
    rentOn = true;
    map.addLayer(rentLayer);
  }
  // Only Domain builds the filters into its query, so only Domain needs a refetch.
  // The bond and sample sets are complete datasets already in the page, filtered locally.
  if(rentAreas.length && rentProvider !== "domain") renderRentals(); else await loadRentals();
});

document.getElementById("rentReset").addEventListener("click", () => {
  rentFilters.min = rentFilters.max = null;
  rentFilters.beds = rentFilters.type = "any";
  rentFilters.withinBands = true;
  document.getElementById("rentMin").value = "";
  document.getElementById("rentMax").value = "";
  document.getElementById("rentWithinBands").checked = true;
  setToggle("rentBeds", "b", "any");
  setToggle("rentTypes", "t", "any");
  document.getElementById("rentErr").style.display = "none";
});

// Bands moving changes which suburbs qualify under "only inside my travel-time bands".
map.on("moveend", () => { if(rentOn && rentFilters.withinBands) renderRentals(); });
