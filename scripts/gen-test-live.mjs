// Fetches World Cup match data from ESPN's public scoreboard API for each
// tournament date and writes public/test-live.json for local dev testing.
//
// Usage:  node scripts/gen-test-live.mjs
//
// The file is loaded by the app automatically when Supabase isn't configured,
// so the Results / Projections tabs show real data in local dev.

const TOURNAMENT_START = "20260611";
const TOURNAMENT_END   = "20260719"; // Final is July 19, 2026
const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// ESPN season.slug → our stage constants.
const SLUG_TO_STAGE = {
  "group-stage":    "GROUP_STAGE",
  "round-of-32":    "LAST_32",
  "round-of-16":    "LAST_16",
  "quarterfinals":  "QUARTER_FINALS",
  "quarterfinal":   "QUARTER_FINALS",
  "semifinals":     "SEMI_FINALS",
  "semifinal":      "SEMI_FINALS",
  "third-place":    "THIRD_PLACE",
  "final":          "FINAL",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function dateRange(start, end) {
  const dates = [];
  const parse = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  const d = parse(start);
  const e = parse(end);
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function fetchDay(date) {
  const url = `${ESPN_BASE}?dates=${date}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${date}`);
  const j = await res.json();
  return j.events || [];
}

function parseEvent(ev) {
  const comp = (ev.competitions && ev.competitions[0]) || null;
  if (!comp) return null;

  const status = comp.status && comp.status.type;
  if (!status) return null;
  const state = status.state; // "pre" | "in" | "post"

  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const teamName = (c) => (c.team && (c.team.displayName || c.team.name)) || null;
  const teamCode = (c) => (c.team && c.team.abbreviation) || null;
  const toScore = (s) => (s == null || s === "" ? null : Number(s));

  // Determine stage from season.slug; group from altGameNote ("FIFA World Cup, Group A").
  const slug = (ev.season && ev.season.slug) || "";
  const altNote = comp.altGameNote || "";

  const stage = SLUG_TO_STAGE[slug] || "GROUP_STAGE";

  let group = null;
  const groupMatch = altNote.match(/Group\s+([A-L])/i);
  if (groupMatch) group = `GROUP_${groupMatch[1].toUpperCase()}`;

  const done = state === "post";
  const inPlay = state === "in";
  const hs = toScore(home.score);
  const as_ = toScore(away.score);

  // Knockout shootout: ESPN exposes shootoutScore on each side. When a draw is
  // decided on pens, the winner comes from the shootout, not the level score.
  const penH = toScore(home.shootoutScore);
  const penA = toScore(away.shootoutScore);
  const penalties = penH != null || penA != null ? { home: penH, away: penA } : null;

  return {
    id: ev.id,
    utcDate: ev.date,
    status: done ? "FINISHED" : inPlay ? "IN_PLAY" : "SCHEDULED",
    stage,
    group,
    home: { code: teamCode(home), name: teamName(home) },
    away: { code: teamCode(away), name: teamName(away) },
    homeScore: done || inPlay ? hs : null,
    awayScore: done || inPlay ? as_ : null,
    penalties: done || inPlay ? penalties : null,
    winner: penalties
      ? penH > penA ? "HOME" : penA > penH ? "AWAY" : null
      : done && hs != null && as_ != null
        ? hs > as_ ? "HOME" : as_ > hs ? "AWAY" : "DRAW"
        : null,
    minute: null,
    venue: comp.venue
      ? { name: comp.venue.fullName || null, city: comp.venue.address?.city || null }
      : null,
  };
}

async function main() {
  const dates = dateRange(TOURNAMENT_START, TOURNAMENT_END);
  console.log(`Fetching ${dates.length} days (${TOURNAMENT_START}–${TOURNAMENT_END}) from ESPN…`);

  const seen = new Set();
  const allMatches = [];

  for (const date of dates) {
    let events;
    try {
      events = await fetchDay(date);
    } catch (e) {
      console.warn(`  ${date}: ${e.message} — skipping`);
      continue;
    }
    let added = 0;
    for (const ev of events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const m = parseEvent(ev);
      if (m) { allMatches.push(m); added++; }
    }
    console.log(`  ${date}: ${events.length} events, ${added} parsed`);
    // Polite delay between requests.
    await new Promise((r) => setTimeout(r, 150));
  }

  // Sort chronologically.
  allMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const stageCounts = {};
  for (const m of allMatches) stageCounts[m.stage] = (stageCounts[m.stage] || 0) + 1;
  console.log("\nStage breakdown:", stageCounts);

  const live = {
    matches: allMatches,
    standings: [],
    updatedAt: new Date().toISOString(),
    source: "ESPN (gen-test-live)",
  };

  const { writeFileSync } = await import("fs");
  writeFileSync("public/test-live.json", JSON.stringify(live, null, 2));
  console.log(`\n✓ Wrote public/test-live.json — ${allMatches.length} matches total.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
