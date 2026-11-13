# AGV Hackathon — Hack the Water Graph

## Structure

```
web/        Next.js site, statically exported and deployed to GitHub Pages
data/raw/   seed data from organisers (git-ignored, keep it out of GitHub)
```

## Run locally

```bash
npm --prefix web install
npm --prefix web run dev
```

## Deployment

`.github/workflows/deploy.yml` builds `web/` with `next build` (static export, see
`output: "export"` in `web/next.config.ts`) and publishes `web/out` to GitHub Pages on every push
to `main` — no per-author restriction like Vercel's free plan has, any team member's push deploys.

One-time setup (repo owner): **Settings → Pages → Source → GitHub Actions**. The site is then
served at `https://capncookdev.github.io/AGV-Hackathon/`.

## Sewer Renewal Dashboard (UC4)

Map + 3D island of the Jan de Jonghstraat sewer network with a defer / reline / replace advice per pipe
(integrated value: FV + SV + EV + risk, Markov decision model).
Live at `https://capncookdev.github.io/AGV-Hackathon/dashboard/` — the deploy workflow copies `dashboard/` into the site.
`dashboard/data/` (generated) is committed so Pages can serve it; raw data in `data/` stays out of git.

To regenerate the dashboard data:

```bash
python3 -m venv .venv && .venv/bin/pip install rdflib pandas openpyxl pyproj ifcopenshell
# put the organisers' Data.zip contents in data/raw/Data/, then:
.venv/bin/python explore/fetch_context.py   # open data: trees, addresses, buildings, BGT, Stadsregie, NDW
.venv/bin/python explore/fetch_wior.py      # Amsterdam street works
.venv/bin/python pipeline/build.py          # -> dashboard/data/
node pipeline/decisions.mjs                 # advice per pipe (default settings)
.venv/bin/python pipeline/build_ifc.py      # -> dashboard/data/sewer.ifc (IFC 4.3)
python3 -m http.server 8780 --directory dashboard
```
