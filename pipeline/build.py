"""Build the dashboard data set.

Reads the organisers' GIS graph plus open context data (data/raw/) and writes
WGS84 GeoJSON layers to dashboard/data/. The decision model itself runs in the
browser (dashboard/model.js) so sliders can recompute it live; this script only
prepares the per-pipe inputs.

Usage:
    .venv/bin/python explore/fetch_context.py   # once, downloads open data
    .venv/bin/python explore/fetch_wior.py      # once
    .venv/bin/python pipeline/build.py
"""

import gzip
import hashlib
import json
import math
import random
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from xml.etree.ElementTree import iterparse

import rdflib
from pyproj import Transformer
from rdflib import OWL, RDF, URIRef

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
DATA = RAW / "Data"
OUT = ROOT / "dashboard/data"
TODAY = date(2026, 11, 13)

OTL = "https://otl.waternet.nl/def/"
GEO = "http://www.opengis.net/ont/geosparql#"
NEN = "https://w3id.org/nen2660/def#"
GISNS = "https://wkg.waternet.nl/def/gis#"
P_YEAR = URIRef(OTL + "de592649-bb0a-3f79-9887-1d5bd9179a5b")
P_NAME = URIRef(OTL + "e8f4ef80-fffc-3f92-91d9-ae33f0c605d7")

# W-OTL class codes (first 8 chars). Labels are not in the export; names are our reading of the data.
GRAVITY_PIPES = {"934f048a": "main sewer", "80b1ae03": "sewer (PVC network)"}
# Pressure mains (W-OTL 9f7a4396, cast iron) are out of scope: relining them needs pressure-rated liners.
PUMPING_STATION_URI = "https://wkg.waternet.nl/id/0cdd73d6-a8bc-4afd-a610-3c0d8a61c8f2"

# Material class (from the naakt mapping) -> model material. Expected life in years is an ASSUMPTION.
MATERIALS = {
    "beton": ("concrete", 80),
    "kunststof_pvc": ("PVC", 70),
    "kunststof_pe": ("PE", 70),
    "steenachtig_keramisch": ("stoneware", 100),
    "cement_asbestcement": ("asbestos cement", 60),
    "metaal_gietijzer": ("cast iron", 80),
}

# Ecoinvent sheet in the data set: MKI € per unit, and the climate-change part of it.
ECO = {
    "concrete_m3": (25.05, 14.90),     # beton, ongewapend, met transport (m3)
    "pvc_t": (338.9, 150.1),           # PVC, met transport (t)
    "grp_t": (676.4, 213.7),           # glasvezel versterkt kunststof (GVK), met transport (t)
    "soil_t": (0.7386, 0.3028),        # grond, met 20 km transport (t)
    "sand_t": (0.7386, 0.3028),        # zand, met 20 km transport (t)
    "asphalt_t": (8.921, 3.540),       # asfalt, met transport (t)
    "diesel_l": (0.4096, 0.1614),      # diesel (productie+verbranding) (l)
    "demolition_t": (2.695, 1.012),    # sloopproces steenachtig materiaal groot materieel (t)
}

rd_to_wgs = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)
wgs_to_rd = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)


def wgs(x, y):
    lon, lat = rd_to_wgs.transform(x, y)
    return [round(lon, 7), round(lat, 7)]


def parse_wkt(wkt):
    wkt = re.sub(r"^<[^>]+>\s*", "", str(wkt).strip())
    kind, body = wkt.split("(", 1)
    pts = [tuple(map(float, p.split()[:2])) for p in body.strip("() ").split(",")]
    return kind.strip().upper().rstrip("Z").strip(), pts


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def line_dist(px, py, pts):
    return min(seg_dist(px, py, *pts[i], *pts[i + 1]) for i in range(len(pts) - 1))


def in_ring(x, y, ring):
    inside = False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i][:2], ring[i + 1][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


class Grid:
    """Simple spatial hash for points (RD metres)."""

    def __init__(self, cell=25):
        self.cell, self.cells = cell, defaultdict(list)

    def add(self, x, y, item):
        self.cells[(int(x // self.cell), int(y // self.cell))].append((x, y, item))

    def near_line(self, pts, radius):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        c = self.cell
        for i in range(int((min(xs) - radius) // c), int((max(xs) + radius) // c) + 1):
            for j in range(int((min(ys) - radius) // c), int((max(ys) + radius) // c) + 1):
                for x, y, item in self.cells.get((i, j), ()):
                    if line_dist(x, y, pts) <= radius:
                        yield item


def synthetic_condition(pipe_id, age, life):
    """Markov ageing: each year the pipe moves one class worse with p = 4/life, so the mean pipe
    reaches class 5 at its expected life. Seeded per pipe so the result is reproducible."""
    rng = random.Random(int(hashlib.md5(pipe_id.encode()).hexdigest()[:8], 16))
    p, s = 4 / life, 1
    for _ in range(max(0, age)):
        if s < 6 and rng.random() < p:
            s += 1
    return s


def pipe_quantities(d, depth, length, mat):
    """Per-pipe material quantities and MKI (base, climate part) for replace and reline."""
    r = d / 2
    if mat == "concrete":
        t = max(0.04, 0.12 * d + 0.02)
        new_vol = math.pi * ((r + t) ** 2 - r ** 2)
        new_mki, new_clim = new_vol * ECO["concrete_m3"][0], new_vol * ECO["concrete_m3"][1]
        new_mass_t = new_vol * 2.4
    else:  # replaced by PVC
        t = d / 30
        new_mass_t = math.pi * ((r + t) ** 2 - r ** 2) * 1.4
        new_mki, new_clim = new_mass_t * ECO["pvc_t"][0], new_mass_t * ECO["pvc_t"][1]
    width = d + 0.8
    trench = width * depth
    soil_t, sand_t, asphalt_t = trench * 1.8, trench * 1.6, width * 0.1 * 2.4
    diesel_l = 2 + 2 * depth
    old_t = new_mass_t if mat == "concrete" else new_mass_t * 0.5
    parts = [
        (new_mki, new_clim),
        (soil_t * ECO["soil_t"][0], soil_t * ECO["soil_t"][1]),
        (sand_t * ECO["sand_t"][0], sand_t * ECO["sand_t"][1]),
        (asphalt_t * ECO["asphalt_t"][0], asphalt_t * ECO["asphalt_t"][1]),
        (diesel_l * ECO["diesel_l"][0], diesel_l * ECO["diesel_l"][1]),
        (old_t * ECO["demolition_t"][0], old_t * ECO["demolition_t"][1]),
    ]
    rep_mki = sum(p[0] for p in parts) * length
    rep_clim = sum(p[1] for p in parts) * length
    liner_t = math.pi * d * max(0.004, d / 50) * 1.8
    rel_mki = (liner_t * ECO["grp_t"][0] + 1 * ECO["diesel_l"][0]) * length
    rel_clim = (liner_t * ECO["grp_t"][1] + 1 * ECO["diesel_l"][1]) * length
    return {
        "ev_rep": round(rep_mki, 2), "ev_rep_clim": round(rep_clim, 2),
        "ev_rel": round(rel_mki, 2), "ev_rel_clim": round(rel_clim, 2),
    }


def load_graph():
    g = rdflib.Graph()
    g.parse(DATA / "Jan de Jonghstraat/gis-export.ttl")
    m = rdflib.Graph()
    m.parse(DATA / "naakt_wotl_material_mapping.ttl")
    material = {str(s): str(o).split("/")[-1] for s, o in m.subject_objects(OWL.equivalentClass) if str(s).startswith(OTL)}
    return g, material


def value_node(g, s, name):
    for o in g.objects(s, None):
        if isinstance(o, URIRef) and f"/id/{name}/" in str(o):
            v = next(g.objects(o, RDF.value), None)
            return float(v) if v is not None else None
    return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    g, material = load_graph()

    # nodes (manholes etc.) with ground level
    nodes, node_feats = {}, []
    pipes_raw = []
    station = None
    for s, t in g.subject_objects(RDF.type):
        tcode = str(t)[len(OTL):len(OTL) + 8]
        geom = next(g.objects(s, URIRef(GEO + "hasGeometry")), None)
        wkt = next(g.objects(geom, URIRef(GEO + "asWKT")), None) if geom else None
        if wkt is None:
            continue
        kind, pts = parse_wkt(wkt)
        if kind == "POINT":
            ground = value_node(g, s, "maaiveldniveau")
            nodes[str(s)] = {"xy": pts[0], "ground": ground}
            if str(s) == PUMPING_STATION_URI:
                station = {"type": "Feature", "geometry": {"type": "Point", "coordinates": wgs(*pts[0])},
                           "properties": {"name": "Eindgemaal Jan de Jonghstraat", "maximo": "L1004970",
                                          "gis": str(next(g.objects(s, P_NAME), ""))}}
            elif tcode in ("ec8f4c82", "5a6fb8ee"):
                node_feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": wgs(*pts[0])},
                                   "properties": {"name": str(next(g.objects(s, P_NAME), "")),
                                                  "year": str(next(g.objects(s, P_YEAR), ""))}})
        elif kind == "LINESTRING" and tcode in GRAVITY_PIPES:
            mat_raw = next((material.get(str(o), "") for o in g.objects(s, URIRef(NEN + "consistsOf"))), "")
            pipes_raw.append({
                "uri": str(s), "tcode": tcode, "pts": pts, "mat_raw": mat_raw,
                "year": int(str(next(g.objects(s, P_YEAR), "0")) or 0),
                "diam": value_node(g, s, "diameter"),
                "bob_b": value_node(g, s, "bob_b"), "bob_e": value_node(g, s, "bob_e"),
                "b": str(next(g.objects(s, URIRef(GISNS + "sd_beginknoop")), "")),
                "e": str(next(g.objects(s, URIRef(GISNS + "sd_eindknoop")), "")),
            })

    # context layers (RD for analysis, WGS84 for display)
    trees = json.loads((RAW / "trees.geojson").read_text())["features"]
    tree_grid, tree_feats = Grid(), []
    for f in trees:
        x, y = f["geometry"]["coordinates"][:2]
        prot = f["properties"].get("beschermingsstatus")
        tree_grid.add(x, y, bool(prot))
        tree_feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": wgs(x, y)},
                           "properties": {"species": f["properties"].get("soortnaam"),
                                          "height": f["properties"].get("boomhoogteklasseActueel"),
                                          "trunk": f["properties"].get("stamdiameterklasse"),
                                          "planted": f["properties"].get("jaarVanAanleg"),
                                          "protected": prot}})
    addresses = json.loads((RAW / "addresses.geojson").read_text())["features"]
    addr_grid, addr_feats = Grid(), []
    for f in addresses:
        x, y = f["geometry"]["coordinates"][:2]
        addr_grid.add(x, y, 1)
        addr_feats.append([*wgs(x, y)])

    # planned works: Stadsregie (polygons, WGS84), WIOR (polygons RD, planned statuses), NDW (points WGS84)
    planned = []  # (source, name, start, end, hindrance, rings_rd or point_rd)
    stad_feats = []
    for f in json.loads((RAW / "stadsregie.geojson").read_text())["features"]:
        p, geo = f["properties"], f["geometry"]
        polys = [geo["coordinates"]] if geo["type"] == "Polygon" else geo["coordinates"]
        rings = [[wgs_to_rd.transform(lon, lat) for lon, lat, *_ in poly[0]] for poly in polys]
        start = p.get("Tijdvak_geplande_start") if p.get("Tijdvak_geplande_start", "0000")[:4] != "0000" else f"{p.get('GSU_jaar')}-Q{p.get('GSU_kwartaal')}"
        end = p.get("Tijdvak_gepland_einde") if p.get("Tijdvak_gepland_einde", "0000")[:4] != "0000" else f"{p.get('GEU_jaar')}-Q{p.get('GEU_kwartaal')}"
        item = {"source": "Stadsregie", "name": p.get("Projectnaam"), "start": start, "end": end,
                "type": p.get("Projecttype"), "hindrance": p.get("Hindergradatie"), "year": int(p.get("GSU_jaar") or 0)}
        planned.append((item, "rings", rings))
        stad_feats.append({"type": "Feature", "geometry": geo, "properties": item})
    wior_feats = []
    if (RAW / "wior.geojson").exists():
        for f in json.loads((RAW / "wior.geojson").read_text())["features"]:
            geo, p = f.get("geometry") or {}, f["properties"]
            if geo.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            polys = [geo["coordinates"]] if geo["type"] == "Polygon" else geo["coordinates"]
            xs = [pt[0] for poly in polys for pt in poly[0]]
            ys = [pt[1] for poly in polys for pt in poly[0]]
            if max(xs) < 116200 or min(xs) > 117800 or max(ys) < 487600 or min(ys) > 489100:
                continue
            item = {"source": "WIOR", "name": p.get("projectnaam"), "start": p.get("datumStartUitvoering"),
                    "end": p.get("datumEindeUitvoering"), "type": p.get("typeWerkzaamheden"),
                    "status": p.get("hoofdstatus"), "year": int((p.get("datumStartUitvoering") or "0")[:4])}
            if (p.get("datumEindeUitvoering") or "") >= TODAY.isoformat():
                planned.append((item, "rings", [poly[0] for poly in polys]))
            wgs_polys = [[[wgs(x, y) for x, y, *_ in ring] for ring in poly] for poly in polys]
            wior_feats.append({"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": wgs_polys}, "properties": item})
    ndw_feats = []
    if (RAW / "ndw_planning.xml.gz").exists():
        loc = lambda tag: tag.split("}")[-1]
        for _, el in iterparse(gzip.open(RAW / "ndw_planning.xml.gz"), events=("end",)):
            if loc(el.tag) != "situationRecord":
                continue
            lats = [float(e.text) for e in el.iter() if loc(e.tag) == "latitude"]
            lons = [float(e.text) for e in el.iter() if loc(e.tag) == "longitude"]
            if lats and 52.36 < lats[0] < 52.40 and 4.82 < lons[0] < 4.87:
                txt = {loc(e.tag): (e.text or "").strip() for e in el.iter() if (e.text or "").strip()}
                comments = [(e.text or "").strip() for e in el.iter() if loc(e.tag) == "value" and (e.text or "").strip()]
                item = {"source": "NDW", "name": (comments[0] if comments else "roadwork")[:120],
                        "start": txt.get("overallStartTime", "")[:10], "end": txt.get("overallEndTime", "")[:10],
                        "type": txt.get("roadMaintenanceType") or txt.get("causeType"),
                        "hindrance": txt.get("roadworkHindranceClass"), "year": int(txt.get("overallStartTime", "0")[:4] or 0)}
                pts_rd = [wgs_to_rd.transform(lo, la) for lo, la in zip(lons, lats)]
                if item["end"] >= TODAY.isoformat():
                    planned.append((item, "points", pts_rd))
                coords = [[round(lo, 7), round(la, 7)] for lo, la in zip(lons, lats)]
                geom = {"type": "Point", "coordinates": coords[0]} if len(coords) == 1 else {"type": "LineString", "coordinates": coords}
                ndw_feats.append({"type": "Feature", "geometry": geom, "properties": item})
            el.clear()

    # pipes with model inputs
    pipe_feats, rd_rows = [], []
    for p in pipes_raw:
        pts = p["pts"]
        length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        if length < 0.5:
            continue
        key = next((k for k in MATERIALS if p["mat_raw"].startswith(k)), None)
        mat, life = MATERIALS.get(key, ("unknown", 70))
        d = (p["diam"] or 300) / 1000
        year_flag = None
        year = p["year"]
        if year <= 1850 or year == 0:
            year_flag = "year unknown (placeholder)"
            year = TODAY.year - 70
        age = TODAY.year - year
        grounds = [nodes.get(n, {}).get("ground") for n in (p["b"], p["e"])]
        grounds = [x for x in grounds if x is not None]
        bobs = [x for x in (p["bob_b"], p["bob_e"]) if x is not None]
        depth = (sum(grounds) / len(grounds) - sum(bobs) / len(bobs)) if grounds and bobs else 2.0
        depth = max(0.8, min(6.0, depth))
        cond = synthetic_condition(p["uri"], age, life)
        n_addr = sum(1 for _ in addr_grid.near_line(pts, 30))
        near_trees = list(tree_grid.near_line(pts, 4))
        n_prot = sum(1 for prot in tree_grid.near_line(pts, 10) if prot)
        mid = pts[len(pts) // 2]
        works = []
        for item, kind, geom in planned:
            if kind == "rings":
                hit = any(in_ring(x, y, ring) for ring in geom for x, y in pts + [mid]) or \
                      any(line_dist(x, y, pts) < 5 for ring in geom for x, y in ring[:200])
            else:
                hit = any(line_dist(x, y, pts) < 20 for x, y in geom)
            if hit:
                works.append(item)
        works.sort(key=lambda w: str(w.get("start")))
        props = {
            "id": p["uri"].split("/")[-1][:8], "uri": p["uri"],
            "kind": GRAVITY_PIPES[p["tcode"]],
            "material": mat, "material_raw": p["mat_raw"], "life": life,
            "diameter_mm": round(d * 1000), "length_m": round(length, 1), "depth_m": round(depth, 2),
            "year": p["year"], "age": age, "year_flag": year_flag,
            "cond": cond, "cond_synthetic": True,
            "addresses_30m": n_addr, "trees_4m": len(near_trees), "protected_trees_10m": n_prot,
            "planned_works": works[:6],
            "reline_possible": True,
            **pipe_quantities(d, depth, length, mat),
        }
        pipe_feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [wgs(*xy) for xy in pts]},
                           "properties": props})
        rd_rows.append({"id": props["id"], "guid": p["uri"].split("/")[-1], "kind": props["kind"], "pts": pts,
                        "bob_b": p["bob_b"], "bob_e": p["bob_e"], "ground": (sum(grounds) / len(grounds)) if grounds else None,
                        "diameter_mm": props["diameter_mm"], "material": mat, "material_raw": p["mat_raw"],
                        "year": p["year"], "cond": cond, "b": p["b"], "e": p["e"]})

    def dump(name, feats):
        (OUT / name).write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
        print(f"  {name:22} {len(feats):6} features  {(OUT / name).stat().st_size / 1e6:.2f} MB")

    print("dashboard/data:")
    dump("pipes.geojson", pipe_feats)
    dump("manholes.geojson", node_feats)
    dump("trees.geojson", tree_feats)
    dump("stadsregie.geojson", stad_feats)
    dump("wior.geojson", wior_feats)
    dump("ndw.geojson", ndw_feats)
    dump("station.geojson", [station] if station else [])
    (OUT / "addresses.json").write_text(json.dumps(addr_feats, separators=(",", ":")))
    print(f"  addresses.json         {len(addr_feats):6} points")
    # RD-coordinate pipes and nodes for the IFC export (pipeline/build_ifc.py)
    work = ROOT / "data/out"
    work.mkdir(parents=True, exist_ok=True)
    (work / "pipes_rd.json").write_text(json.dumps({
        "pipes": rd_rows,
        "nodes": {k: {"xy": v["xy"], "ground": v["ground"]} for k, v in nodes.items()},
        "station": PUMPING_STATION_URI,
    }))
    build_scene(rd_rows, nodes)
    ifc_src = DATA / "Jan de Jonghstraat/RG Jan de Jonghstraat.ifc"
    if ifc_src.exists():
        (OUT / "station.ifc").write_bytes(ifc_src.read_bytes())
        print(f"  station.ifc            {ifc_src.stat().st_size / 1e6:.1f} MB (BIM model of the pumping station)")
    with_works = sum(1 for f in pipe_feats if f["properties"]["planned_works"])
    print(f"pipes with planned works nearby: {with_works}")


def clip_rect(ring, x0, y0, x1, y1):
    """Sutherland–Hodgman clip of a polygon ring to an axis-aligned rectangle."""
    def clip(pts, inside, cut):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if inside(b):
                if not inside(a):
                    out.append(cut(a, b))
                out.append(b)
            elif inside(a):
                out.append(cut(a, b))
        return out

    def at_x(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) or 1e-9))

    def at_y(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) or 1e-9), y)

    pts = [tuple(p[:2]) for p in ring]
    for inside, cut in ((lambda p: p[0] >= x0, at_x(x0)), (lambda p: p[0] <= x1, at_x(x1)),
                        (lambda p: p[1] >= y0, at_y(y0)), (lambda p: p[1] <= y1, at_y(y1))):
        pts = clip(pts, inside, cut)
        if not pts:
            return []
    return pts


TREE_HEIGHT = {"a": 4, "b": 7.5, "c": 10.5, "d": 13.5, "e": 16.5, "f": 20, "g": 25}


def build_scene(rd_rows, nodes):
    """Local-coordinate 3D scene for the island view: ground block, surface layers, buildings, trees, pipes, manholes."""
    xs = [x for p in rd_rows for x, _ in p["pts"]]
    ys = [y for p in rd_rows for _, y in p["pts"]]
    m = 40
    bx0, by0, bx1, by1 = min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m
    ox, oy = round((bx0 + bx1) / 2), round((by0 + by1) / 2)
    grounds = sorted(n["ground"] for n in nodes.values() if n.get("ground") is not None)
    g0 = grounds[len(grounds) // 2] if grounds else 0.0
    loc = lambda x, y: [round(x - ox, 1), round(y - oy, 1)]

    def polys(path, keep=lambda p: True):
        out = []
        for f in json.loads(path.read_text())["features"]:
            geo = f.get("geometry") or {}
            if not keep(f["properties"]):
                continue
            parts = [geo["coordinates"]] if geo.get("type") == "Polygon" else geo.get("coordinates", []) if geo.get("type") == "MultiPolygon" else []
            for poly in parts:
                ring = clip_rect(poly[0], bx0, by0, bx1, by1)
                if len(ring) >= 3:
                    out.append((f["properties"], [loc(x, y) for x, y in ring]))
        return out

    heights = json.loads((RAW / "building_heights.json").read_text()) if (RAW / "building_heights.json").exists() else {}
    buildings = [{"r": r, "h": heights.get(p.get("identificatie"), 10.0), "y": p.get("oorspronkelijkBouwjaar")}
                 for p, r in polys(RAW / "buildings.geojson", lambda p: not p.get("eindGeldigheid"))]
    roads_types = {"rijbaan lokale weg", "rijbaan regionale weg", "rijbaan autoweg", "rijbaan autosnelweg", "busbaan", "spoorbaan", "baan voor vliegverkeer"}
    surf = {
        "water": [r for _, r in polys(RAW / "bgt_waterdeel.geojson")],
        "road": [r for p, r in polys(RAW / "bgt_wegdeel.geojson", lambda p: p.get("functie") in roads_types)],
        "path": [r for p, r in polys(RAW / "bgt_wegdeel.geojson", lambda p: p.get("functie") not in roads_types)],
        "green": [r for _, r in polys(RAW / "bgt_begroeidterreindeel.geojson")],
    }
    trees = []
    for f in json.loads((RAW / "trees.geojson").read_text())["features"]:
        x, y = f["geometry"]["coordinates"][:2]
        if bx0 <= x <= bx1 and by0 <= y <= by1:
            h = TREE_HEIGHT.get((f["properties"].get("boomhoogteklasseActueel") or "c")[0], 10)
            trees.append([*loc(x, y), h, 1 if f["properties"].get("beschermingsstatus") else 0])

    pipes, bottoms = {}, {}
    for p in rd_rows:
        r = p["diameter_mm"] / 2000
        gr = p["ground"] if p["ground"] is not None else g0
        bb = p["bob_b"] if p["bob_b"] is not None else gr - 1.5
        be = p["bob_e"] if p["bob_e"] is not None else bb
        cum = [0.0]
        for i in range(1, len(p["pts"])):
            cum.append(cum[-1] + math.dist(p["pts"][i - 1], p["pts"][i]))
        tot = cum[-1] or 1
        pipes[p["id"]] = [[*loc(x, y), round(bb + (be - bb) * cum[i] / tot + r - g0, 2)] for i, (x, y) in enumerate(p["pts"])]
        for n, z in ((p["b"], bb), (p["e"], be)):
            bottoms[n] = min(bottoms.get(n, 99), z)
    manholes = [[*loc(*nodes[n]["xy"]), round((nodes[n]["ground"] if nodes[n]["ground"] is not None else g0) - g0, 2), round(z - g0, 2)]
                for n, z in bottoms.items() if n in nodes]
    st = nodes.get(PUMPING_STATION_URI)
    scene = {"origin": [ox, oy], "ground_nap": g0, "bounds": [round(bx0 - ox), round(by0 - oy), round(bx1 - ox), round(by1 - oy)],
             "buildings": buildings, "surface": surf, "trees": trees, "pipes": pipes, "manholes": manholes,
             "station": loc(*st["xy"]) if st else None,
             "min_z": round(min(z for pts in pipes.values() for *_, z in pts), 2)}
    (OUT / "scene.json").write_text(json.dumps(scene, separators=(",", ":")))
    print(f"  scene.json             {(OUT / 'scene.json').stat().st_size / 1e6:.1f} MB · {len(buildings)} buildings, "
          f"{sum(len(v) for v in surf.values())} surface polygons, {len(trees)} trees, deepest pipe {scene['min_z']} m")


if __name__ == "__main__":
    main()
