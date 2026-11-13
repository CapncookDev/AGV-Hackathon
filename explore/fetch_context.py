"""Download open context data for the sewer area from the Amsterdam API.

- trees (bomen/stamgegevens): height, trunk class, protection status
- addresses (bag/verblijfsobjecten): one point per address unit
- Stadsregie works programme (maps.amsterdam.nl open geodata)
- NDW planned roadworks feed (opendata.ndw.nu)

Usage:
    .venv/bin/python explore/fetch_context.py
Writes to data/raw/.
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
# Bounding box (RD New) around the Jan de Jonghstraat sewer network, with margin
AREA = "POLYGON((116200 487600,117800 487600,117800 489100,116200 489100,116200 487600))"
UA = {"User-Agent": "hackathon-explorer"}


def get_json(url, headers=None, tries=4):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except (TimeoutError, OSError) as e:
            if attempt == tries - 1:
                raise
            print(f"  retry {attempt + 1} after {e.__class__.__name__}")


def fetch_api(path, fields, out_name):
    q = urllib.parse.urlencode({"geometrie[intersects]": AREA, "_format": "json", "_pageSize": 1000,
                                "_fields": ",".join(fields + ["geometrie"])})
    url, feats = f"https://api.data.amsterdam.nl/v1/{path}/?{q}", []
    while url:
        page = get_json(url, {"Accept-Crs": "EPSG:28992"})
        for r in next(iter(page.get("_embedded", {}).values()), []):
            geom = r.pop("geometrie", None)
            r.pop("_links", None)
            if isinstance(geom, str):
                geom = json.loads(geom.replace("'", '"'))
            feats.append({"type": "Feature", "geometry": geom, "properties": r})
        url = (page.get("_links", {}).get("next") or {}).get("href")
    (RAW / out_name).write_text(json.dumps({"type": "FeatureCollection", "crs": "EPSG:28992", "features": feats}))
    print(f"{out_name}: {len(feats)} features")


def fetch_file(url, out_name):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        (RAW / out_name).write_bytes(r.read())
    print(f"{out_name}: {(RAW / out_name).stat().st_size / 1e6:.1f} MB")


RD_BBOX = (116200, 487600, 117800, 489100)
RD_CRS = "http://www.opengis.net/def/crs/EPSG/0/28992"


def fetch_ogc(base, out_name, keep=lambda f: True, extra=""):
    """Page through an OGC API Features collection in RD New."""
    q = (f"bbox={','.join(map(str, RD_BBOX))}&bbox-crs={urllib.parse.quote(RD_CRS)}"
         f"&crs={urllib.parse.quote(RD_CRS)}&limit=1000&f=json{extra}")
    url, feats = f"{base}?{q}", []
    while url:
        page = get_json(url)
        feats += [f for f in page.get("features", []) if keep(f)]
        url = next((l["href"] for l in page.get("links", []) if l.get("rel") == "next"), None)
    (RAW / out_name).write_text(json.dumps({"type": "FeatureCollection", "crs": "EPSG:28992", "features": feats}))
    print(f"{out_name}: {len(feats)} features")


def fetch_3dbag_heights(out_name):
    """Building heights from 3DBAG (roof 70th percentile minus ground), keyed by BAG pand id."""
    url = f"https://api.3dbag.nl/collections/pand/items?bbox={','.join(map(str, RD_BBOX))}&limit=500"
    heights = {}
    while url:
        page = get_json(url)
        for f in page.get("features", []):
            for oid, obj in f.get("CityObjects", {}).items():
                a = obj.get("attributes", {})
                if a.get("b3_h_dak_70p") is not None and a.get("b3_h_maaiveld") is not None:
                    heights[oid.split(".")[-1]] = round(a["b3_h_dak_70p"] - a["b3_h_maaiveld"], 1)
        url = next((l["href"] for l in page.get("links", []) if l.get("rel") == "next"), None)
    (RAW / out_name).write_text(json.dumps(heights))
    print(f"{out_name}: {len(heights)} buildings with height")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    current = lambda f: not f["properties"].get("eind_registratie")
    fetch_api("bag/panden", ["identificatie", "oorspronkelijkBouwjaar", "statusOmschrijving", "eindGeldigheid"], "buildings.geojson")
    fetch_3dbag_heights("building_heights.json")
    for coll in ("waterdeel", "wegdeel", "begroeidterreindeel"):
        fetch_ogc(f"https://api.pdok.nl/lv/bgt/ogc/v1/collections/{coll}/items", f"bgt_{coll}.geojson", keep=current)
    fetch_api("bomen/stamgegevens",
              ["id", "boomhoogteklasseActueel", "stamdiameterklasse", "jaarVanAanleg", "soortnaam", "beschermingsstatus"],
              "trees.geojson")
    fetch_api("bag/verblijfsobjecten",
              ["identificatie", "statusOmschrijving", "eindGeldigheid", "gebruiksdoelWoonfunctieOmschrijving"],
              "addresses.geojson")
    fetch_file("https://maps.amsterdam.nl/open_geodata/geojson_lnglat.php/uitvoeringsprogramma-stadsregie.geojson"
               "?KAARTLAAG=STEDELIJKE_PROGRAMMERING&THEMA=uitvoeringsprogramma", "stadsregie.geojson")
    fetch_file("https://opendata.ndw.nu/planningsfeed_wegwerkzaamheden_en_evenementen.xml.gz", "ndw_planning.xml.gz")


if __name__ == "__main__":
    main()
