// ============================================================
// Live results sync  ·  football-data.org  ->  Supabase `kv`
// ------------------------------------------------------------
// Runs in GitHub Actions on a schedule (see
// .github/workflows/sync-results.yml). It fetches the World Cup matches and
// group standings, normalizes them into a small provider-agnostic shape, and
// upserts a single `live` row into the same `kv` table the app already reads.
//
// The frontend never calls the football API directly — that would leak the
// token and hit CORS. This script holds the token server-side and writes the
// result where the site already looks (Supabase). To swap providers, replace
// `fetchFromFootballData` with another fetcher that returns the same shape.
//
// Required env (set as GitHub Actions secrets):
//   FOOTBALL_DATA_TOKEN   - free token from https://www.football-data.org/
//   SUPABASE_URL          - your Supabase project URL (same as VITE_SUPABASE_URL)
//   SUPABASE_ANON_KEY     - your Supabase anon key   (same as VITE_SUPABASE_ANON_KEY)
//
// Node 20+ (global fetch). No npm dependencies.
// ============================================================

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// football-data.org competition code for the FIFA World Cup.
const COMPETITION = "WC";
const API_BASE = "https://api.football-data.org/v4";

function die(msg) {
  console.error("sync-results: " + msg);
  process.exit(1);
}

if (!FOOTBALL_DATA_TOKEN) die("FOOTBALL_DATA_TOKEN is not set.");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
  die("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");

async function apiGet(path) {
  const res = await fetch(API_BASE + path, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} -> ${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

// football-data uses HOME_TEAM / AWAY_TEAM / DRAW; normalize to HOME/AWAY/DRAW.
function normWinner(w) {
  if (w === "HOME_TEAM") return "HOME";
  if (w === "AWAY_TEAM") return "AWAY";
  if (w === "DRAW") return "DRAW";
  return null;
}

function normTeam(t) {
  if (!t) return { code: null, name: null, crest: null };
  return { code: t.tla || null, name: t.name || null, crest: t.crest || null };
}

async function fetchFromFootballData() {
  const [matchesRes, standingsRes] = await Promise.all([
    apiGet(`/competitions/${COMPETITION}/matches`),
    apiGet(`/competitions/${COMPETITION}/standings`),
  ]);

  const matches = (matchesRes.matches || []).map((m) => ({
    id: m.id,
    utcDate: m.utcDate,
    status: m.status, // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | ...
    stage: m.stage, // GROUP_STAGE | LAST_32 | LAST_16 | QUARTER_FINALS | ...
    group: m.group || null, // "GROUP_A" or null in knockouts
    matchday: m.matchday ?? null,
    home: normTeam(m.homeTeam),
    away: normTeam(m.awayTeam),
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
    winner: normWinner(m.score?.winner), // accounts for extra time / penalties
  }));

  // Keep only the overall (TOTAL) table for each group.
  const standings = (standingsRes.standings || [])
    .filter((s) => s.type === "TOTAL")
    .map((s) => ({
      // The standings endpoint labels groups "Group A" while the matches
      // endpoint uses "GROUP_A" — normalize both down to just "A".."L".
      group: (s.group || "").replace(/^group[\s_]*/i, ""),
      table: (s.table || []).map((r) => ({
        position: r.position,
        code: r.team?.tla || null,
        name: r.team?.name || null,
        crest: r.team?.crest || null,
        played: r.playedGames ?? 0,
        won: r.won ?? 0,
        draw: r.draw ?? 0,
        lost: r.lost ?? 0,
        gf: r.goalsFor ?? 0,
        ga: r.goalsAgainst ?? 0,
        gd: r.goalDifference ?? 0,
        points: r.points ?? 0,
      })),
    }));

  return { matches, standings };
}

async function upsertLive(value) {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/kv?on_conflict=key`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      key: "live",
      // The app stores kv values as JSON strings (it JSON.parse's on read).
      value: JSON.stringify(value),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase upsert -> ${res.status} ${res.statusText} ${body}`);
  }
}

async function main() {
  const { matches, standings } = await fetchFromFootballData();
  const payload = {
    updatedAt: new Date().toISOString(),
    source: "football-data.org",
    matches,
    standings,
  };
  await upsertLive(payload);
  console.log(
    `sync-results: stored ${matches.length} matches, ${standings.length} group tables.`
  );
}

main().catch((err) => die(err.message || String(err)));
