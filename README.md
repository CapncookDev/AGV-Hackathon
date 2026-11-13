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
