"""Explore the Waternet GIS export on an interactive map.

Reads the GIS knowledge-graph export (Turtle), converts RD New (EPSG:28992)
geometries to WGS84 and writes a self-contained Leaflet HTML file.

Usage:
    .venv/bin/python explore/gis_map.py [gis-export.ttl] [out.html]

Output goes to data/out/ (git-ignored): the map embeds internal data.
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import rdflib
from pyproj import Transformer
from rdflib import RDF, OWL, URIRef

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/Data"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else RAW / "Jan de Jonghstraat/gis-export.ttl"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "data/out/gis_map.html"
MAPPING = RAW / "naakt_wotl_material_mapping.ttl"

OTL = "https://otl.waternet.nl/def/"
GEO = "http://www.opengis.net/ont/geosparql#"
NEN = "https://w3id.org/nen2660/def#"

# Property names we could infer from the data itself (labels are not in the export).
KNOWN_PROPS = {
    "de592649": "aanlegjaar",
    "e8f4ef80": "naam",
    "2be30a92": "guid",
}

to_wgs84 = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)


def short(uri: str) -> str:
    """otl UUID -> first 8 chars; other URIs -> last path segment."""
    if uri.startswith(OTL):
        return uri[len(OTL):][:8]
    return re.split(r"[/#]", uri.rstrip("/"))[-1]


def parse_wkt(wkt: str):
    """Parse POINTZ / LINESTRINGZ WKT (with optional CRS prefix) to GeoJSON geometry in WGS84."""
    wkt = re.sub(r"^<[^>]+>\s*", "", wkt.strip())
    kind, body = wkt.split("(", 1)
    pts = []
    for pair in body.strip("() ").split(","):
        x, y, *_ = map(float, pair.split())
        lon, lat = to_wgs84.transform(x, y)
        pts.append([round(lon, 7), round(lat, 7)])
    kind = kind.strip().upper().rstrip("Z").strip()
    if kind == "POINT":
        return {"type": "Point", "coordinates": pts[0]}
    if kind == "LINESTRING":
        return {"type": "LineString", "coordinates": pts}
    raise ValueError(f"unsupported WKT: {kind}")


def main():
    g = rdflib.Graph()
    g.parse(SRC)
    m = rdflib.Graph()
    m.parse(MAPPING)
    material_name = {
        str(s): short(str(o))
        for s, o in m.subject_objects(OWL.equivalentClass)
        if str(s).startswith(OTL)
    }

    features = []
    type_counts = Counter()
    prop_seen = defaultdict(set)  # property label -> example values (for the legend/learning)

    for s, geom in g.subject_objects(URIRef(GEO + "hasGeometry")):
        wkt = next(g.objects(geom, URIRef(GEO + "asWKT")), None)
        if wkt is None:
            continue
        props = {"uri": str(s)}
        for p, o in g.predicate_objects(s):
            p = str(p)
            if p in (GEO + "hasGeometry",):
                continue
            if p == str(RDF.type):
                props["type"] = short(str(o))
                continue
            if p == NEN + "consistsOf":
                props["materiaal"] = material_name.get(str(o), "otl:" + short(str(o)))
                continue
            if p == str(OWL.sameAs):
                props["maximo"] = short(str(o))
                continue
            if p.startswith("https://wkg.waternet.nl/def/gis#"):
                props[p.split("#")[-1]] = short(str(o))
                continue
            # value node (diameter, lengte, ...): name it after its URI path, read rdf:value + unit
            if isinstance(o, URIRef) and "/id/" in str(o):
                name = str(o).split("/id/")[1].split("/")[0]
                val = next(g.objects(o, RDF.value), None)
                unit = next(g.objects(o, URIRef(NEN + "hasUnit")), None)
                if val is not None:
                    props[name] = f"{val} {short(str(unit)) if unit else ''}".strip()
                    continue
            key = KNOWN_PROPS.get(short(p), "otl:" + short(p))
            props[key] = ("otl:" + short(str(o))) if isinstance(o, URIRef) else str(o)

        try:
            geometry = parse_wkt(str(wkt))
        except ValueError:
            continue
        props["geom"] = geometry["type"]
        type_counts[(props.get("type", "?"), geometry["type"])] += 1
        for k, v in props.items():
            if len(prop_seen[k]) < 3:
                prop_seen[k].add(str(v)[:40])
        features.append({"type": "Feature", "geometry": geometry, "properties": props})

    print(f"{len(features)} features from {SRC.name}")
    for (t, gt), n in type_counts.most_common():
        print(f"  type {t}  {gt:10} {n}")

    wior = load_wior(features)
    print(f"{len(wior)} WIOR street works overlap the network area")

    html = (TEMPLATE
            .replace("__DATA__", json.dumps({"type": "FeatureCollection", "features": features}))
            .replace("__WIOR__", json.dumps({"type": "FeatureCollection", "features": wior})))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


WIOR = ROOT / "data/raw/wior.geojson"


def load_wior(features):
    """WIOR works (RD polygons) whose bounding box overlaps the network, converted to WGS84."""
    if not WIOR.exists():
        print("no data/raw/wior.geojson — run explore/fetch_wior.py to add street works")
        return []
    xs, ys = [], []
    for f in features:
        c = f["geometry"]["coordinates"]
        for lon, lat in ([c] if f["geometry"]["type"] == "Point" else c):
            xs.append(lon); ys.append(lat)
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

    def conv(ring):
        return [[round(v, 7) for v in to_wgs84.transform(x, y)] for x, y, *_ in ring]

    out = []
    for f in json.loads(WIOR.read_text())["features"]:
        g = f.get("geometry") or {}
        if g.get("type") == "Polygon":
            polys = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        polys = [[conv(r) for r in p] for p in polys]
        pts = [pt for p in polys for r in p for pt in r]
        if max(p[0] for p in pts) < minx or min(p[0] for p in pts) > maxx or max(p[1] for p in pts) < miny or min(p[1] for p in pts) > maxy:
            continue
        geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
        out.append({"type": "Feature", "geometry": geom, "properties": f["properties"]})
    return out


TEMPLATE = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GIS explorer</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body{margin:0;height:100%;font:13px system-ui,sans-serif}
  #map{position:absolute;inset:0 320px 0 0}
  #side{position:absolute;top:0;right:0;bottom:0;width:320px;overflow:auto;padding:12px;box-sizing:border-box;background:#fafafa;border-left:1px solid #ddd}
  h2{font-size:15px;margin:0 0 8px} h3{font-size:13px;margin:14px 0 6px}
  .row{display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer}
  .sw{width:12px;height:12px;border-radius:2px;flex:none}
  table{border-collapse:collapse;font-size:12px} td{padding:1px 6px 1px 0;vertical-align:top}
  td:first-child{color:#666;white-space:nowrap}
  select{width:100%;padding:4px}
  .note{color:#666;font-size:12px}
</style></head><body>
<div id="map"></div>
<div id="side">
  <h2>GIS explorer</h2>
  <div class="note">Click a feature to see all its properties. Type codes are W-OTL class IDs (first 8 chars) — labels are not in the export.</div>
  <h3>Colour by</h3>
  <select id="colorBy">
    <option value="type">type (W-OTL class)</option>
    <option value="materiaal">material</option>
    <option value="aanlegjaar">construction year</option>
    <option value="diameter">diameter</option>
  </select>
  <h3>Legend <span class="note">(click to hide/show)</span></h3>
  <div id="legend"></div>
  <h3>Selected</h3>
  <div id="info" class="note">nothing selected</div>
</div>
<script>
const data = __DATA__;
const map = L.map('map', {preferCanvas: true});
const base = L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png',
  {maxZoom: 21, maxNativeZoom: 19, attribution: 'Kaart &copy; PDOK / Kadaster'}).addTo(map);
const aerial = L.tileLayer('https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
  {maxZoom: 21, maxNativeZoom: 19, attribution: 'Luchtfoto &copy; PDOK'});
const wiorData = __WIOR__;
const wiorColor = {'Uitvoering': '#7f7f7f', 'Projectaanpak': '#e08a00', 'Ontwerp': '#c0392b'};
const wior = L.geoJSON(wiorData, {
  style: f => ({color: wiorColor[f.properties.hoofdstatus] || '#555', weight: 1, fillOpacity: .18, dashArray: '3 3'}),
  onEachFeature: (f, l) => l.on('click', () => show(Object.assign({'layer': 'WIOR street work'}, f.properties))),
});
L.control.layers({'Map': base, 'Aerial (PDOK)': aerial},
  {[`Street works WIOR (${wiorData.features.length}) — grey: done/ongoing, orange: planned, red: design`]: wior},
  {position: 'topleft', collapsed: false}).addTo(map);

const palette = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf','#393b79','#637939','#8c6d31','#843c39','#7b4173','#3182bd'];
const hidden = new Set();
let colorOf = () => '#333';

function bucket(field, p) {
  const v = p[field];
  if (v === undefined) return '(none)';
  if (field === 'aanlegjaar') { const y = parseInt(v); return isNaN(y) ? '(none)' : (y < 1900 ? '< 1900' : `${Math.floor(y/20)*20}–${Math.floor(y/20)*20+19}`); }
  if (field === 'diameter') { const d = parseFloat(v); return isNaN(d) ? '(none)' : (d < 300 ? '< 300 mm' : d < 500 ? '300–499 mm' : d < 1000 ? '500–999 mm' : '≥ 1000 mm'); }
  return v;
}

function legendFor(field) {
  const counts = {};
  data.features.forEach(f => { const b = bucket(field, f.properties); counts[b] = (counts[b] || 0) + 1; });
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const colors = {}; keys.forEach((k, i) => colors[k] = k === '(none)' ? '#bbb' : palette[i % palette.length]);
  return {keys, counts, colors};
}

let layer;
function render() {
  const field = document.getElementById('colorBy').value;
  const {keys, counts, colors} = legendFor(field);
  colorOf = p => colors[bucket(field, p)];
  if (layer) layer.remove();
  layer = L.geoJSON(data, {
    filter: f => !hidden.has(bucket(field, f.properties)),
    style: f => ({color: colorOf(f.properties), weight: f.properties.maximo ? 6 : 2.5, opacity: .9}),
    pointToLayer: (f, ll) => L.circleMarker(ll, {radius: f.properties.maximo ? 9 : 2, color: colorOf(f.properties), fillOpacity: .8, weight: f.properties.maximo ? 3 : 1}),
    onEachFeature: (f, l) => l.on('click', () => show(f.properties)),
  }).addTo(map);
  const typeHint = p => field === 'type' ? ` <span class="note">${geomOf[p] || ''}</span>` : '';
  document.getElementById('legend').innerHTML = keys.map(k =>
    `<div class="row" data-k="${k}" style="opacity:${hidden.has(k) ? .35 : 1}"><span class="sw" style="background:${colors[k]}"></span>${k} <span class="note">(${counts[k]})</span>${typeHint(k)}</div>`).join('');
  document.querySelectorAll('#legend .row').forEach(r => r.onclick = () => { const k = r.dataset.k; hidden.has(k) ? hidden.delete(k) : hidden.add(k); render(); });
}

const geomOf = {};
data.features.forEach(f => { geomOf[f.properties.type] = f.properties.geom === 'Point' ? 'points' : 'lines'; });

function show(p) {
  document.getElementById('info').innerHTML = '<table>' + Object.entries(p).map(([k, v]) =>
    `<tr><td>${k}</td><td>${String(v).replace(/</g, '&lt;')}</td></tr>`).join('') + '</table>' +
    (p.maximo ? '<p><b>Linked to Maximo location ' + p.maximo + '</b></p>' : '');
}

document.getElementById('colorBy').onchange = () => { hidden.clear(); render(); };
render();
map.fitBounds(layer.getBounds());
</script></body></html>
"""

if __name__ == "__main__":
    main()
