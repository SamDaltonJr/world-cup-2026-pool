# Setup & Deploy Guide

This gets your pool live at `https://<your-username>.github.io/<repo-name>/`.
Two services, both free: **Supabase** (shared database) and **GitHub Pages**
(hosting). Plan on ~20 minutes the first time.

---

## 1. Create the Supabase backend

1. Go to <https://supabase.com> and sign in (free tier is fine).
2. **New project** → give it a name (e.g. `world-cup-pool`), set a database
   password (you won't need it for this app), pick a region near you, create.
3. Wait ~2 minutes for it to provision.
4. In the left sidebar open **SQL Editor → New query**. Paste the entire
   contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
   This creates the `kv` table and its access policies.
5. Open **Project Settings → API**. Copy these two values:
   - **Project URL** → this is your `VITE_SUPABASE_URL`
   - **Project API keys → `anon` `public`** → this is your `VITE_SUPABASE_ANON_KEY`

> The anon key is meant to be public — it ships in the website's JavaScript.
> Security comes from the Row-Level Security policies in the SQL, not from
> hiding the key.

### Test locally first (recommended)

```bash
cp .env.example .env
```

Edit `.env` and paste your two values, plus change `VITE_ADMIN_CODE` to your
own commissioner passcode. Then:

```bash
npm install
npm run dev
```

Make a test pick, check the **Leaderboard** tab shows it, then open the
**Commissioner** tab (use your passcode) and confirm the entry appears. If it
works locally, it'll work in production.

---

## 2. Put the code on GitHub

If this folder isn't a git repo yet:

```bash
git init
git add .
git commit -m "World Cup tier pool"
```

Create a new repo on GitHub (e.g. `world-cup-pool`), then:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

> Free GitHub Pages requires a **public** repo. Note: your Supabase anon key
> will be visible in the built site (that's expected). Do **not** commit a
> `.env` file — it's already in `.gitignore`.

---

## 3. Add your secrets to GitHub

In your repo on GitHub: **Settings → Secrets and variables → Actions →
New repository secret**. Add three secrets:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon public key |
| `VITE_ADMIN_CODE` | the commissioner passcode you want |

These are injected at build time by the GitHub Actions workflow.

---

## 4. Turn on GitHub Pages

In your repo: **Settings → Pages → Build and deployment → Source** →
choose **GitHub Actions**.

That's it. The included workflow (`.github/workflows/deploy.yml`) runs on every
push to `main`: it builds the site and deploys it. Watch progress under the
repo's **Actions** tab. When it's green, your site is live at the URL shown in
the deploy step (typically `https://<username>.github.io/<repo-name>/`).

Share that URL with your friends. Share the commissioner passcode only with
yourself / whoever runs the pool.

---

## 5. Live results (optional but recommended)

The **Results** tab and the Commissioner's **Sync from API** button are powered
by a small scheduled job that pulls World Cup scores and group standings from
[football-data.org](https://www.football-data.org/) and writes them into the
same Supabase table the site reads. The site never calls the football API
directly — that would expose the token and hit CORS — so this runs server-side
in GitHub Actions.

1. Get a **free API token**: register at
   <https://www.football-data.org/client/register>. They email you a token.
2. In your repo: **Settings → Secrets and variables → Actions → New repository
   secret**. Add one secret:

   | Name | Value |
   | --- | --- |
   | `FOOTBALL_DATA_TOKEN` | the token from football-data.org |

   (The sync job reuses your existing `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` secrets — no need to re-add those.)
3. The workflow [`.github/workflows/sync-results.yml`](.github/workflows/sync-results.yml)
   runs every ~5 minutes and writes a `live` row into the `kv` table. To kick it
   off immediately, go to the **Actions** tab → **Sync live results** → **Run
   workflow**. Then open the site's **Results** tab — scores and standings
   should appear with an "updated Xm ago" stamp.

> Notes: GitHub's scheduled runs use the **default branch** and have a 5-minute
> minimum (and can be delayed a few minutes under load) — fine for a friendly
> pool. GitHub also pauses scheduled workflows after 60 days with no repo
> activity; a push or a manual run re-arms them. If you'd rather not bother with
> live data at all, just skip this section — the Commissioner tab still works
> fully by hand.

### Live in-play scores (optional add-on)

football-data.org's **free** tier does **not** update scores during a match —
it only posts the result afterward. To show live in-play scores (e.g. "1–0,
39'") while games are being played, the sync can *also* pull from
[api-football](https://www.api-football.com/) (API-Sports), whose free tier
allows live scores (it can't serve the 2026 schedule or standings on free, so
football-data stays the base for those — the two are combined automatically).

1. Get a **free key**: register at
   <https://dashboard.api-football.com/register>; the key is on your dashboard.
2. Add it as another repository secret:

   | Name | Value |
   | --- | --- |
   | `APISPORTS_KEY` | the key from api-football / API-Sports |

That's it — the next sync overlays live scores onto the Results tab, and an open
page auto-refreshes every minute. Leave the secret unset and everything still
works, just without the live overlay.

> How it stays within the free **100 requests/day** cap: the live call only
> fires when a match is in its kickoff window (zero calls off match-hours) and
> only every ~15 minutes, so live scores are fresh to within roughly 15 minutes
> (not a second-by-second ticker). The tournament's busiest day — five
> spread-out matches — costs about 55 calls. A finished match keeps its last
> live score until football-data posts the official final.

### Swapping the data provider

Provider code lives in [`scripts/sync-results.mjs`](scripts/sync-results.mjs):
`fetchFromFootballData` (base: schedule, standings, finals) and `fetchLiveScores`
(api-football live overlay). Both normalize into the small `{ matches, standings }`
shape the site understands, so you can repoint either at a different API if one
disappoints mid-tournament.

## Day-to-day use

- **Players** open the site, go to **Make Picks**, draft their nine teams +
  Golden Boot + tiebreaker, and submit. Resubmitting under the same name
  replaces their picks (until lock).
- **Lock**: entries auto-lock at the opening kickoff (June 11, 2026, 3:00 PM
  ET). The commissioner can also force lock/open early in the Commissioner tab.
- **Results**: a read-only tab showing live/finished match scores, upcoming
  fixtures, and the 12 group tables, pulled from the live feed (section 5). Your
  pool's teams are highlighted. Visible to everyone, no passcode.
- **Commissioner**: after each matchday, open the Commissioner tab. If the live
  feed is set up (section 5), hit **Sync from API** to auto-fill every team's
  group wins/draws, group finish (including the 8 best third-place qualifiers),
  and knockout wins — then **review and adjust** anything before hitting **Save
  results**. Without the feed, enter it all by hand as before. Set the **Golden
  Boot winner** at the end.

## Changing teams, tiers, odds, or scoring

All of it lives near the top of [`src/App.jsx`](src/App.jsx): `SCORING`,
`GOLDEN_BOOT_PTS`, `BOOT_SUGGESTIONS`, and the `TIERS` array. Edit, commit, and
push — the site redeploys automatically. (Do this **before** people make picks;
changing tiers after entries exist can orphan already-picked team IDs.)

## Troubleshooting

- **Warning banner "Supabase isn't configured"** — the build didn't get the env
  vars. Check the three GitHub secrets are spelled exactly as above, then
  re-run the workflow (Actions tab → latest run → Re-run jobs).
- **Entries don't show for other people** — that's the localStorage fallback,
  which means Supabase isn't wired up. Same fix as above.
- **404 / blank page on Pages** — make sure Pages Source is set to
  "GitHub Actions" (not "Deploy from a branch").
- **"Could not load entries"** — confirm you ran `supabase/schema.sql` and that
  the policies were created (Supabase → Authentication → Policies → `kv`).
