"""Build one self-contained HTML file for a Claude artifact (artifacts cannot load local files or map tiles).

    python tools/make_artifact.py [out.html]

Inlines style.css, the MapLibre stylesheet (tools/maplibre-gl-4.7.1.css), app.js, data/roasters.json and
data/sweden.geojson. MapLibre's script still loads from unpkg, which the artifact sandbox allows.
The artifact shows the outline of Sweden instead of OpenFreeMap tiles.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "artifact.html"
html = (ROOT / "index.html").read_text(encoding="utf-8")
app = re.search(r"<!--APP-->(.*)<!--/APP-->", html, re.S).group(1)
css = (ROOT / "tools" / "maplibre-gl-4.7.1.css").read_text(encoding="utf-8") + "\n" + (ROOT / "style.css").read_text(encoding="utf-8")
css = css.replace("html, body { margin: 0; height: 100%; }", "html, body { height: 100%; }")
data = json.loads((ROOT / "data" / "roasters.json").read_text(encoding="utf-8"))
sweden = json.loads((ROOT / "data" / "sweden.geojson").read_text(encoding="utf-8"))
js = (ROOT / "app.js").read_text(encoding="utf-8")
safe = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("</", "<\/")
page = f"""<title>Coffee roasters of Sweden</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;600&display=swap">
<style>
{css}
</style>
{app}
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>window.ROASTERS_INLINE = {safe(data)};
window.SWEDEN_INLINE = {safe(sweden)};</script>
<script>
{js}
</script>
"""
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(page, encoding="utf-8")
print(f"{out} ({len(page) // 1024} KB, {len(data['roasters'])} roasters, snapshot {data['snapshot']})")
