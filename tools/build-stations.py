#!/usr/bin/env python3
"""Regenerate a city's built-in station dataset from its GTFS feed.

    python tools/build-stations.py melbourne     # writes stations-mel.js

The built-in datasets are the no-API-key fallback: a list of public transport stops
with an approximate off-peak travel time to the CBD, used to draw station zones, to
answer the search box, and to give a click-anywhere estimate. Sydney's stations.js was
hand-compiled. That does not scale to eight capitals, so this derives the same thing
from the published timetable instead - every Australian capital publishes GTFS.

WHAT THIS IS NOT
----------------
This is not a journey planner. A correct minutes-to-CBD needs a timetable router
(RAPTOR or connection scan) over transfers, and that is a much bigger thing to own.
Instead this reads times straight off trips that actually run:

  * direct - a trip that serves both the stop and a CBD stop, measured from departure
    at the stop to arrival in the city.
  * one transfer - for stops no direct trip serves, the best "leg to some station that
    does have a direct time, plus that station's time, plus TRANSFER_PENALTY_MIN".
    Melbourne's Alamein and Stony Point lines are shuttles that never reach the city,
    so without this they would simply be missing from the map.

Anything needing two transfers is left out rather than guessed at. The result is the
same accuracy tier as the hand-compiled Sydney data - good for "roughly how far out is
this", not a substitute for checking a real trip planner before signing a lease.

FEED LAYOUT IS PER-AGENCY
-------------------------
PTV ships one outer zip containing a nested google_transit.zip per mode, numbered by
mode. That is a PTV convention, not a GTFS one. Adding a city whose agency publishes a
single flat zip means writing a sibling of open_ptv_feed() - the rest of this file is
ordinary GTFS and should carry over unchanged.
"""

import collections
import csv
import datetime as dt
import io
import math
import statistics
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"

# Weekday middle of the day. Peak times are dominated by expresses and would flatter the
# outer suburbs; this matches what stations.js already claims to be.
OFF_PEAK = (10 * 3600, 15 * 3600)

# Wait plus walk between platforms. Deliberately blunt - the alternative is modelling
# headways per route, which is most of the way to writing the router this avoids.
TRANSFER_PENALTY_MIN = 5

# A stop needs this many observed off-peak runs before its median is worth reporting.
MIN_RUNS = 4

CITIES = {
    "melbourne": {
        "out": "stations-mel.js",
        "const": "STATIONS_MEL",
        "feed": "https://data.ptv.vic.gov.au/downloads/gtfs.zip",
        "cache": "ptv-gtfs.zip",
        "label": "Melbourne",
        "cbd_label": "Melbourne CBD",
        # PTV mode folders inside the outer zip. Metro bus (4) is left out on purpose:
        # 738 routes, and almost all of them feed a station rather than running to the
        # city, so direct extraction yields little and the file would triple in size.
        # Regional train (1) and coach (5) are outside any sane commute band.
        # mode folder -> (label, whether stops are platforms under a parent station)
        "modes": {"2": ("train", True), "3": ("tram", False)},
        # Stations counted as "the city". The City Loop plus the two Metro Tunnel
        # stations - Cranbourne, Pakenham and Sunbury trains now run through the tunnel
        # and never touch the Loop, so leaving Town Hall and State Library out silently
        # drops three of the busiest lines.
        "rail_cbd": {"FSS", "SSS", "MCE", "PAR", "FGS", "THL", "STL"},
        # The Hoddle grid, for modes whose stops aren't named stations.
        "cbd_box": {"minLat": -37.8210, "maxLat": -37.8055,
                    "minLon": 144.9510, "maxLon": 144.9770},
        # Trams stop every couple of hundred metres. Thinned so the map reads as zones
        # rather than a solid smear, keeping the best-connected stop in each cluster.
        "thin": {"tram": 800},
        "bbox": {"minLat": -38.50, "maxLat": -37.40, "minLon": 144.30, "maxLon": 145.60},
    },
}


def fetch(url, name):
    """Download to the cache, or reuse what is already there."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists() and path.stat().st_size > 0:
        return path
    print("  downloading " + name + " (this one is large)")
    req = urllib.request.Request(url, headers={"User-Agent": "moovin-stations-build"})
    with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return path


def open_ptv_feed(path, mode):
    """One mode's GTFS out of PTV's nested-zip bundle."""
    outer = zipfile.ZipFile(path)
    return zipfile.ZipFile(io.BytesIO(outer.read(mode + "/google_transit.zip")))


def rows(zf, name):
    """Stream a GTFS table without materialising it as one big string."""
    with zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, "utf-8-sig", newline=""))


def secs(hhmmss):
    """GTFS times run past 24:00 for after-midnight trips; that is fine here."""
    h, m, s = hhmmss.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def haversine(a, b, c, d):
    R = 6371000.0
    p, q = math.radians(a), math.radians(c)
    dp, dq = math.radians(c - a), math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p) * math.cos(q) * math.sin(dq / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def weekday_services(zf, ref):
    """Service ids running on a plain midweek day.

    PTV splits the working week - Mon-Thu, Fri and one-off disruption calendars are all
    separate service ids, and none of them has all five weekday flags set. So this asks
    for one specific weekday rather than for "a weekday service".
    """
    out = set()
    for c in rows(zf, "calendar.txt"):
        start = dt.datetime.strptime(c["start_date"], "%Y%m%d").date()
        end = dt.datetime.strptime(c["end_date"], "%Y%m%d").date()
        if c["tuesday"] == "1" and start <= ref <= end:
            out.add(c["service_id"])
    return out


def pick_reference_day(zf):
    """A Tuesday far enough out to miss this week's disruption calendars.

    Short-dated service ids are how PTV encodes works and replacements. Two weeks out
    is past most of them, and is clamped into whatever the feed actually covers.
    """
    latest = max(dt.datetime.strptime(c["end_date"], "%Y%m%d").date()
                 for c in rows(zf, "calendar.txt"))
    day = dt.date.today() + dt.timedelta(days=14)
    day += dt.timedelta(days=(1 - day.weekday()) % 7)      # forward to a Tuesday
    if day > latest:
        day = latest - dt.timedelta(days=(latest.weekday() - 1) % 7)
    return day


def usable_trips(zf):
    """Trip ids running on a plain midweek day, excluding replacement buses."""
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    # Replacement buses are a real service but a temporary one, and their times would be
    # baked into a file that ships for months.
    replacement = {rid for rid, r in routes.items()
                   if (r.get("route_short_name") or "").strip() == "Replacement Bus"}
    ref = pick_reference_day(zf)
    services = weekday_services(zf, ref)
    trips = {t["trip_id"] for t in rows(zf, "trips.txt")
             if t["service_id"] in services and t["route_id"] not in replacement}
    print("    reference day %s, %d services, %d trips" % (ref, len(services), len(trips)))
    return trips


def walk_trips(zf, usable, key_of):
    """Yield each usable trip as a list of (stop key, row), in stop_sequence order.

    GTFS groups stop_times by trip and orders it by stop_sequence, which is what makes
    one streaming pass enough - a trip is complete the moment the trip_id changes.
    """
    current, trip = None, []
    for r in rows(zf, "stop_times.txt"):
        if r["trip_id"] != current:
            if trip:
                yield trip
            trip = []
            current = r["trip_id"]
        if current in usable:
            trip.append((key_of(r["stop_id"]), r))
    if trip:
        yield trip


def direct_times(zf, usable, cbd_ids, key_of):
    """Median off-peak run time to the city, for stops a single trip connects."""
    runs = collections.defaultdict(list)
    for trip in walk_trips(zf, usable, key_of):
        j = next((i for i, (k, _) in enumerate(trip) if k in cbd_ids), None)
        if j is None:
            continue
        arrive_city = secs(trip[j][1]["arrival_time"])
        for i in range(j):
            key, r = trip[i]
            depart = secs(r["departure_time"])
            if OFF_PEAK[0] <= depart <= OFF_PEAK[1] and arrive_city > depart:
                runs[key].append((arrive_city - depart) / 60.0)

    times = {k: statistics.median(v) for k, v in runs.items() if len(v) >= MIN_RUNS}
    for k in cbd_ids:
        times[k] = 0.0
    return times


def transfer_times(zf, usable, key_of, times, candidates):
    """Fill in stops no direct trip serves, using one transfer.

    A second pass rather than gathering every leg during the first: legs are quadratic in
    trip length, and across ~10,000 tram trips that is tens of millions of pairs. Only
    legs that start at a stop still missing a time are of any use, and that is a handful.
    """
    if not candidates:
        return 0
    best = collections.defaultdict(dict)
    for trip in walk_trips(zf, usable, key_of):
        for i, (origin, r) in enumerate(trip):
            if origin not in candidates:
                continue
            depart = secs(r["departure_time"])
            if not (OFF_PEAK[0] <= depart <= OFF_PEAK[1]):
                continue
            for via, onward in trip[i + 1:]:
                if via not in times:
                    continue
                arrive = secs(onward["arrival_time"])
                if arrive > depart:
                    best[origin].setdefault(via, []).append((arrive - depart) / 60.0)

    added = 0
    for origin, vias in best.items():
        options = [statistics.median(v) + times[via] + TRANSFER_PENALTY_MIN
                   for via, v in vias.items() if len(v) >= MIN_RUNS]
        if options:
            times[origin] = min(options)
            added += 1
    return added


def thin(entries, metres):
    """Keep the best-connected stop in each cluster, drop the rest.

    Greedy from the shortest travel time outward, so where two stops compete the one
    closer to the city survives.
    """
    kept = []
    for e in sorted(entries, key=lambda e: (e["t"], e["n"])):
        if all(haversine(e["lat"], e["lon"], k["lat"], k["lon"]) >= metres for k in kept):
            kept.append(e)
    return kept


def clean_name(name):
    """Trim the bits of GTFS naming that are noise on a map label."""
    name = name.strip()
    name = name.split("#")[0].strip().rstrip("-").strip()   # tram stop numbers
    # PTV truncates a few long tram stop names in the feed itself, leaving a trailing
    # ellipsis and sometimes an unclosed bracket. Neither belongs on a map label.
    if "..." in name:
        name = name.split("...")[0].rstrip(" (/-").strip()
    if name.endswith(" Railway Station"):
        name = name[: -len(" Railway Station")]
    elif name.endswith(" Station"):
        name = name[: -len(" Station")]
    return name


def build(city_id):
    city = CITIES[city_id]
    path = fetch(city["feed"], city["cache"])
    bbox = city["bbox"]
    out = []

    for mode, (label, parented) in city["modes"].items():
        print("  %s (feed mode %s)" % (label, mode))
        zf = open_ptv_feed(path, mode)

        stops = list(rows(zf, "stops.txt"))
        # Rail splits every platform into its own stop under a parent station, so
        # collapsing to the parent is what makes "Footscray" one marker rather than six.
        # Trams are stop-per-stop and have no meaningful parents - the feed still carries
        # a stray location_type=1 row or two, which is why this is configured per mode
        # rather than sniffed from the data.
        if parented:
            parent = {s["stop_id"]: (s["parent_station"] or s["stop_id"]) for s in stops}
            named = {s["stop_id"]: s for s in stops if s["location_type"] == "1"}
            key_of = lambda sid: parent.get(sid, sid)
        else:
            named = {s["stop_id"]: s for s in stops if s["location_type"] in ("", "0")}
            key_of = lambda sid: sid

        if city.get("rail_cbd") and parented:
            cbd_ids = {k for k in named if k.split(":")[-1] in city["rail_cbd"]}
        else:
            box = city["cbd_box"]
            cbd_ids = {k for k, s in named.items()
                       if box["minLat"] <= float(s["stop_lat"]) <= box["maxLat"]
                       and box["minLon"] <= float(s["stop_lon"]) <= box["maxLon"]}
        print("    %d stops, %d of them counted as the city" % (len(named), len(cbd_ids)))

        usable = usable_trips(zf)
        times = direct_times(zf, usable, cbd_ids, key_of)
        missing = {k for k in named if k not in times}
        transferred = transfer_times(zf, usable, key_of, times, missing)
        print("    %d direct, %d via one transfer, %d unreachable"
              % (len(times) - transferred, transferred, len(missing) - transferred))

        entries = []
        for key, minutes in times.items():
            s = named.get(key)
            if not s:
                continue
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
            if not (bbox["minLat"] <= lat <= bbox["maxLat"] and bbox["minLon"] <= lon <= bbox["maxLon"]):
                continue
            entries.append({"n": clean_name(s["stop_name"]), "m": label,
                            "t": int(round(minutes)), "lat": round(lat, 5), "lon": round(lon, 5)})

        if label in city.get("thin", {}):
            before = len(entries)
            entries = thin(entries, city["thin"][label])
            print("    thinned %d -> %d at %d m spacing" % (before, len(entries), city["thin"][label]))
        out.extend(entries)
        print("    kept %d" % len(entries))

    out.sort(key=lambda e: (e["t"], e["n"]))
    write(city, out)


def write(city, entries):
    dest = ROOT / city["out"]
    lines = [
        "// %s public transport stops with approximate off-peak travel time (minutes) to" % city["label"],
        "// the CBD - GENERATED FILE, DO NOT EDIT BY HAND.",
        "// Regenerate with: python tools/build-stations.py melbourne",
        "//",
        "// Derived from the PTV GTFS feed: median off-peak weekday run time on trips that",
        "// actually serve both the stop and a city station. Stops no direct trip serves are",
        "// resolved through one transfer plus a %d minute penalty; anything needing two is" % TRANSFER_PENALTY_MIN,
        "// left out. These are estimates, not a trip planner.",
        "//",
        "// mode: train | tram",
        "const %s = [" % city["const"],
    ]
    for e in entries:
        lines.append('  {n:%s, m:"%s", t:%d, lat:%s, lon:%s},'
                     % (js_string(e["n"]), e["m"], e["t"], e["lat"], e["lon"]))
    lines.append("];")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Wrote %s - %d stops" % (dest.name, len(entries)))


def js_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which not in CITIES:
        sys.exit("usage: python tools/build-stations.py <%s>" % "|".join(CITIES))
    print("Building %s stations" % which)
    build(which)


if __name__ == "__main__":
    main()
