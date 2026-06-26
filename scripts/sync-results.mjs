// ============================================================
// Live results sync  ·  football-data.org (+ ESPN live)  ->  Supabase
// ------------------------------------------------------------
// Runs in GitHub Actions on a schedule (see
// .github/workflows/sync-results.yml). It builds a single `live` row in the
// `kv` table the app already reads, combining two free data sources:
//
//   • football-data.org  - the base: full schedule, group standings, and the
//     official final results. (Its free tier does NOT update in-play scores.)
//   • ESPN scoreboard (unofficial, keyless) - overlays LIVE in-play scores
//     during matches via its public soccer/fifa.world scoreboard endpoint. No
//     API key, no account, no daily request cap.
//
// The live call runs on every scheduled run that has a match in its kickoff
// window. When a match finishes it drops off ESPN's "in"-state list, so we
// carry its last live score forward until football-data posts the official
// final.
//
// (Previously the live overlay used api-football / API-Sports, but its free
// tier required an account that could be suspended and capped us at 100
// requests/day. The api-football fetch is kept below, commented out, as a
// drop-in fallback if you ever want to switch back.)
//
// The frontend never calls these APIs directly (that would leak keys and hit
// CORS); this script holds the keys server-side and writes to Supabase.
//
// Required env (GitHub Actions secrets):
//   FOOTBALL_DATA_TOKEN  - free token from https://www.football-data.org/
//   SUPABASE_URL         - Supabase project URL (same as VITE_SUPABASE_URL)
//   SUPABASE_ANON_KEY    - Supabase anon key    (same as VITE_SUPABASE_ANON_KEY)
// (ESPN live scores need no key, so there's no live-source secret anymore.)
//
// Node 20+ (global fetch). No npm dependencies.
// ============================================================

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const COMPETITION = "WC"; // football-data code for the FIFA World Cup
const API_BASE = "https://api.football-data.org/v4";
// ESPN's free, keyless scoreboard for the FIFA World Cup.
const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

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

// football-data usually reports in-progress matches as IN_PLAY/PAUSED, but the
// matches feed sometimes uses the bare "LIVE" status. Map it onto IN_PLAY so the
// app's in-play filters (which key on IN_PLAY/PAUSED) recognize it.
function normStatus(s) {
  return s === "LIVE" ? "IN_PLAY" : s;
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
    status: normStatus(m.status), // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | ...
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

// Top scorers (Golden Boot race). Compact shape keyed to what the app renders.
async function fetchScorers() {
  const j = await apiGet(`/competitions/${COMPETITION}/scorers?limit=25`);
  return (j.scorers || []).map((s) => ({
    name: (s.player && s.player.name) || null,
    nationality: (s.player && s.player.nationality) || null,
    team: (s.team && s.team.name) || null,
    teamTla: (s.team && s.team.tla) || null,
    goals: s.goals ?? 0,
    assists: s.assists ?? null,
    penalties: s.penalties ?? null,
  }));
}

// ---------- ESPN (live in-play scores only) ----------

// Pull every World Cup fixture ESPN currently lists and keep only the ones in
// progress (status state "in"). Returns the same shape the merge step expects:
// { home, away, date, homeScore, awayScore, minute, status }. Finished matches
// are ignored here — football-data's official final is the authority for those.
async function fetchLiveScores() {
  const res = await fetch(ESPN_SCOREBOARD);
  if (!res.ok) throw new Error(`ESPN -> ${res.status} ${res.statusText}`);
  const j = await res.json();

  const out = [];
  for (const ev of j.events || []) {
    const comp = (ev.competitions && ev.competitions[0]) || null;
    const status = (comp && comp.status) || ev.status || null;
    const type = status && status.type;
    // state: "pre" (scheduled) | "in" (live) | "post" (finished).
    if (!comp || !type || type.state !== "in") continue;

    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const teamName = (c) =>
      (c.team && (c.team.displayName || c.team.name)) || null;
    const toScore = (s) => (s == null || s === "" ? null : Number(s));

    // ESPN flags the interval with a halftime status; treat that as PAUSED and
    // everything else in-play. displayClock looks like "67'" — grab the minute.
    const label = (type.name || "") + " " + (type.description || "");
    const paused = /half ?time|HT/i.test(label);
    const clockMatch = /(\d+)/.exec((status && status.displayClock) || "");

    out.push({
      home: teamName(home),
      away: teamName(away),
      date: ev.date,
      homeScore: toScore(home.score),
      awayScore: toScore(away.score),
      minute: paused ? null : clockMatch ? Number(clockMatch[1]) : null,
      status: paused ? "PAUSED" : "IN_PLAY",
    });
  }
  return out;
}

// ---------- api-football (DISABLED fallback live source) ----------
// Kept for reference: swap this in for the ESPN fetchLiveScores above if you
// ever restore an api-football account. Needs APISPORTS_KEY + the AF_BASE /
// AF_WC_LEAGUE constants, and re-add the inWindow throttle in main() (its free
// tier caps at 100 requests/day).
//
// const AF_BASE = "https://v3.football.api-sports.io";
// const AF_WC_LEAGUE = 1; // api-football league id for the World Cup
//
// async function fetchLiveScoresApiFootball() {
//   const res = await fetch(`${AF_BASE}/fixtures?live=all`, {
//     headers: { "x-apisports-key": process.env.APISPORTS_KEY },
//   });
//   if (!res.ok) throw new Error(`api-football -> ${res.status} ${res.statusText}`);
//   const j = await res.json();
//   const errs = j.errors;
//   if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length))
//     throw new Error("api-football errors: " + JSON.stringify(errs));
//   const PAUSED = new Set(["HT", "BT"]); // half-time / break time
//   return (j.response || [])
//     .filter((f) => f.league && f.league.id === AF_WC_LEAGUE)
//     .map((f) => ({
//       home: f.teams?.home?.name,
//       away: f.teams?.away?.name,
//       date: f.fixture?.date,
//       homeScore: f.goals?.home ?? null,
//       awayScore: f.goals?.away ?? null,
//       minute: f.fixture?.status?.elapsed ?? null,
//       status: PAUSED.has(f.fixture?.status?.short) ? "PAUSED" : "IN_PLAY",
//     }));
// }

// Canonicalize a country name so football-data's and ESPN's spellings land on
// the same key. Only the divergent ones need entries; the rest match after
// accent/case stripping.
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

  // Top scorers for the Golden Boot race. Best-effort: if the endpoint isn't
  // available on this plan, keep the last known list rather than blanking it.
  let scorers = (prev && prev.scorers) || [];
  try {
    scorers = await fetchScorers();
  } catch (e) {
    console.error("sync-results: scorers fetch failed:", e.message);
  }

  // Only poll the live feed when a match is plausibly in progress (kickoff
  // window). ESPN is free and keyless with no daily cap, so unlike the old
  // api-football path there's no throttle — every in-window run fetches.
  const now = Date.now();
  const inWindow = fdMatches.some((m) => {
    const ko = new Date(m.utcDate).getTime();
    return now >= ko - 5 * 60000 && now <= ko + 150 * 60000;
  });

  let liveList = [];
  let fetchedLive = false;
  if (inWindow) {
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
    // Timestamp of the last successful live poll (informational).
    liveFetchedAt: fetchedLive
      ? new Date().toISOString()
      : (prev && prev.liveFetchedAt) || null,
    source: "football-data.org + ESPN (live)",
    matches,
    standings,
    scorers,
  };
  await upsertLive(payload);
  console.log(
    `sync-results: stored ${matches.length} matches (${liveCount} live), ` +
      `${standings.length} group tables, ${scorers.length} scorers. ` +
      `window=${inWindow} fetchedLive=${fetchedLive}`
  );
}

main().catch((err) => die(err.message || String(err)));
