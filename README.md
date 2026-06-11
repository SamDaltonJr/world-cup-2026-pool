# World Cup 2026 Tier Pool

A Masters-style World Cup pool for a friend group. Each player drafts one team
from each of Tiers 1–7 and two from Tier 8 (nine teams total), plus a Golden
Boot pick and a tiebreaker. Teams earn points all tournament long; the
commissioner enters results and the leaderboard updates live.

- **Make Picks** — draft your nine teams + Golden Boot + tiebreaker.
- **Leaderboard** — live standings, expandable per-team breakdowns.
- **Results** — live/finished match scores and the 12 group tables, pulled from
  a live World Cup feed; your pool's teams are highlighted.
- **Rules** — scoring table and tier listings.
- **Commissioner** — passcode-gated: enter results (or **Sync from API** to
  auto-fill them from the live feed), set the lock, manage entries.

Built with React + Vite + Tailwind. Shared data lives in **Supabase**; the site
is hosted as static files on **GitHub Pages**.

## Run it locally

```bash
npm install
cp .env.example .env   # then fill in your Supabase values
npm run dev
```

Open the URL Vite prints (default http://localhost:5173). Without Supabase
configured the app still runs, but entries are stored only in your browser
(`localStorage`) and a warning banner appears.

## Deploy

See **[SETUP.md](SETUP.md)** for the full walkthrough: creating the Supabase
table, getting your keys, and turning on GitHub Pages with the included
GitHub Actions workflow.

## Project layout

| Path | What it is |
| --- | --- |
| `src/App.jsx` | The whole app UI (picks, leaderboard, rules, commissioner). |
| `src/storage.js` | Key/value layer over Supabase (mirrors the old API). |
| `src/supabaseClient.js` | Supabase client + `isConfigured` flag. |
| `supabase/schema.sql` | Table + Row-Level Security policies to run in Supabase. |
| `scripts/sync-results.mjs` | Pulls schedule/standings/finals (football-data.org) + live in-play scores (api-football) into Supabase. |
| `.github/workflows/deploy.yml` | Builds and deploys to GitHub Pages on push. |
| `.github/workflows/sync-results.yml` | Runs the live-results sync every ~5 min. |
| `.env.example` | Template for local env vars. |

The original standalone component is preserved at `world-cup-tier-pool.jsx`
for reference.
