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
WALL = {"concrete": 0.12, "PVC": 0.035, "stoneware": 0.1, "asbestos cement": 0.08, "cast iron": 0.04, "PE": 0.06}


def api(fn_path, model, **kw):
    mod, fn = fn_path.split(".")
    return getattr(importlib.import_module(f"ifcopenshell.api.{mod}"), fn)(model, **kw)


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
    api("unit.assign_unit", m)
    ctx = api("context.add_context", m, context_type="Model")
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

    products, node_bottom = [], {}
    for p in pipes:
        d = dec.get(p["id"], {"action": "defer"})
        D = p["diameter_mm"] / 1000
        r_in = D / 2
        wall = WALL.get(p["material"], 0.06) * D + 0.01
        ground = p["ground"] if p["ground"] is not None else 0.0
        bb = p["bob_b"] if p["bob_b"] is not None else ground - 1.5
        be = p["bob_e"] if p["bob_e"] is not None else bb
        pts = p["pts"]
        cum = [0.0]
        for i in range(1, len(pts)):
            cum.append(cum[-1] + math.dist(pts[i - 1], pts[i]))
        total = cum[-1] or 1.0
        pts3 = [(x - x0, y - y0, bb + (be - bb) * cum[i] / total + r_in) for i, (x, y) in enumerate(pts)]
        items = [s for s in (cylinder(pts3[i], pts3[i + 1], (r_in + wall) * scale, wall * scale, styles[d["action"]]) for i in range(len(pts3) - 1)) if s]
        if not items:
            continue
        for node, z in ((p["b"], bb), (p["e"], be)):
            node_bottom[node] = min(node_bottom.get(node, 99), z)
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
            "InvertLevelStart_mNAP": round(bb, 3), "InvertLevelEnd_mNAP": round(be, 3)})
        ps = api("pset.add_pset", m, product=el, name="AGV_Condition")
        api("pset.edit_pset", m, pset=ps, properties={
            "ConditionClass": p["cond"], "ConditionSource": "synthetic – Markov ageing from build year",
            "ScaleNote": "1 very good … 6 end of life (organisers' UC4 scale)"})
        ps = api("pset.add_pset", m, product=el, name="AGV_Decision")
        api("pset.edit_pset", m, pset=ps, properties={
            "Advice": d["action"], "IntegratedValueOfActingNow_EUR": d.get("iv_now", 0),
            "DeltaFV_EUR": d.get("dFV", 0), "DeltaSV_EUR": d.get("dSV", 0), "DeltaEV_EUR": d.get("dEV", 0),
            "FV_Now_EUR": d.get("fv_now", 0), "SV_Now_EUR": d.get("sv_now", 0), "EV_MKI_Now_EUR": d.get("ev_now", 0),
            "AdvicePerClass_1to6": d.get("policy", ""),
            "ModelSettings": settings})

    for node_id, bottom in node_bottom.items():
        n = nodes.get(node_id)
        if not n or n["ground"] is None:
            continue
        x, y = n["xy"]
        top = n["ground"]
        is_station = node_id == src["station"]
        solid = cylinder((x - x0, y - y0, bottom - 0.15), (x - x0, y - y0, top), 2.5 if is_station else 0.5 * min(scale, 2), None, manhole_style)
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
        api("pset.edit_pset", m, pset=ps, properties={"GIS_URI": node_id, "GroundLevel_mNAP": round(top, 3), "BottomLevel_mNAP": round(bottom, 3)})

    api("spatial.assign_container", m, relating_structure=site, products=products)
    m.write(str(out))
    n_pipes = sum(1 for e in products if e.is_a("IfcPipeSegment"))
    print(f"wrote {out} (scale {scale}) – {n_pipes} pipes, {len(products) - n_pipes} chambers, {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()                                            # true size (deliverable)
    main(scale=4.0, out=OUT.with_name("sewer_x4.ifc"))  # thicker pipes for the overview
