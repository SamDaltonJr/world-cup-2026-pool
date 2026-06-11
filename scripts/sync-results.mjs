// ============================================================
// Live results sync  ·  football-data.org (+ api-football live)  ->  Supabase
// ------------------------------------------------------------
// Runs in GitHub Actions on a schedule (see
// .github/workflows/sync-results.yml). It builds a single `live` row in the
// `kv` table the app already reads, combining two free data sources:
//
//   • football-data.org  - the base: full schedule, group standings, and the
//     official final results. (Its free tier does NOT update in-play scores.)
//   • api-football (API-Sports) - overlays LIVE in-play scores during matches
//     via /fixtures?live=all. Its free tier blocks 2026 standings/fixtures but
//     allows the live endpoint, so we use it ONLY for live scores.
//
// To respect api-football's 100-requests/day free cap, the live call only runs
// when a match is in its kickoff window AND on ~10-minute boundaries. When a
// match finishes it drops off the live feed, so we carry its last live score
// forward until football-data posts the official final.
//
// The frontend never calls these APIs directly (that would leak keys and hit
// CORS); this script holds the keys server-side and writes to Supabase.
//
// Required env (GitHub Actions secrets):
//   FOOTBALL_DATA_TOKEN  - free token from https://www.football-data.org/
//   SUPABASE_URL         - Supabase project URL (same as VITE_SUPABASE_URL)
//   SUPABASE_ANON_KEY    - Supabase anon key    (same as VITE_SUPABASE_ANON_KEY)
// Optional env:
//   APISPORTS_KEY        - free key from https://dashboard.api-football.com/
//                          (omit it and the app still works, just without live
//                          in-play scores)
//
// Node 20+ (global fetch). No npm dependencies.
// ============================================================

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const APISPORTS_KEY = process.env.APISPORTS_KEY;

const COMPETITION = "WC"; // football-data code for the FIFA World Cup
const API_BASE = "https://api.football-data.org/v4";
const AF_BASE = "https://v3.football.api-sports.io";
const AF_WC_LEAGUE = 1; // api-football league id for the World Cup

// How long to keep showing a finished match's last live score before
// football-data's official final is expected to take over.
const CARRY_MS = 12 * 60 * 60 * 1000;

function die(msg) {
  console.error("sync-results: " + msg);
  process.exit(1);
}

if (!FOOTBALL_DATA_TOKEN) die("FOOTBALL_DATA_TOKEN is not set.");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
  die("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");

// ---------- football-data.org (base: schedule, standings, finals) ----------

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
    group: m.group || null,
    matchday: m.matchday ?? null,
    home: normTeam(m.homeTeam),
    away: normTeam(m.awayTeam),
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
    winner: normWinner(m.score?.winner),
    minute: null,
  }));

  const standings = (standingsRes.standings || [])
    .filter((s) => s.type === "TOTAL")
    .map((s) => ({
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

// ---------- api-football (live in-play scores only) ----------

// Canonicalize a country name so football-data's and api-football's spellings
// land on the same key. Only the divergent ones need entries; the rest match
// after accent/case stripping.
const NAME_CANON = {
  "korea republic": "korea",
  "south korea": "korea",
  czechia: "czech",
  "czech republic": "czech",
  turkiye: "turkey",
  turkey: "turkey",
  "united states": "usa",
  usa: "usa",
  "ivory coast": "ivory coast",
  "cote divoire": "ivory coast",
  "cape verde": "cape verde",
  "cabo verde": "cape verde",
  "dr congo": "congo",
  "congo dr": "congo",
  "democratic republic of the congo": "congo",
  "bosnia and herzegovina": "bosnia",
  "bosnia herzegovina": "bosnia",
  "ir iran": "iran",
};

function canon(name) {
  const n = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_CANON[n] || n;
}

// Key a match by its (unordered) team pair + UTC calendar day, so the two
// providers' versions of the same fixture line up regardless of home/away order.
function matchKey(homeName, awayName, dateIso) {
  const day = (dateIso || "").slice(0, 10);
  return [canon(homeName), canon(awayName)].sort().join("|") + "@" + day;
}

async function fetchLiveScores() {
  const res = await fetch(`${AF_BASE}/fixtures?live=all`, {
    headers: { "x-apisports-key": APISPORTS_KEY },
  });
  if (!res.ok) throw new Error(`api-football -> ${res.status} ${res.statusText}`);
  const j = await res.json();
  const errs = j.errors;
  if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length))
    throw new Error("api-football errors: " + JSON.stringify(errs));
  const PAUSED = new Set(["HT", "BT"]); // half-time / break time
  return (j.response || [])
    .filter((f) => f.league && f.league.id === AF_WC_LEAGUE)
    .map((f) => ({
      home: f.teams?.home?.name,
      away: f.teams?.away?.name,
      date: f.fixture?.date,
      homeScore: f.goals?.home ?? null,
      awayScore: f.goals?.away ?? null,
      minute: f.fixture?.status?.elapsed ?? null,
      status: PAUSED.has(f.fixture?.status?.short) ? "PAUSED" : "IN_PLAY",
    }));
}

// Overlay live scores (and carried-forward finals) onto the football-data
// matches. football-data's own FINISHED result always wins once it lands.
function mergeLive(fdMatches, liveList, prevMatches, fetchedLive) {
  const liveByKey = {};
  for (const lv of liveList) liveByKey[matchKey(lv.home, lv.away, lv.date)] = lv;

  const prevByKey = {};
  for (const pm of prevMatches || []) {
    if (pm._live || pm._carried)
      prevByKey[matchKey(pm.home?.name, pm.away?.name, pm.utcDate)] = pm;
  }

  return fdMatches.map((m) => {
    if (m.status === "FINISHED") return m; // official final is authoritative
    const key = matchKey(m.home?.name, m.away?.name, m.utcDate);

    const lv = liveByKey[key];
    if (lv) {
      return {
        ...m,
        status: lv.status,
        homeScore: lv.homeScore,
        awayScore: lv.awayScore,
        minute: lv.minute,
        _live: true,
      };
    }

    const pv = prevByKey[key];
    if (pv && pv.homeScore != null) {
      if (!fetchedLive) {
        // Didn't poll live this tick — preserve whatever we last had so a live
        // match keeps showing live between throttled runs.
        return {
          ...m,
          status: pv.status,
          homeScore: pv.homeScore,
          awayScore: pv.awayScore,
          minute: pv.minute ?? null,
          _live: pv._live,
          _carried: pv._carried,
          _carriedTs: pv._carriedTs,
          _provisional: pv._provisional,
        };
      }
      // We polled live and this match is no longer live -> it just ended.
      // Carry its last score as a provisional final until football-data posts
      // the official one.
      const carriedTs = pv._carriedTs || Date.now();
      if (Date.now() - carriedTs < CARRY_MS) {
        return {
          ...m,
          status: "FINISHED",
          homeScore: pv.homeScore,
          awayScore: pv.awayScore,
          minute: null,
          _carried: true,
          _carriedTs: carriedTs,
          _provisional: true,
        };
      }
    }

    return m;
  });
}

// ---------- Supabase ----------

async function getPrevPayload() {
  try {
    const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/kv?key=eq.live&select=value`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (rows && rows[0] && rows[0].value) return JSON.parse(rows[0].value);
  } catch (e) {
    // first run / unreadable — fine
  }
  return null;
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
  const { matches: fdMatches, standings } = await fetchFromFootballData();
  const prev = await getPrevPayload();

  // Only spend an api-football call when a match is plausibly in progress, and
  // no more than once per ~10 minutes, to stay under the free 100/day cap. The
  // throttle is based on the last fetch timestamp (not the clock minute) so a
  // jittery GitHub cron run doesn't skip the window.
  const now = Date.now();
  const inWindow = fdMatches.some((m) => {
    const ko = new Date(m.utcDate).getTime();
    return now >= ko - 5 * 60000 && now <= ko + 150 * 60000;
  });
  const lastFetch = prev && prev.liveFetchedAt
    ? new Date(prev.liveFetchedAt).getTime()
    : 0;
  const throttleOk = now - lastFetch >= 9 * 60000;

  let liveList = [];
  let fetchedLive = false;
  if (APISPORTS_KEY && inWindow && throttleOk) {
    try {
      liveList = await fetchLiveScores();
      fetchedLive = true;
    } catch (e) {
      console.error("sync-results: live score fetch failed:", e.message);
    }
  }

  const matches = mergeLive(
    fdMatches,
    liveList,
    (prev && prev.matches) || [],
    fetchedLive
  );

  const liveCount = matches.filter((m) => m._live).length;
  const payload = {
    updatedAt: new Date().toISOString(),
    // Preserve the last live-fetch time so the throttle survives across runs.
    liveFetchedAt: fetchedLive
      ? new Date().toISOString()
      : (prev && prev.liveFetchedAt) || null,
    source: APISPORTS_KEY
      ? "football-data.org + api-football (live)"
      : "football-data.org",
    matches,
    standings,
  };
  await upsertLive(payload);
  console.log(
    `sync-results: stored ${matches.length} matches (${liveCount} live), ` +
      `${standings.length} group tables. window=${inWindow} fetchedLive=${fetchedLive}`
  );
}

main().catch((err) => die(err.message || String(err)));
