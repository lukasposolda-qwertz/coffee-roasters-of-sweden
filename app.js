/* Coffee roasters of Sweden. Static MapLibre app, no build step.
   Data: data/roasters.json (OpenStreetMap, ODbL). Basemap: OpenFreeMap, recoloured to the Fieldnote palette.
   If the tiles cannot be reached (for example inside a Claude artifact), the map falls back to a plain
   outline of Sweden (Natural Earth, public domain) shipped with the page. */
(() => {
"use strict";
const INLINE = window.ROASTERS_INLINE || null;   // set by tools/make_artifact.py
const SWEDEN_INLINE = window.SWEDEN_INLINE || null;
const TILE_STYLE = "https://tiles.openfreemap.org/styles/positron";

const $ = id => document.getElementById(id);
const css = v => { // resolves tokens that point at other tokens, e.g. --map-land: var(--paper)
  const x = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const m = x.match(/^var\((--[\w-]+)\)$/);
  return m ? css(m[1]) : x;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : null;
const prettyHost = u => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
const fmt = n => n.toLocaleString("en-GB");
const isPhone = () => innerWidth <= 760;

/* ---------- opening hours: a small parser for the common OSM forms ---------- */
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], DEN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function expand(spec, list) {
  const out = [];
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-"); const i = list.indexOf(a), j = b ? list.indexOf(b) : i;
    if (i < 0 || j < 0) return null;
    for (let k = i; ; k = (k + 1) % list.length) { out.push(k); if (k === j) break; }
  }
  return out;
}
function parseOH(raw) {
  if (!raw) return null;
  if (raw.trim() === "24/7") return { week: Array.from({ length: 7 }, () => [[0, 1440]]), offMonths: [], uncertain: false };
  const week = Array.from({ length: 7 }, () => null); let uncertain = /"/.test(raw); const offMonths = [];
  const s = raw.replace(/"[^"]*"/g, "").replace(/,\s+(?=(Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, ";");
  for (const rule of s.split(";").map(r => r.trim()).filter(Boolean)) {
    let m = rule.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z,\-]*)\s+(off|closed)$/);
    if (m) { const ms = expand(m[1], MONTHS); if (!ms) return null; offMonths.push(...ms); continue; }
    if (/^PH\b/.test(rule)) { uncertain = true; continue; }
    m = rule.match(/^([A-Za-z,\-]+)\s+(.+)$/); if (!m) return null;
    const days = expand(m[1].replace(/,PH|PH,/, ""), DAYS); if (!days) return null;
    let spans = [];
    if (!/^(off|closed)$/.test(m[2])) {
      for (const t of m[2].split(",")) {
        const tm = t.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/); if (!tm) return null;
        spans.push([+tm[1] * 60 + +tm[2], +tm[3] * 60 + +tm[4]]);
      }
    }
    days.forEach(d => week[d] = spans);
  }
  return { week: week.map(x => x || []), offMonths, uncertain };
}
function stateNow(oh) {
  if (!oh) return null;
  const n = new Date(), d = (n.getDay() + 6) % 7, mins = n.getHours() * 60 + n.getMinutes();
  if (oh.offMonths.includes(n.getMonth())) return { open: false };
  const today = oh.week[d], span = today.find(([a, b]) => mins >= a && mins < b);
  if (span) return { open: true, until: span[1] };
  const next = today.find(([a]) => a > mins);
  return { open: false, opens: next?.[0] };
}
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function ohTable(oh) {
  const rows = [];
  oh.week.forEach((sp, i) => {
    const key = sp.map(([a, b]) => hhmm(a) + "–" + hhmm(b)).join(", ") || "closed";
    const last = rows[rows.length - 1];
    if (last && last.key === key && last.to === i - 1) last.to = i; else rows.push({ from: i, to: i, key });
  });
  let h = rows.map(r => `<tr><td>${DEN[r.from]}${r.to > r.from ? "–" + DEN[r.to] : ""}</td><td>${r.key}</td></tr>`).join("");
  if (oh.offMonths.length) h += `<tr><td>${[...new Set(oh.offMonths)].map(m => MONTHS[m]).join(", ")}</td><td>closed</td></tr>`;
  return `<table>${h}</table>`;
}

/* ---------- state ---------- */
let DATA = [], me = null, activeId = null, popup = null, tilesOk = false, map, view = "list";
const filt = { q: "", hours: false, open: false, town: null };
const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function km(a, b) {
  const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// everything except the town filter (the towns view ranks towns within the other filters)
function base() {
  const q = norm(filt.q);
  return DATA.filter(r => (!q || norm(r.name + " " + (r.city || "") + " " + (r.town || "") + " " + (r.address || "")).includes(q))
    && (!filt.hours || r.oh)
    && (!filt.open || stateNow(r.oh)?.open));
}
const visible = () => base().filter(r => !filt.town || r.townKey === filt.town);
function towns(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.townKey) continue;
    const t = by.get(r.townKey) || { key: r.townKey, name: r.town || r.city, n: 0, open: 0, hours: 0 };
    t.n++; t.open += stateNow(r.oh)?.open ? 1 : 0; t.hours += r.oh ? 1 : 0;
    by.set(r.townKey, t);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "sv"));
}

/* ---------- basemap ---------- */
function fallbackStyle(sweden) {
  return {
    version: 8,
    sources: { sweden: { type: "geojson", data: sweden, attribution: "Outline: Natural Earth" } },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": css("--map-water") } },
      { id: "land", type: "fill", source: "sweden", paint: { "fill-color": css("--map-land") } },
      { id: "coast", type: "line", source: "sweden", paint: { "line-color": css("--contour"), "line-width": 1 } },
    ],
  };
}
function recolour() {
  if (!tilesOk) return;
  const C = { land: css("--map-land"), water: css("--map-water"), road: css("--map-road"), label: css("--map-label"),
    paper: css("--paper"), fog: css("--fog"), contour: css("--contour"), lichen: css("--lichen") };
  for (const l of map.getStyle().layers) {
    if (["pts", "clusters", "cluster-n", "labels"].includes(l.id)) continue;
    const id = l.id;
    try {
      if (l.type === "background") map.setPaintProperty(id, "background-color", C.land);
      else if (l.type === "fill") {
        const col = /water/.test(id) ? C.water : /park|wood|grass|landcover|nature|forest|scrub/.test(id) ? C.lichen
          : /building|aeroway|landuse/.test(id) ? C.fog : C.land;
        map.setPaintProperty(id, "fill-color", col);
        map.setPaintProperty(id, "fill-opacity", col === C.lichen ? 0.22 : col === C.fog && /landuse|aeroway/.test(id) ? 0.5 : 1);
        if (l.paint && "fill-outline-color" in l.paint) map.setPaintProperty(id, "fill-outline-color", col);
      } else if (l.type === "line") {
        const col = /water|river/.test(id) ? C.water : /boundary|admin/.test(id) ? C.contour : /rail/.test(id) ? C.contour : C.road;
        map.setPaintProperty(id, "line-color", col);
      } else if (l.type === "fill-extrusion") map.setPaintProperty(id, "fill-extrusion-color", C.fog);
      else if (l.type === "symbol" && l.layout?.["text-field"]) {
        map.setPaintProperty(id, "text-color", C.label);
        map.setPaintProperty(id, "text-halo-color", C.paper);
        map.setPaintProperty(id, "text-halo-width", 1.2);
        map.setLayoutProperty(id, "text-field", ["coalesce", ["get", "name:sv"], ["get", "name"]]);
        if (l.layout["icon-image"]) map.setPaintProperty(id, "icon-opacity", 0);
      }
    } catch (e) { /* layer without that property */ }
  }
  paintPoints();
}
function paintPoints() {
  if (!map.getLayer("pts")) return;
  map.setPaintProperty("pts", "circle-color", ["match", ["get", "group"], "micro", css("--series-2"), css("--series-1")]);
  map.setPaintProperty("pts", "circle-stroke-color", css("--paper-raised"));
  map.setPaintProperty("clusters", "circle-color", css("--spruce"));
  map.setPaintProperty("clusters", "circle-stroke-color", css("--paper"));
  if (map.getLayer("cluster-n")) map.setPaintProperty("cluster-n", "text-color", css("--on-spruce"));
  if (map.getLayer("labels")) { map.setPaintProperty("labels", "text-color", css("--ink")); map.setPaintProperty("labels", "text-halo-color", css("--paper")); }
  if (!tilesOk) {
    map.setPaintProperty("sea", "background-color", css("--map-water"));
    map.setPaintProperty("land", "fill-color", css("--map-land"));
    map.setPaintProperty("coast", "line-color", css("--contour"));
  }
}

/* ---------- popup ---------- */
function popupHTML(r) {
  const st = stateNow(r.oh);
  const kind = (r.group === "micro" ? ["Roasting café"] : ["Roaster"]).concat(r.kind.filter(k => !(r.group === "micro" && k === "café")))
    .concat(r.specialty ? ["specialty"] : []).join(" · ");
  let h = `<div class="pp"><span class="label">${esc(kind)}</span><h3>${esc(r.name)}</h3>`;
  if (r.address || r.city) h += `<span class="small">${esc(r.address || r.city)}</span>`;
  const links = [], w = safeUrl(r.website), ig = safeUrl(r.instagram);
  if (w) links.push(`<a href="${esc(w)}" target="_blank" rel="noopener">${esc(prettyHost(w))} →</a>`);
  if (ig) links.push(`<a href="${esc(ig)}" target="_blank" rel="noopener">Instagram →</a>`);
  if (links.length) h += `<div class="links">${links.join("")}</div>`;
  if (r.oh) {
    if (st) h += st.open ? `<span class="state open">OPEN NOW${st.until ? " · UNTIL " + hhmm(st.until) : ""}</span>`
      : `<span class="state">CLOSED NOW${st.opens != null ? " · OPENS " + hhmm(st.opens) : ""}</span>`;
    h += ohTable(r.oh);
    if (r.oh.uncertain) h += `<span class="raw">As tagged: ${esc(r.opening_hours)}</span>`;
  } else if (r.opening_hours) h += `<span class="raw">Hours as tagged: ${esc(r.opening_hours)}</span>`;
  h += `<a class="osm" href="https://www.openstreetmap.org/${esc(r.id)}" target="_blank" rel="noopener">View or edit on OpenStreetMap →</a>`;
  return h + "</div>";
}
const paddingFor = () => isPhone() ? { top: 60, bottom: 30, left: 20, right: 20 } : { top: 40, bottom: 40, left: 40, right: 40 };
function openPopup(r, fly = true) {
  if (!r) return;
  activeId = r.id;
  if (fly) map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), tilesOk ? 12 : 8), speed: 1.4, padding: paddingFor() });
  popup?.remove();
  popup = new maplibregl.Popup({ offset: 12, maxWidth: "300px", focusAfterOpen: false }).setLngLat([r.lon, r.lat]).setHTML(popupHTML(r)).addTo(map);
  popup.on("close", () => { if (activeId === r.id) { activeId = null; markActive(); } });
  markActive();
  if (isPhone()) $("panel").classList.add("collapsed");
}
function markActive() { document.querySelectorAll("#list li").forEach(li => li.classList.toggle("active", li.dataset.id === activeId)); }

/* ---------- render ---------- */
function render() {
  let rows = visible();
  const sort = $("sort").value;
  if (sort === "near" && me) { rows.forEach(r => r._d = km(me, r)); rows.sort((a, b) => a._d - b._d); }
  else if (sort === "view") { const b = map.getBounds(); rows = rows.filter(r => b.contains([r.lon, r.lat])); }
  map.getSource("r")?.setData({ type: "FeatureCollection", features: visible().map(r => ({ type: "Feature",
    properties: { id: r.id, group: r.group, name: r.name }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })) });
  const n = rows.length;
  $("count").textContent = fmt(n);
  $("countLabel").textContent = (n === 1 ? "roaster" : "roasters") + (sort === "view" ? " in view" : "");
  $("openCount").textContent = fmt(rows.filter(r => stateNow(r.oh)?.open).length);
  $("townCount").textContent = fmt(new Set(rows.map(r => r.townKey).filter(Boolean)).size);
  $("list").innerHTML = n ? rows.map(r => {
    const st = stateNow(r.oh);
    const side = sort === "near" && me ? `${r._d < 10 ? r._d.toFixed(1) : Math.round(r._d)} km` : st?.open ? `until ${hhmm(st.until)}` : "";
    return `<li data-id="${esc(r.id)}" tabindex="0"><span class="dot ${r.group === "micro" ? "s2" : "s1"}"></span>
      <span><span class="nm">${esc(r.name)}</span><span class="meta">${esc(r.city && r.town && norm(r.city) !== norm(r.town) ? `${r.city}, ${r.town}` : r.town || r.city || "")}</span></span>
      <span class="side${st?.open && !(sort === "near" && me) ? " open" : ""}">${side}</span></li>`;
  }).join("") : `<li class="empty">No roaster matches these filters.</li>`;
  markActive();
  renderTowns();
  const cnt = f => fmt(DATA.filter(f).length);
  $("fHours").querySelector(".n").textContent = cnt(r => r.oh);
  $("fOpen").querySelector(".n").textContent = cnt(r => stateNow(r.oh)?.open);
  $("townChip").hidden = !filt.town;
  if (filt.town) $("townChip").textContent = `${DATA.find(r => r.townKey === filt.town)?.town} ×`;
}
function renderTowns() {
  const rows = base(), T = towns(rows);
  const max = T[0]?.n || 1, single = T.filter(t => t.n === 1).length, untagged = rows.filter(r => !r.townKey).length;
  let h = "";
  if (T.length) {
    const top = T.filter(t => t.n === T[0].n).map(t => esc(t.name));
    h += `<li class="summary"><b>${top.join(" and ")}</b> ${top.length > 1 ? "share" : "has"} the most roasters (${T[0].n}). `
      + `${fmt(T.length)} towns in all, and ${fmt(single)} of them have just one.`
      + (untagged ? ` ${fmt(untagged)} ${untagged === 1 ? "place has" : "places have"} no town in OpenStreetMap.` : "") + `</li>`;
  }
  h += T.map(t => `<li data-town="${esc(t.key)}" tabindex="0" class="${t.key === filt.town ? "sel" : ""}">
      <span class="tn">${esc(t.name)}</span>
      <span class="bar" aria-hidden="true"><span style="width:${Math.max(4, Math.round(t.n / max * 100))}%"></span></span>
      <span class="sub">${t.open ? `${t.open} open now · ` : ""}${t.hours} of ${t.n} with hours</span>
      <span class="cnt">${t.n}</span></li>`).join("") || `<li class="summary">No town matches these filters.</li>`;
  $("towns").innerHTML = h;
}
function setView(v) {
  view = v;
  $("vList").setAttribute("aria-selected", String(v === "list"));
  $("vTowns").setAttribute("aria-selected", String(v === "towns"));
  $("list").hidden = v !== "list";
  $("towns").hidden = v !== "towns";
  $("sort").closest(".sortrow").hidden = v !== "list";
  $("panel").classList.remove("collapsed");
}
function pickTown(key) {
  if (filt.town === key) key = null;
  filt.town = key;
  render();
  setView("list");
  const pts = visible();
  if (key && pts.length) {
    if (pts.length === 1) map.flyTo({ center: [pts[0].lon, pts[0].lat], zoom: tilesOk ? 13 : 9, padding: paddingFor() });
    else {
      const b = new maplibregl.LngLatBounds();
      pts.forEach(r => b.extend([r.lon, r.lat]));
      map.fitBounds(b, { padding: paddingFor(), maxZoom: tilesOk ? 14 : 9 });
    }
  }
}

/* ---------- controls ---------- */
function press(el, on) { el.setAttribute("aria-pressed", String(on)); }
function wire() {
  $("fHours").onclick = () => { filt.hours = !filt.hours; press($("fHours"), filt.hours); render(); };
  $("fOpen").onclick = () => { filt.open = !filt.open; press($("fOpen"), filt.open); render(); };
  $("townChip").onclick = () => pickTown(null);
  $("q").addEventListener("input", e => { filt.q = e.target.value; render(); });
  $("q").addEventListener("focus", () => $("panel").classList.remove("collapsed"));
  $("sort").addEventListener("change", e => {
    if (e.target.value === "near" && !me) {
      navigator.geolocation?.getCurrentPosition(p => { me = { lat: p.coords.latitude, lon: p.coords.longitude }; render(); },
        () => { $("sort").value = "name"; render(); note("Your location is not available here, so the list stays sorted by name."); });
    }
    render();
  });
  $("vList").onclick = () => setView("list");
  $("vTowns").onclick = () => setView("towns");
  $("townStat").onclick = () => setView("towns");
  const pick = e => { const li = e.target.closest("li[data-id]"); if (li) openPopup(DATA.find(r => r.id === li.dataset.id)); };
  $("list").addEventListener("click", pick);
  $("list").addEventListener("keydown", e => { if (e.key === "Enter") pick(e); });
  const town = e => { const li = e.target.closest("li[data-town]"); if (li) pickTown(li.dataset.town); };
  $("towns").addEventListener("click", town);
  $("towns").addEventListener("keydown", e => { if (e.key === "Enter") town(e); });
  $("sheetHandle").onclick = () => $("panel").classList.toggle("collapsed");
  const about = open => {
    $("panel").classList.toggle("about-open", open);
    $("about").hidden = !open;
    $("aboutBtn").setAttribute("aria-expanded", String(open));
    if (open) { $("panel").classList.remove("collapsed"); $("about").scrollTop = 0; }
  };
  $("aboutBtn").onclick = () => about(true);
  $("aboutBack").onclick = () => about(false);
  if (isPhone()) $("panel").classList.add("collapsed");
}
function note(text) {
  let n = document.querySelector(".notice");
  if (!n) { n = document.createElement("div"); n.className = "notice"; $("map").appendChild(n); }
  n.textContent = text; clearTimeout(note.t); note.t = setTimeout(() => n.remove(), 6000);
}

/* ---------- layers ---------- */
function addLayers() {
  map.addSource("r", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 40, clusterMaxZoom: 10 });
  map.addLayer({ id: "clusters", type: "circle", source: "r", filter: ["has", "point_count"], paint: {
    "circle-color": css("--spruce"), "circle-opacity": 0.9, "circle-stroke-color": css("--paper"), "circle-stroke-width": 2,
    "circle-radius": ["step", ["get", "point_count"], 13, 5, 17, 15, 22, 40, 28] } });
  if (tilesOk) {
    map.addLayer({ id: "cluster-n", type: "symbol", source: "r", filter: ["has", "point_count"], layout: {
      "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": css("--on-spruce") } });
  }
  map.addLayer({ id: "pts", type: "circle", source: "r", filter: ["!", ["has", "point_count"]], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 12, 7.5, 16, 9.5],
    "circle-color": ["match", ["get", "group"], "micro", css("--series-2"), css("--series-1")],
    "circle-stroke-color": css("--paper-raised"), "circle-stroke-width": 1.5 } });
  if (tilesOk) {
    map.addLayer({ id: "labels", type: "symbol", source: "r", minzoom: 10, filter: ["!", ["has", "point_count"]], layout: {
      "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Regular"], "text-optional": true },
      paint: { "text-color": css("--ink"), "text-halo-color": css("--paper"), "text-halo-width": 1.5 } });
  }
  map.on("click", "clusters", e => {
    const f = e.features[0];
    map.getSource("r").getClusterExpansionZoom(f.properties.cluster_id).then(z => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 }));
  });
  map.on("click", "pts", e => openPopup(DATA.find(r => r.id === e.features[0].properties.id), false));
  for (const l of ["clusters", "pts"]) {
    map.on("mouseenter", l, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", l, () => map.getCanvas().style.cursor = "");
  }
}

/* ---------- start ---------- */
async function tilesReachable() {
  if (INLINE) return false; // the artifact sandbox blocks tile hosts
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(TILE_STYLE, { signal: ctl.signal }); clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}
const hadHash = /map=/.test(location.hash);
async function start() {
  wire();
  const [data, sweden, ok] = await Promise.all([
    INLINE ? INLINE : fetch("data/roasters.json").then(r => r.json()),
    SWEDEN_INLINE ? SWEDEN_INLINE : fetch("data/sweden.geojson").then(r => r.json()),
    tilesReachable(),
  ]);
  tilesOk = ok;
  DATA = data.roasters.map(r => ({ ...r, oh: parseOH(r.opening_hours), townKey: norm(r.town || r.city) || null }));
  map = new maplibregl.Map({
    container: "map", style: tilesOk ? TILE_STYLE : fallbackStyle(sweden),
    bounds: [[10.9, 55.2], [24.2, 69.1]], fitBoundsOptions: { padding: paddingFor() },
    minZoom: 3, maxZoom: tilesOk ? 18 : 11, hash: INLINE ? false : "map", attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: isPhone(), customAttribution:
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>' }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("moveend", () => { if ($("sort").value === "view") render(); });
  await new Promise(r => map.once("load", r));
  addLayers(); recolour(); render();
  if (!hadHash) map.fitBounds([[10.9, 55.2], [24.2, 69.1]], { padding: paddingFor(), duration: 0 });
  $("snap").textContent = `OpenStreetMap snapshot ${data.snapshot} · ${fmt(DATA.length)} places`;
  $("tilesNote").hidden = tilesOk;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const retheme = () => { recolour(); paintPoints(); render(); };
  mq.addEventListener?.("change", retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
start().catch(err => { $("countLabel").textContent = "Could not load the data: " + err.message; });
})();
