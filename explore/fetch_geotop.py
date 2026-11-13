"""Download the GeoTOP lithology (TNO, 100 x 100 x 0.5 m voxels) for the sewer area via OPeNDAP.

Writes data/raw/geotop.json: x/y cell centres (RD New), z levels (m NAP) and lithoclass per voxel
for the top of the subsurface (about +2 to -12 m NAP), where the sewers and their foundation soil are.

GeoTOP lithoclasses: 0 anthropogenic, 1 peat, 2 clay, 3 clayey sand / sandy clay / loam,
5 fine sand, 6 medium sand, 7 coarse sand, 8 gravel, 9 shells.

Usage:
    .venv/bin/python explore/fetch_geotop.py
"""

import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://www.dinodata.nl/opendap/GeoTOP/geotop.nc"
BBOX = (116200, 487600, 117800, 489100)
Z_RANGE = (-12.0, 2.0)


def ascii_get(query):
    with urllib.request.urlopen(f"{BASE}.ascii?{query}", timeout=180) as r:
        return r.read().decode()


def numbers(text):
    return [float(v) for v in re.findall(r"-?\d+\.?\d*(?:e-?\d+)?", text)]


def axis(name):
    body = ascii_get(name).split("\n", 1)[1]           # skip the header line
    return numbers(body)


def main():
    xs, ys, zs = axis("x"), axis("y"), axis("z")
    xi = [i for i, v in enumerate(xs) if BBOX[0] - 50 <= v <= BBOX[2] + 50]
    yi = [i for i, v in enumerate(ys) if BBOX[1] - 50 <= v <= BBOX[3] + 50]
    zi = [i for i, v in enumerate(zs) if Z_RANGE[0] <= v <= Z_RANGE[1]]
    q = f"lithok[{xi[0]}:1:{xi[-1]}][{yi[0]}:1:{yi[-1]}][{zi[0]}:1:{zi[-1]}]"
    txt = ascii_get(q)
    # rows look like "lithok.lithok[lithok.x=113600][lithok.y=488500], v1, v2, ..." (one row per column, values per z)
    grid = {}
    for line in txt.splitlines():
        m = re.match(r"\s*lithok\.lithok\[lithok\.x=([\d.]+)\]\[lithok\.y=([\d.]+)\],\s*(.*)", line)
        if m:
            grid[f"{int(float(m.group(1)))},{int(float(m.group(2)))}"] = [int(float(v)) for v in m.group(3).split(",")]
    out = {
        "x": [xs[i] for i in xi], "y": [ys[j] for j in yi], "z": [zs[k] for k in zi],
        "lithok": grid,  # key "x,y" = cell centre in RD New, values per z level
        "classes": {"0": "anthropogenic", "1": "peat", "2": "clay", "3": "clayey sand / loam", "5": "fine sand",
                    "6": "medium sand", "7": "coarse sand", "8": "gravel", "9": "shells", "-127": "no data"},
        "source": "TNO GeoTOP v1.6 via OPeNDAP (dinodata.nl)",
    }
    dest = ROOT / "data/raw/geotop.json"
    dest.write_text(json.dumps(out))
    print(f"wrote {dest}: {len(out['x'])} x {len(out['y'])} columns, {len(out['z'])} layers ({out['z'][0]}..{out['z'][-1]} m NAP)")


if __name__ == "__main__":
    main()
