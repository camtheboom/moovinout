// Copy this file to config.js and fill in your own keys.
// config.js is gitignored so your keys never get committed or pushed.
//
// If you leave config.js out entirely (or leave these blank), Moovin still
// works — it falls back to the built-in approximate station data, and you
// can paste a key into the in-app "API setup" panel for that browser tab
// instead.

const MOOVIN_CONFIG = {
  // Isochrone proxy (worker/) — overrides DEFAULT_API_BASE in index.html for
  // local testing, e.g. "http://127.0.0.1:8787". Not a secret: the deployed
  // value belongs in index.html so it ships with the site.
  apiBase: "",

  // You only need one provider. If both are filled in, TravelTime wins.

  // TravelTime — most accurate: real timetables, and the only one whose shapes
  // change with the "Arrive by" picker. Signup asks for a business name; your
  // own name or project name generally works. https://account.traveltime.com/signup
  travelTimeAppId: "",
  travelTimeApiKey: "",

  // Geoapify — easiest signup (email only, no card, ~3,000 credits/day). Transit
  // shapes are partly modelled and don't vary by time of day.
  // https://myprojects.geoapify.com/
  geoapifyKey: "",

  // Domain — OPTIONAL, and most people should leave this blank. The rent overlay
  // already shows real figures with no key at all, from the NSW Fair Trading bond
  // data bundled in rentdata.js. Setting a key here swaps that for live Domain
  // listings, which is a different measure: asking prices rather than the rents
  // tenants actually agreed to.
  //
  // Free "innovation" tier at https://developer.domain.com.au/. Note that listing
  // search needs a Production-environment package — a fresh project is provisioned
  // Sandbox-only and returns 403 until you add one. If the call fails the overlay
  // falls back to the bond data. See the rent section in README.md.
  domainApiKey: "",
};
