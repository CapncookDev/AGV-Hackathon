"""Download all Amsterdam WIOR records (Werken in de Openbare Ruimte, public open data).

Usage:
    .venv/bin/python explore/fetch_wior.py

Writes data/raw/wior.geojson (geometry in RD New, EPSG:28992).
API docs: https://api.data.amsterdam.nl/v1/wior/
"""

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/raw/wior.geojson"
URL = "https://api.data.amsterdam.nl/v1/wior/wior/?_format=json&_pageSize=1000"


def get(url):
    req = urllib.request.Request(url, headers={"Accept-Crs": "EPSG:28992", "User-Agent": "hackathon-explorer"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    features, url = [], URL
    while url:
        page = get(url)
        rows = next(iter(page.get("_embedded", {}).values()), [])
        for r in rows:
            geom = r.pop("geometrie", None)
            r.pop("_links", None)
            if isinstance(geom, str):
                geom = json.loads(geom.replace("'", '"'))
            features.append({"type": "Feature", "geometry": geom, "properties": r})
        url = (page.get("_links", {}).get("next") or {}).get("href")
        print(f"{len(features)} records…", end="\r")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "crs": "EPSG:28992", "features": features}))
    print(f"\nwrote {OUT} ({len(features)} records, {OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
