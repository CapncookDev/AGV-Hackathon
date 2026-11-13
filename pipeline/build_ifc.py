"""Generate an IFC 4.3 model of the sewer network from the GIS graph.

Pipes become IfcPipeSegment (hollow circular sweeps at their real depth, using the
pipe-bottom levels bob_b / bob_e in m NAP), manholes become IfcDistributionChamberElement.
Each pipe carries property sets with its source IDs, (synthetic) condition and the
decision model's advice and integrated value. Pipes are coloured by advice.

Usage (after pipeline/build.py and node pipeline/decisions.mjs):
    .venv/bin/python pipeline/build_ifc.py
Writes dashboard/data/sewer.ifc
"""

import importlib
import json
import math
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.guid

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "data/out"
OUT = ROOT / "dashboard/data/sewer.ifc"

COLOURS = {"defer": (0.31, 0.48, 0.37), "reline": (0.77, 0.52, 0.04), "replace": (0.69, 0.26, 0.18)}
MANHOLE_COLOUR = (0.62, 0.64, 0.66)
RAW = ROOT / "data/raw"
# GeoTOP lithoclasses: colour (rgb) and transparency for the soil layers (IfcGeotechnicalStratum)
LITHO = {
    0: ("made ground (fill)", (0.80, 0.79, 0.76), 0.95), 1: ("peat", (0.45, 0.30, 0.18), 0.45),
    2: ("clay", (0.48, 0.55, 0.42), 0.55), 3: ("clayey sand / loam", (0.62, 0.60, 0.45), 0.6),
    5: ("fine sand", (0.93, 0.82, 0.50), 0.7), 6: ("medium sand", (0.90, 0.76, 0.38), 0.7),
    7: ("coarse sand", (0.85, 0.68, 0.30), 0.7), 8: ("gravel", (0.65, 0.62, 0.58), 0.7), 9: ("shells", (0.95, 0.93, 0.88), 0.7),
}
WALL = {"concrete": 0.12, "PVC": 0.035, "stoneware": 0.1, "asbestos cement": 0.08, "cast iron": 0.04, "PE": 0.06}


def api(fn_path, model, **kw):
    mod, fn = fn_path.split(".")
    return getattr(importlib.import_module(f"ifcopenshell.api.{mod}"), fn)(model, **kw)


def clean_inverts(pipes, nodes):
    """Invert levels (m NAP) per pipe end: {id: (start, end, source)}.

    GIS values are used as they are, except one above ground level, which is a data error.
    A missing or invalid end takes the lowest known invert of the other pipes at the same node,
    else the pipe's other end, else 1.5 m below ground. The source records which rule applied."""
    grounds = sorted(n["ground"] for n in nodes.values() if n.get("ground") is not None)
    g_med = grounds[len(grounds) // 2] if grounds else 0.0

    def ground_at(p, node):
        g = (nodes.get(node) or {}).get("ground")
        return g if g is not None else p["ground"]

    ends, notes = {}, {}
    for p in pipes:
        for side, node in (("bob_b", p["b"]), ("bob_e", p["e"])):
            z, g = p[side], ground_at(p, node)
            if z is not None and g is not None and z > g:
                notes.setdefault(p["id"], []).append(f"{side} {z:.2f} above ground {g:.2f} ignored")
                z = None
            ends[(p["id"], side)] = z

    known = {}
    for p in pipes:
        for side, node in (("bob_b", p["b"]), ("bob_e", p["e"])):
            if node and ends[(p["id"], side)] is not None:
                known.setdefault(node, []).append((p["id"], ends[(p["id"], side)]))

    out = {}
    for p in pipes:
        vals, how = {}, []
        for side, node, other in (("bob_b", p["b"], "bob_e"), ("bob_e", p["e"], "bob_b")):
            z = ends[(p["id"], side)]
            if z is None:
                at_node = [v for pid, v in known.get(node, []) if pid != p["id"]]
                if at_node:
                    z, rule = min(at_node), "lowest invert of connected pipes"
                elif ends[(p["id"], other)] is not None:
                    z, rule = ends[(p["id"], other)], "other end of this pipe"
                else:
                    g = ground_at(p, node)
                    z, rule = (g if g is not None else g_med) - 1.5, "1.5 m below ground"
                how.append(f"{side} estimated: {rule}")
            vals[side] = z
        src = "; ".join(notes.get(p["id"], []) + how) or "GIS"
        out[p["id"]] = (vals["bob_b"], vals["bob_e"], src)
    fixed = sum(1 for v in out.values() if v[2] != "GIS")
    print(f"inverts: {fixed} pipes with an estimated or corrected invert")
    return out


def main(scale=1.0, out=OUT):
    """scale > 1 thickens pipes and manholes for a readable overview; geometry positions stay true."""
    src = json.loads((WORK / "pipes_rd.json").read_text())
    dec_all = json.loads((WORK / "decisions.json").read_text())
    dec, prm = dec_all["pipes"], dec_all["params"]
    settings = f"dashboard defaults: CO2 €{prm['carbon']}/t in MKI, discount {prm['rate']} %"
    pipes, nodes = src["pipes"], src["nodes"]

    xs = [x for p in pipes for x, _ in p["pts"]]
    ys = [y for p in pipes for _, y in p["pts"]]
    x0, y0 = math.floor(min(xs) / 100) * 100, math.floor(min(ys) / 100) * 100

    m = ifcopenshell.file(schema="IFC4X3")
    project = api("root.create_entity", m, ifc_class="IfcProject", name="AGV Hackathon – sewer network Jan de Jonghstraat")
    # every coordinate and size below is in metres (RD New / NAP); the ifcopenshell default would declare
    # millimetres, so other IFC tools would read the network 1,000x too small
    api("unit.assign_unit", m, units=[api("unit.add_si_unit", m, unit_type=t) for t in ("LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT")])
    ctx =api("context.add_context", m, context_type="Model")
    body = api("context.add_context", m, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)

    # georeference: local origin (x0, y0, 0 m NAP) in RD New
    crs = m.createIfcProjectedCRS(Name="EPSG:28992", Description="Amersfoort / RD New", GeodeticDatum="Amersfoort", VerticalDatum="NAP")
    m.createIfcMapConversion(SourceCRS=ctx, TargetCRS=crs, Eastings=float(x0), Northings=float(y0), OrthogonalHeight=0.0)

    site = api("root.create_entity", m, ifc_class="IfcSite", name="Bos en Lommer – Jan de Jonghstraat catchment")
    api("aggregate.assign_object", m, relating_object=project, products=[site])
    origin = m.createIfcAxis2Placement3D(m.createIfcCartesianPoint((0.0, 0.0, 0.0)))
    site.ObjectPlacement = m.createIfcLocalPlacement(None, origin)

    def style(rgb, name):
        colour = m.createIfcColourRgb(None, *rgb)
        return m.createIfcSurfaceStyle(name, "BOTH", [m.createIfcSurfaceStyleShading(colour, 0.0)])

    styles = {k: style(v, k) for k, v in COLOURS.items()}
    manhole_style = style(MANHOLE_COLOUR, "manhole")
    z_axis = m.createIfcDirection((0.0, 0.0, 1.0))

    def cylinder(p0, p1, r_out, wall, sty):
        dx, dy, dz = (p1[i] - p0[i] for i in range(3))
        L = math.sqrt(dx * dx + dy * dy + dz * dz)
        if L < 0.05:
            return None
        axis = (dx / L, dy / L, dz / L)
        ref = (0.0, 0.0, 1.0) if abs(axis[2]) < 0.9 else (1.0, 0.0, 0.0)
        # RefDirection must not be parallel to Axis; take ref × axis
        rd = (ref[1] * axis[2] - ref[2] * axis[1], ref[2] * axis[0] - ref[0] * axis[2], ref[0] * axis[1] - ref[1] * axis[0])
        place = m.createIfcAxis2Placement3D(m.createIfcCartesianPoint(tuple(map(float, p0))),
                                            m.createIfcDirection(axis), m.createIfcDirection(rd))
        prof = (m.createIfcCircleHollowProfileDef("AREA", None, None, r_out, min(wall, r_out * 0.9)) if wall
                else m.createIfcCircleProfileDef("AREA", None, None, r_out))
        solid = m.createIfcExtrudedAreaSolid(prof, place, z_axis, L)
        m.createIfcStyledItem(solid, [sty], None)
        return solid

    def shape(items):
        rep = m.createIfcShapeRepresentation(body, "Body", "SweptSolid", items)
        return m.createIfcProductDefinitionShape(None, None, [rep])

    def placement():
        return m.createIfcLocalPlacement(site.ObjectPlacement, m.createIfcAxis2Placement3D(m.createIfcCartesianPoint((0.0, 0.0, 0.0))))

    inverts = clean_inverts(pipes, nodes)
    products, node_info = [], {}
    for p in pipes:
        d = dec.get(p["id"], {"action": "defer"})
        D = p["diameter_mm"] / 1000
        r_in = D / 2
        wall = WALL.get(p["material"], 0.06) * D + 0.01
        bb, be, inv_src = inverts[p["id"]]
        pts = p["pts"]
        cum = [0.0]
        for i in range(1, len(pts)):
            cum.append(cum[-1] + math.dist(pts[i - 1], pts[i]))
        total = cum[-1] or 1.0
        pts3 = [(x - x0, y - y0, bb + (be - bb) * cum[i] / total + r_in) for i, (x, y) in enumerate(pts)]
        items = [s for s in (cylinder(pts3[i], pts3[i + 1], (r_in + wall) * scale, wall * scale, styles[d["action"]]) for i in range(len(pts3) - 1)) if s]
        if not items:
            continue
        # each pipe end registers at its node, so the chamber can enclose every connected pipe
        r_draw = (r_in + wall) * scale
        for node, xy, c in ((p["b"], pts[0], pts3[0][2]), (p["e"], pts[-1], pts3[-1][2])):
            key = node or f"end:{xy[0]:.2f},{xy[1]:.2f}"
            n = node_info.setdefault(key, {"xy": xy, "bottom": 99.0, "top": -99.0, "r": 0.0, "grounds": []})
            n["bottom"] = min(n["bottom"], c - r_draw)
            n["top"] = max(n["top"], c + r_draw)
            n["r"] = max(n["r"], r_draw)
            if p["ground"] is not None:
                n["grounds"].append(p["ground"])
        el = m.create_entity("IfcPipeSegment", GlobalId=ifcopenshell.guid.new(), Name=f"Pipe {p['id']}",
                             Description=f"{p['kind']} · {p['material']} Ø{p['diameter_mm']} · advice: {d['action']}",
                             ObjectType=p["kind"], PredefinedType="RIGIDSEGMENT")
        el.ObjectPlacement = placement()
        el.Representation = shape(items)
        products.append(el)
        ps = api("pset.add_pset", m, product=el, name="AGV_Source")
        api("pset.edit_pset", m, pset=ps, properties={
            "WOTL_GUID": p["guid"], "GIS_URI": f"https://wkg.waternet.nl/id/{p['guid']}",
            "MaterialCode": p["material_raw"] or "unknown", "Material": p["material"],
            "NominalDiameter_mm": p["diameter_mm"], "YearBuilt": p["year"],
            "InvertLevelStart_mNAP": round(bb, 3), "InvertLevelEnd_mNAP": round(be, 3), "InvertLevelSource": inv_src})
        ps = api("pset.add_pset", m, product=el, name="AGV_Condition")
        api("pset.edit_pset", m, pset=ps, properties={
            "ConditionClass": p["cond"], "ConditionSource": "synthetic – Markov ageing from build year",
            "ScaleNote": "1 very good … 6 end of life (organisers' UC4 scale)"})
        if "settle" in p:
            ps = api("pset.add_pset", m, product=el, name="AGV_Soil")
            api("pset.edit_pset", m, pset=ps, properties={
                "SoilAtPipe": p.get("soil_at_pipe", "unknown"), "PeatBelowPipe_m": p.get("peat_m", 0.0),
                "ClayBelowPipe_m": p.get("clay_m", 0.0), "SettlementRisk": p.get("settle", "unknown"),
                "ExpectedLifeUsed_yr": p.get("life", 0), "LifeMultiplier": p.get("life_mult", 1.0),
                "ReplaceDigSurcharge": p.get("dig_surcharge", 0.0),
                "Source": "TNO GeoTOP v1.6 lithology; peat + clay down to the first sand layer; effects are assumptions"})
        ps = api("pset.add_pset", m, product=el, name="AGV_Decision")
        api("pset.edit_pset", m, pset=ps, properties={
            "Advice": d["action"], "IntegratedValueOfActingNow_EUR": d.get("iv_now", 0),
            "DeltaFV_EUR": d.get("dFV", 0), "DeltaSV_EUR": d.get("dSV", 0), "DeltaEV_EUR": d.get("dEV", 0),
            "FV_Now_EUR": d.get("fv_now", 0), "SV_Now_EUR": d.get("sv_now", 0), "EV_MKI_Now_EUR": d.get("ev_now", 0),
            "AdvicePerClass_1to6": d.get("policy", ""),
            "ModelSettings": settings})

    for node_id, info in node_info.items():
        n = nodes.get(node_id) or {}
        x, y = n.get("xy") or info["xy"]
        # ground level: the node's own, else the mean of its pipes' ground; the chamber always reaches above every pipe
        ground = n.get("ground")
        if ground is None and info["grounds"]:
            ground = sum(info["grounds"]) / len(info["grounds"])
        top = max(ground if ground is not None else info["top"], info["top"] + 0.05)
        bottom = info["bottom"] - 0.15
        is_station = node_id == src["station"]
        # wide enough to hold the thickest connected pipe, so pipes meeting at different levels join inside it
        radius = max(2.5 if is_station else 0.5 * min(scale, 2), info["r"] * 1.15)
        solid = cylinder((x - x0, y - y0, bottom), (x - x0, y - y0, top), radius, None, manhole_style)
        if not solid:
            continue
        el = m.create_entity("IfcDistributionChamberElement", GlobalId=ifcopenshell.guid.new(),
                             Name="Eindgemaal Jan de Jonghstraat" if is_station else "Manhole",
                             PredefinedType="MANHOLE" if not is_station else "USERDEFINED",
                             ObjectType="pumping station" if is_station else None)
        el.ObjectPlacement = placement()
        el.Representation = shape([solid])
        products.append(el)
        ps = api("pset.add_pset", m, product=el, name="AGV_Source")
        api("pset.edit_pset", m, pset=ps, properties={
            "GIS_URI": node_id if not node_id.startswith("end:") else "none (pipe end without node in GIS)",
            "GroundLevel_mNAP": round(ground, 3) if ground is not None else "unknown", "BottomLevel_mNAP": round(bottom, 3)})

    # soil layers: GeoTOP voxel columns under the network, merged per run of the same lithoclass
    geo_path = RAW / "geotop.json"
    if geo_path.exists():
        geo = json.loads(geo_path.read_text())
        zs = geo["z"]
        x_min, x_max, y_min, y_max = min(xs) - 60, max(xs) + 60, min(ys) - 60, max(ys) + 60
        litho_styles = {}
        for code, (name, rgb, tr) in LITHO.items():
            colour = m.createIfcColourRgb(None, *rgb)
            litho_styles[code] = m.createIfcSurfaceStyle(name, "BOTH", [m.createIfcSurfaceStyleShading(colour, tr)])
        geomodel = m.create_entity("IfcGeomodel", GlobalId=ifcopenshell.guid.new(), Name="GeoTOP subsurface model",
                                   Description="TNO GeoTOP v1.6, 100 x 100 x 0.5 m voxels, merged per lithoclass run")
        geomodel.ObjectPlacement = placement()
        strata = []
        for key, col in geo["lithok"].items():
            cx, cy = map(float, key.split(","))
            if not (x_min <= cx <= x_max and y_min <= cy <= y_max):
                continue
            k = 0
            while k < len(col):
                code = col[k]
                k2 = k
                while k2 + 1 < len(col) and col[k2 + 1] == code:
                    k2 += 1
                if code in LITHO:
                    z_bot, z_top = zs[k] - 0.25, zs[k2] + 0.25
                    prof = m.createIfcRectangleProfileDef("AREA", None, None, 100.0, 100.0)
                    pos = m.createIfcAxis2Placement3D(m.createIfcCartesianPoint((cx - x0, cy - y0, z_bot)))
                    solid = m.createIfcExtrudedAreaSolid(prof, pos, z_axis, z_top - z_bot)
                    m.createIfcStyledItem(solid, [litho_styles[code]], None)
                    st = m.create_entity("IfcGeotechnicalStratum", GlobalId=ifcopenshell.guid.new(),
                                         Name=LITHO[code][0], PredefinedType="SOLID")
                    st.ObjectPlacement = placement()
                    st.Representation = shape([solid])
                    ps = api("pset.add_pset", m, product=st, name="AGV_GeoTOP")
                    api("pset.edit_pset", m, pset=ps, properties={
                        "Lithoclass": LITHO[code][0], "LithoclassCode": code, "TopLevel_mNAP": round(z_top, 2),
                        "BottomLevel_mNAP": round(z_bot, 2), "CellCentre_RD": key, "Source": "TNO GeoTOP v1.6 (dinodata.nl)"})
                    strata.append(st)
                k = k2 + 1
        api("aggregate.assign_object", m, relating_object=geomodel, products=strata)
        products.append(geomodel)
        print(f"soil: {len(strata)} geotechnical strata from GeoTOP")

    api("spatial.assign_container", m, relating_structure=site, products=products)
    m.write(str(out))
    n_pipes = sum(1 for e in products if e.is_a("IfcPipeSegment"))
    print(f"wrote {out} (scale {scale}) – {n_pipes} pipes, {len(products) - n_pipes} chambers, {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()                                            # true size (deliverable)
    main(scale=4.0, out=OUT.with_name("sewer_x4.ifc"))  # thicker pipes for the overview
