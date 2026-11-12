# Coffee roasters of Sweden

A map of every coffee roaster in Sweden that OpenStreetMap knows about. Search by name or town, see what is open now, rank the towns by how many roasters they have, and open any place in OpenStreetMap to check or improve it.

Live: https://lukasposolda-qwertz.github.io/coffee-roasters-of-sweden/

## Scope

Every object in Sweden tagged `craft=coffee_roaster`, plus cafés and shops tagged `microroasting=yes`. Some points are a roaster's café or shop rather than the roastery itself; that is how they are mapped in OpenStreetMap. A roaster that is missing from the map is missing from OpenStreetMap, and the fix is to add it there.

## How it works

- `tools/build_data.py` downloads the roasters from OpenStreetMap's Overpass API and writes `data/roasters.json`. Each place gets a `town`: the city it lies in according to Nominatim (so Farsta counts as Stockholm), else its postal town from OSM. Many points have no `addr:city`, because in Stockholm the address sits on the building. Lookups are cached in `data/places_cache.json`, so a weekly run only asks Nominatim about new points. It needs only the Python standard library. Run it from the repo root. It keeps the old file if every server fails or the result shrinks by more than 20 %.
- `index.html`, `style.css` and `app.js` are a static MapLibre site with no build step and no backend. The basemap is OpenFreeMap, recoloured in the browser. If the tiles cannot be reached, the map falls back to a plain outline of Sweden in `data/sweden.geojson`.
- A GitHub Action (`.github/workflows/rebuild-data.yml`) rebuilds the data every Monday at 03:00 UTC and commits it, and GitHub Pages republishes the site. To pick up OSM edits straight away, open the Actions tab, choose "Rebuild roaster data" and press "Run workflow".
- `tools/make_artifact.py` builds a single self-contained HTML file of the same app, with the data inlined, for places that cannot load the data files or the map tiles.

E-mail addresses and phone numbers are left out of the data on purpose.

## Language

Swedish by default, English with the toggle in the header. The choice is remembered in the browser, and `?lang=en` opens the English version directly.

## Design

Fieldnote, my personal visual identity: IBM Plex Sans and IBM Plex Mono, spruce and ochre on paper, hairlines. The main view keeps only what helps you find a roastery; context and credits sit under "About". Light and dark themes follow the system setting.

## Data and credits

Roaster data © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). `data/roasters.json` is derived from it and is available under the same licence.

Map tiles: [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, data from OpenStreetMap. Outline of Sweden: [Natural Earth](https://www.naturalearthdata.com) (public domain). Map library: [MapLibre GL JS](https://maplibre.org).

© 2026 Lukas Posolda
