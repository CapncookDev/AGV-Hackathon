# AGV Hackathon — Hack the Water Graph

Use Case 4: Environmental impact in the asset management decision (function, cost, risk, embodied carbon).

## Structure

```
web/        Next.js site deployed on Vercel (Root Directory = web)
  app/            pages: / , /dashboard , /deck , /video
  components/     Dashboard (CO2 price + risk cap sliders)
  data/results.json   dashboard input — currently SAMPLE data, overwrite with pipeline output
  public/deck.pdf     pitch deck (add when ready)
  site.config.ts      title, video embed URL
data/raw/   seed data from organisers (git-ignored)
```

## Run locally

```bash
npm --prefix web install
npm --prefix web run dev
```

## Data contract (`web/data/results.json`)

```json
{ "assets": [ { "id": "SEW-001", "type": "sewer section", "material": "PVC",
    "diameter_mm": 400, "length_m": 120, "condition": 4,
    "options": [ { "option": "defer|reline|replace", "cost_eur": 0, "gwp_kg": 0,
                   "risk": 0.0, "function": 0.0, "life_years": 0 } ] } ] }
```

Decision rule in the dashboard: `score = cost + λ × GWP(t)`, options with risk above the cap are excluded.
