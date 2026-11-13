"""Look up sewer-relevant products and their LCA (GWP) in the Madaster API.

Reads MADASTER_API_KEY from .env (git-ignored). Searches the generic databases
(EPEA Generic BENELUX, NMD categories) for pipe / liner / trench materials and
saves the matches with their LCA indicators to data/raw/madaster_products.json.

Usage:
    .venv/bin/python explore/fetch_madaster.py
"""

import json
import os
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.madaster.com/api/v4.0"
KEYWORDS = re.compile(r"riool|rioolbuis|buis|pipe|leiding|pvc|beton|concrete|gres|stoneware|liner|kous|relin|polyester|gvk|grp|zand|sand|asfalt|asphalt", re.I)


def key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("MADASTER_API_KEY="):
            return line.split("=", 1)[1].strip()
    return os.environ["MADASTER_API_KEY"]


def get(path, k):
    req = urllib.request.Request(API + path, headers={"X-API-Key": k, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def name(x):
    n = x.get("names") or {}
    return n.get("nl") or n.get("en") or n.get("iv") or ""


def main():
    k = key()
    dbs = {d["id"]: name(d) for d in get("/database", k)}
    wanted = {i: n for i, n in dbs.items() if re.search(r"EPEA Generic|NMD", n)}
    print("databases:", ", ".join(wanted.values()))
    found = []
    for db, dbname in wanted.items():
        skip = 0
        while True:
            page = get(f"/database/{db}/commodities?skip={skip}&take=500", k)
            if not page:
                break
            for c in page:
                if KEYWORDS.search(name(c)):
                    found.append({"db": dbname, "id": c["id"], "name": name(c), "unit": c.get("functionalUnit")})
            skip += len(page)
            if len(page) < 500:
                break
        print(f"  {dbname}: scanned {skip} products")
    print(f"{len(found)} candidate products, fetching LCA…")
    for f in found:
        try:
            f["lca"] = get(f"/commodity/{f['id']}/lca", k)
        except Exception as e:  # some products have no LCA
            f["lca"] = None
            f["error"] = str(e)[:80]
    out = ROOT / "data/raw/madaster_products.json"
    out.write_text(json.dumps(found, ensure_ascii=False, indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
