// Every city Moovin knows about.
//
// This is the seam for going Australia-wide: adding a city should be an entry here plus
// its two datasets, never a per-city branch inside app.js. Anything Sydney-specific that
// used to sit as a constant at the top of app.js lives here instead.
//
// The first entry is the default, and is what a link with no city in it resolves to — so
// reordering this list changes what a bare visit opens on.
const CITIES = [
  {
    id: "sydney",
    name: "Sydney",

    // The anchor the built-in station times are measured to. Station datasets record
    // "minutes to the CBD core", so this point and that dataset have to agree.
    cbd: {name: "Sydney CBD (Town Hall)", lat: -33.8734, lon: 151.2070},

    // Opening view. Deliberately not the same as cbd: the CBD sits at the edge of the
    // metro area, so framing on it alone wastes half the screen on ocean.
    view: {lat: -33.8730, lon: 151.2069, zoom: 12},

    // IANA zone, not a fixed offset — half the country doesn't observe daylight saving
    // and two of the zones are on the half hour.
    tz: "Australia/Sydney",

    // Greater metro, roughly. Used to keep the isochrone proxy from being repurposed as a
    // free global API, and to sanity-check geocoded rent areas against the right city.
    bbox: {minLat: -34.30, maxLat: -33.30, minLon: 150.30, maxLon: 151.60},

    // A thunk, not the array: the station files are plain top-level consts loaded by
    // their own script tags, and a thunk means this file doesn't care what order they
    // load in or whether an optional one is present at all.
    stations: () => (typeof STATIONS !== "undefined" ? STATIONS : []),

    // Which entry in rentals.js's provider registry serves this city.
    rent: "nswbonds",
  },

  {
    id: "melbourne",
    name: "Melbourne",

    // Flinders Street rather than the town hall: it's the anchor the station dataset
    // measures to, and the one people picture when they say "the city".
    cbd: {name: "Melbourne CBD (Flinders Street)", lat: -37.8183, lon: 144.9670},
    view: {lat: -37.8180, lon: 144.9700, zoom: 12},
    tz: "Australia/Melbourne",

    // Wide enough for Werribee, Sunbury, Pakenham and the Mornington Peninsula, all of
    // which have stops inside a 60 minute band. Kept in step with the same box in
    // tools/build-stations.py and worker/wrangler.toml.
    bbox: {minLat: -38.50, maxLat: -37.40, minLon: 144.30, maxLon: 145.60},

    stations: () => (typeof STATIONS_MEL !== "undefined" ? STATIONS_MEL : []),

    rent: "vicbonds",
  },
];

const DEFAULT_CITY = CITIES[0];

function cityById(id){
  return CITIES.find(c => c.id === id) || null;
}
