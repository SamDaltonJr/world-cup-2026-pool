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

## Day-to-day use

- **Players** open the site, go to **Make Picks**, draft their nine teams +
  Golden Boot + tiebreaker, and submit. Resubmitting under the same name
  replaces their picks (until lock).
- **Lock**: entries auto-lock at the opening kickoff (June 11, 2026, 3:00 PM
  ET). The commissioner can also force lock/open early in the Commissioner tab.
- **Commissioner**: after each matchday, open the Commissioner tab, update each
  team's group wins/draws, set how they finished the group, check off knockout
  wins, and hit **Save results**. Set the **Golden Boot winner** at the end.

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
