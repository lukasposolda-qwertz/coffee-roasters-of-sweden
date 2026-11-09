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
        return None
    return v if v.startswith("http") else "https://" + v


def instagram(t):
    h = (t.get("contact:instagram") or t.get("instagram") or "").strip()
    if not h:
        return None
    if h.startswith("http"):
        return h.split("?")[0]
    return "https://www.instagram.com/" + h.lstrip("@").strip("/") + "/"


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
