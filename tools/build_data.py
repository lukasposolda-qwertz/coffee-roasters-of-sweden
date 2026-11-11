"""Build data/roasters.json from OpenStreetMap: every coffee roaster mapped in Sweden.

Selection: objects tagged craft=coffee_roaster, plus cafés and shops tagged microroasting=yes.
Needs only the Python standard library. Run from the repo root:

    python tools/build_data.py            # fetch from Overpass
    python tools/build_data.py --force    # write even if the result shrank a lot

Tries several Overpass servers with retries. Exits non-zero, and leaves the old file alone,
if every server fails or the result is empty or more than 20 % smaller than the current file.
E-mail addresses and phone numbers are deliberately left out.
"""
import datetime, json, pathlib, sys, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "roasters.json"
PLACES = ROOT / "data" / "places_cache.json"  # coordinate -> town, so weekly runs only look up new points
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
QUERY = """[out:json][timeout:240];
area["ISO3166-1"="SE"][admin_level=2]->.se;
( nwr(area.se)["craft"="coffee_roaster"];
  nwr(area.se)["microroasting"="yes"]; );
out tags center;"""
MIN_RATIO = 0.8


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for attempt in range(3):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "coffee-roasters-of-sweden/1.0"})
                with urllib.request.urlopen(req, timeout=280) as r:
                    data = json.load(r)
                if data.get("elements"):
                    print(f"OK {url}: {len(data['elements'])} objects")
                    return data
                print(f"Empty answer from {url}")
            except Exception as e:  # 429/502/504 and timeouts are common
                print(f"Failed {url}: {e}")
        time.sleep(20 * (attempt + 1))
    sys.exit("Every Overpass server failed; keeping the existing file.")


def address(t):
    street = " ".join(x for x in [t.get("addr:street") or t.get("addr:place"), t.get("addr:housenumber")] if x)
    town = " ".join(x for x in [t.get("addr:postcode"), t.get("addr:city")] if x)
    return ", ".join(x for x in [street, town] if x) or None


def url(v):
    v = (v or "").strip().split(";")[0].strip()
    if not v:
        return {}


def town(r, place):
    """The town a visitor would name: the city the point lies in (Stockholm for Farsta, Malmö for Limhamn),
    else the postal town from OSM, else Nominatim's town, village or municipality.
    Needed because many points lack addr:city (in Stockholm the address sits on the building)."""
    name = place.get("city") or r["city"] or place.get("town") or place.get("village") or place.get("municipality")
    for suffix in (" kommun", " distrikt", " stad", " Stad"):
        if name and name.endswith(suffix):
            name = name[: -len(suffix)]
    return name
    return v if v.startswith("http") else "https://" + v


def instagram(t):
    h = (t.get("contact:instagram") or t.get("instagram") or "").strip()
    if not h:
        return None
    if h.startswith("http"):
        return h.split("?")[0]
    return "https://www.instagram.com/" + h.lstrip("@").strip("/") + "/"


def place_for(lat, lon, cache):
    """Address parts for a point from Nominatim reverse geocoding (1 request per second, cached)."""
    key = f"{lat:.4f},{lon:.4f}"
    if key in cache:
        return cache[key]
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=14&addressdetails=1&accept-language=sv"
    for _ in range(3):
        try:
            time.sleep(1.1)
            req = urllib.request.Request(url, headers={"User-Agent": "coffee-roasters-of-sweden/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                a = json.load(r).get("address", {})
            cache[key] = {k: a.get(k) for k in ("city", "town", "village", "municipality")}
            return cache[key]
        except Exception as e:
            print("Nominatim failed", key, e)
            time.sleep(5)
    return None


def normalize(e):
    t = e.get("tags", {})
    lat, lon = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"])
    kind = []
    if t.get("amenity") == "cafe":
        kind.append("café")
    if t.get("shop"):
        kind.append("shop")
    return {
        "id": f"{e['type']}/{e['id']}",
        "name": t.get("name") or t.get("brand") or "Unnamed roaster",
        "lat": round(lat, 6), "lon": round(lon, 6),
        "group": "roaster" if t.get("craft") == "coffee_roaster" else "micro",
        "kind": kind,
        "specialty": t.get("drink:coffee") == "specialty",
        "address": address(t),
        "city": t.get("addr:city"),
        "website": url(t.get("website") or t.get("contact:website")),
        "instagram": instagram(t),
        "opening_hours": t.get("opening_hours"),
    }


def main():
    data = fetch()
    items = sorted((normalize(e) for e in data["elements"]), key=lambda r: r["name"].lower())
    cache = json.loads(PLACES.read_text(encoding="utf-8")) if PLACES.exists() else {}
    for r in items:
        r["town"] = town(r, place_for(r["lat"], r["lon"], cache))
    PLACES.parent.mkdir(parents=True, exist_ok=True)
    PLACES.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    if OUT.exists() and "--force" not in sys.argv:
        prev = len(json.loads(OUT.read_text(encoding="utf-8"))["roasters"])
        if len(items) < prev * MIN_RATIO:
            sys.exit(f"Refusing to overwrite: {len(items)} objects against {prev} before (use --force if that is right).")
    out = {
        "snapshot": datetime.date.today().isoformat(),
        "osm_base": data.get("osm3s", {}).get("timestamp_osm_base"),
        "licence": "Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        "roasters": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(items)} roasters -> {OUT}")


if __name__ == "__main__":
    main()
