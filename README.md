# AGV Hackathon — Hack the Water Graph

## Structure

```
web/        Next.js site, deployed on Vercel
data/raw/   seed data from organisers (git-ignored, keep it out of GitHub)
```

## Run locally

```bash
npm --prefix web install
npm --prefix web run dev
```

## Vercel setup (one-time, repo owner)

1. Sign up at vercel.com with **Continue with GitHub** (as CapncookDev).
2. **Add New → Project →** import `CapncookDev/AGV-Hackathon`.
3. Set **Root Directory** to `web`. Framework preset is detected as Next.js; leave build settings default.
4. **Deploy.** Every push to `main` then deploys to production; other branches get preview URLs.

Note: on the free Hobby plan, deploys from a private repo only run for commits authored by the
Vercel account owner. Commits pushed by other team members are blocked unless the project moves
to Pro or deploys run through GitHub Actions with a Vercel token.
