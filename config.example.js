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

  // Geoapify — free, signs up with just an email at https://myprojects.geoapify.com/
  geoapifyKey: "",

  // TravelTime — most accurate (real timetables), but currently requires a
  // company email to sign up: https://account.traveltime.com/signup
  travelTimeAppId: "",
  travelTimeApiKey: "",
};
