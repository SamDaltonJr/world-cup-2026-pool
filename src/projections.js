// ============================================================
// PROJECTIONS  ·  Elo-driven Monte Carlo of the rest of the tournament
// ------------------------------------------------------------
// Given the live feed (group fixtures + results) this simulates the remaining
// matches thousands of times to estimate, per team:
//   • probability of reaching each knockout round (and winning the cup)
//   • expected pool points, scored with the app's own scoring function
// and, when handed the pool entries, each entry's projected total and the
// probability it finishes first.
//
// The engine is pure and self-contained: it owns the Elo snapshot and the 2026
// bracket structure, and takes everything else (the live feed, a team resolver,
// and the scoring function) as arguments so it never imports from App.jsx.
//
// Modeling choices, all easy to tune at the top of this file:
//   • Group matches are simulated as independent Poisson scorelines whose means
//     come from the two teams' Elo gap (so goal difference / goals for fall out
//     naturally for the group and third-place tiebreakers).
//   • Knockout matches resolve to a single winner via the logistic Elo formula
//     (extra time / penalties folded in — we only need who advances).
//   • Matches already FINISHED in the feed are locked to their real result, so
//     projections sharpen as the tournament is played.
//   • Hosts (USA/Canada/Mexico) carry a small Elo bump in every match.
//
// Third-place routing is exact: which of the eight qualifying third-place teams
// lands in which Round-of-32 slot uses FIFA's official 495-row allocation table
// (Annex C), keyed by the sorted set of qualifying groups. See
// ./thirdsAllocation.js. A bipartite-matching fallback is retained but never
// reached for a valid 8-of-12 set.
// ============================================================

import { THIRDS_ALLOCATION, THIRD_SEAT_MATCH } from "./thirdsAllocation.js";

// Current Elo snapshot (≈14 June 2026). Top tier from eloratings.net; the rest
// from international-football.net's table on the same date (both anchored on the
// same scale — e.g. Senegal 1860, Mexico 1881 agree across the two). Keyed by
// the pool's FIFA three-letter ids. Edit these to re-tune team strength.
export const TEAM_ELO = {
  ESP: 2157, ARG: 2115, FRA: 2063, ENG: 2024, POR: 1989, COL: 1982, BRA: 1978,
  NED: 1944, GER: 1939, NOR: 1914, TUR: 1911, CRO: 1912, JPN: 1910, BEL: 1894,
  URU: 1892, ECU: 1890, MEX: 1881, SUI: 1865, SEN: 1860, PAR: 1834, AUT: 1830,
  MAR: 1827, CAN: 1788, KOR: 1786, SCO: 1782, AUS: 1777, ALG: 1772, IRN: 1772,
  PAN: 1730, USA: 1726, UZB: 1714, SWE: 1712, CZE: 1712, EGY: 1696, CIV: 1695,
  JOR: 1680, COD: 1652, TUN: 1628, IRQ: 1607, BIH: 1595, CPV: 1578, KSA: 1576,
  NZL: 1562, HAI: 1548, GHA: 1510, RSA: 1511, CUW: 1434, QAT: 1421,
};

const DEFAULT_ELO = 1500; // fallback for any id missing above
const HOST_IDS = new Set(["USA", "CAN", "MEX"]);

// --- Tunable model constants ---
const HOST_BONUS = 70; // Elo points added to a host team in every match
const GOAL_DIV = 200; // Elo gap per 1.0 goal of expected supremacy (group sims)
const BASE_GOALS = 2.7; // expected combined goals in a neutral group match
const KO_DIV = 400; // standard Elo logistic denominator (knockout win prob)
const K_WC = 60; // Elo K-factor for World Cup matches (eloratings.net value)
const DEFAULT_SIMS = 10000;

// Host-adjusted rating lookup against a given Elo map (snapshot or live-updated).
function adjElo(elo, id) {
  return (elo[id] != null ? elo[id] : DEFAULT_ELO) + (HOST_IDS.has(id) ? HOST_BONUS : 0);
}

// Replay every finished match through the World Football Elo update to get each
// team's CURRENT rating, so the simulation predicts the remaining games from
// in-tournament form rather than the static pre-tournament snapshot. Uses the
// eloratings.net formula: change = K · G · (W − Wₑ), with K=60 for the World
// Cup, G a goal-difference multiplier, and Wₑ the host-adjusted expectation.
// Returns a fresh { id -> rating } map; TEAM_ELO is left untouched.
function liveElo(live, resolveTeam, stageToKo) {
  const elo = { ...TEAM_ELO };
  const finished = ((live && live.matches) || [])
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        m.homeScore != null &&
        m.awayScore != null &&
        !m._provisional
    )
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  for (const m of finished) {
    const h = resolveTeam(m.home && m.home.code, m.home && m.home.name);
    const a = resolveTeam(m.away && m.away.code, m.away && m.away.name);
    if (!h || !a) continue;
    const we = 1 / (1 + Math.pow(10, -(adjElo(elo, h) - adjElo(elo, a)) / 400));
    const diff = Math.abs(m.homeScore - m.awayScore);
    const g = diff <= 1 ? 1 : diff === 2 ? 1.5 : (11 + diff) / 8;
    const wh = m.homeScore > m.awayScore ? 1 : m.homeScore === m.awayScore ? 0.5 : 0;
    const delta = K_WC * g * (wh - we);
    elo[h] = (elo[h] != null ? elo[h] : DEFAULT_ELO) + delta;
    elo[a] = (elo[a] != null ? elo[a] : DEFAULT_ELO) - delta;
  }
  return elo;
}

// Knuth's Poisson sampler — fine for the small means (≤ ~4) we use here.
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Simulate a group match, returning [homeGoals, awayGoals]. The Elo gap sets the
// expected supremacy; each side's goals are an independent Poisson draw.
function groupLambdas(elo, idH, idA) {
  const sup = (adjElo(elo, idH) - adjElo(elo, idA)) / GOAL_DIV;
  return [
    Math.max(0.15, Math.min(5, BASE_GOALS / 2 + sup / 2)),
    Math.max(0.15, Math.min(5, BASE_GOALS / 2 - sup / 2)),
  ];
}

function simScoreline(elo, idH, idA) {
  const [lamH, lamA] = groupLambdas(elo, idH, idA);
  return [poisson(lamH), poisson(lamA)];
}

// Simulate the rest of an in-progress match: keep the current score and add
// goals over the minutes still to play. Scoring is a memoryless Poisson process,
// so the remaining rate is just the full-match rate scaled by the fraction of
// the match left — goals already on the board carry forward unchanged.
function simScorelineLive(elo, idH, idA, live) {
  const [lamH, lamA] = groupLambdas(elo, idH, idA);
  const rem =
    live.minute == null
      ? 0.5
      : Math.max(0, Math.min(1, (90 - live.minute) / 90));
  return [live.gh + poisson(lamH * rem), live.ga + poisson(lamA * rem)];
}

// Knockout: probability the first team beats the second (draws resolved by
// ET/penalties are folded into this single number).
function koWinProb(elo, idA, idB) {
  const dr = adjElo(elo, idA) - adjElo(elo, idB);
  return 1 / (1 + Math.pow(10, -dr / KO_DIV));
}

// Poisson probability mass at k for mean lam.
function poissonPmf(lam, k) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lam) * Math.pow(lam, k)) / fact;
}

// Analytic prediction for a single upcoming match from the two teams' Elo. For
// group games (draws allowed) it convolves the two Poisson scoring distributions
// into P(home win)/P(draw)/P(away win); for knockouts it uses the logistic
// win probability (no draw). The projected scoreline is each side's expected
// goals, rounded. Mirrors the simulation's match model so the two agree.
function predictMatch(elo, idH, idA, isGroup) {
  if (!isGroup) {
    const p = koWinProb(elo, idH, idA);
    return { pH: p, pD: 0, pA: 1 - p, scoreH: null, scoreA: null };
  }
  const sup = (adjElo(elo, idH) - adjElo(elo, idA)) / GOAL_DIV;
  const lamH = Math.max(0.15, Math.min(5, BASE_GOALS / 2 + sup / 2));
  const lamA = Math.max(0.15, Math.min(5, BASE_GOALS / 2 - sup / 2));
  const MAXG = 10;
  const ph = [];
  const pa = [];
  for (let k = 0; k <= MAXG; k++) {
    ph[k] = poissonPmf(lamH, k);
    pa[k] = poissonPmf(lamA, k);
  }
  let pH = 0;
  let pD = 0;
  let pA = 0;
  for (let h = 0; h <= MAXG; h++) {
    for (let a = 0; a <= MAXG; a++) {
      const p = ph[h] * pa[a];
      if (h > a) pH += p;
      else if (h < a) pA += p;
      else pD += p;
    }
  }
  return { pH, pD, pA, scoreH: Math.round(lamH), scoreA: Math.round(lamA) };
}

// Live win/draw/win probabilities for an in-progress match: only the goals still
// to come are random (Poisson scaled by minutes left), added onto the current
// score. The analytic twin of simScorelineLive.
function predictLive(elo, idH, idA, cur) {
  const [fullH, fullA] = groupLambdas(elo, idH, idA);
  const rem =
    cur.minute == null
      ? 0.5
      : Math.max(0, Math.min(1, (90 - cur.minute) / 90));
  const lamH = fullH * rem;
  const lamA = fullA * rem;
  const MAXG = 12;
  const ph = [];
  const pa = [];
  for (let k = 0; k <= MAXG; k++) {
    ph[k] = poissonPmf(lamH, k);
    pa[k] = poissonPmf(lamA, k);
  }
  let pH = 0;
  let pD = 0;
  let pA = 0;
  for (let rh = 0; rh <= MAXG; rh++) {
    for (let ra = 0; ra <= MAXG; ra++) {
      const p = ph[rh] * pa[ra];
      const fh = cur.gh + rh;
      const fa = cur.ga + ra;
      if (fh > fa) pH += p;
      else if (fh < fa) pA += p;
      else pD += p;
    }
  }
  return { pH, pD, pA };
}

// ---------- 2026 bracket structure (fixed; from the official draw) ----------
// Round of 32. Each slot is a group winner (W), runner-up (R), or one of the
// eight third-place qualifiers drawn from a fixed cluster of groups (3 + from).
const R32 = [
  { m: 73, a: { t: "R", g: "A" }, b: { t: "R", g: "B" } },
  { m: 74, a: { t: "W", g: "E" }, b: { t: "3", from: ["A", "B", "C", "D", "F"] } },
  { m: 75, a: { t: "W", g: "F" }, b: { t: "R", g: "C" } },
  { m: 76, a: { t: "W", g: "C" }, b: { t: "R", g: "F" } },
  { m: 77, a: { t: "W", g: "I" }, b: { t: "3", from: ["C", "D", "F", "G", "H"] } },
  { m: 78, a: { t: "R", g: "E" }, b: { t: "R", g: "I" } },
  { m: 79, a: { t: "W", g: "A" }, b: { t: "3", from: ["C", "E", "F", "H", "I"] } },
  { m: 80, a: { t: "W", g: "L" }, b: { t: "3", from: ["E", "H", "I", "J", "K"] } },
  { m: 81, a: { t: "W", g: "D" }, b: { t: "3", from: ["B", "E", "F", "I", "J"] } },
  { m: 82, a: { t: "W", g: "G" }, b: { t: "3", from: ["A", "E", "H", "I", "J"] } },
  { m: 83, a: { t: "R", g: "K" }, b: { t: "R", g: "L" } },
  { m: 84, a: { t: "W", g: "H" }, b: { t: "R", g: "J" } },
  { m: 85, a: { t: "W", g: "B" }, b: { t: "3", from: ["E", "F", "G", "I", "J"] } },
  { m: 86, a: { t: "W", g: "J" }, b: { t: "R", g: "H" } },
  { m: 87, a: { t: "W", g: "K" }, b: { t: "3", from: ["D", "E", "I", "J", "L"] } },
  { m: 88, a: { t: "R", g: "D" }, b: { t: "R", g: "G" } },
];

// Later rounds: each match takes the winners of two earlier matches.
const LATER_ROUNDS = {
  r16: [
    { m: 89, a: 74, b: 77 }, { m: 90, a: 73, b: 75 },
    { m: 91, a: 76, b: 78 }, { m: 92, a: 79, b: 80 },
    { m: 93, a: 83, b: 84 }, { m: 94, a: 81, b: 82 },
    { m: 95, a: 86, b: 88 }, { m: 96, a: 85, b: 87 },
  ],
  qf: [
    { m: 97, a: 89, b: 90 }, { m: 98, a: 93, b: 94 },
    { m: 99, a: 91, b: 92 }, { m: 100, a: 95, b: 96 },
  ],
  sf: [
    { m: 101, a: 97, b: 98 }, { m: 102, a: 99, b: 100 },
  ],
  // Final (104) and third-place match (103) are handled explicitly below.
};

// The eight Round-of-32 slots that take a third-place team, with their allowed
// group clusters. Used to route the qualifying thirds into the bracket.
const THIRD_SLOTS = R32.filter((x) => x.b.t === "3").map((x) => ({
  m: x.m,
  from: new Set(x.b.from),
}));

// Which two earlier matches feed each later match (plus the final). Used both to
// order the bracket for display and to walk the tree top-to-bottom.
const FEEDERS = { 104: [101, 102] };
["sf", "qf", "r16"].forEach((round) =>
  LATER_ROUNDS[round].forEach((mt) => (FEEDERS[mt.m] = [mt.a, mt.b]))
);

// Top-to-bottom display order for a left-aligned bracket: an in-order walk of the
// binary tree from the final down to the Round-of-32 leaves. Each round is then
// ordered by the position of its subtree's first leaf, so columns line up.
const BRACKET_ORDER = (() => {
  const leaves = [];
  const inorder = (m) => {
    const f = FEEDERS[m];
    if (!f) return leaves.push(m);
    inorder(f[0]);
    inorder(f[1]);
  };
  inorder(104);
  const leafIndex = {};
  leaves.forEach((m, i) => (leafIndex[m] = i));
  const firstLeaf = (m) =>
    FEEDERS[m] ? firstLeaf(FEEDERS[m][0]) : leafIndex[m];
  const byLeaf = (a, b) => firstLeaf(a) - firstLeaf(b);
  return {
    r32: leaves,
    r16: LATER_ROUNDS.r16.map((x) => x.m).sort(byLeaf),
    qf: LATER_ROUNDS.qf.map((x) => x.m).sort(byLeaf),
    sf: LATER_ROUNDS.sf.map((x) => x.m).sort(byLeaf),
  };
})();

// A short label for a Round-of-32 seat before any team has filled it: group
// winner "1A", runner-up "2B", or a third-place qualifier "3rd".
function slotLabel(s) {
  return s.t === "W" ? "1" + s.g : s.t === "R" ? "2" + s.g : "3rd";
}

// Assign each qualifying third-place group to its Round-of-32 slot using FIFA's
// official allocation table (Annex C): the eight qualifying groups, sorted, key
// a row that fixes which third fills each winner seat. Returns { [matchNumber]:
// groupLetter }. Falls back to a bipartite matching only if a combination is
// somehow absent from the table (never happens for a valid 8-of-12 set).
function assignThirds(qualGroups) {
  const key = [...qualGroups].sort().join("");
  const row = THIRDS_ALLOCATION[key];
  if (row && row.length === 8) {
    const out = {};
    for (let i = 0; i < 8; i++) out[THIRD_SEAT_MATCH[i]] = row[i];
    return out;
  }
  return assignThirdsFallback(qualGroups);
}

// Fallback: the first valid bipartite matching whose clusters allow it (groups
// tried alphabetically). Retained only for safety if the official table is ever
// missing a combination.
function assignThirdsFallback(qualGroups) {
  const groups = [...qualGroups].sort();
  const used = new Set();
  const out = {};
  const bt = (i) => {
    if (i === THIRD_SLOTS.length) return true;
    const slot = THIRD_SLOTS[i];
    for (const g of groups) {
      if (used.has(g) || !slot.from.has(g)) continue;
      used.add(g);
      out[slot.m] = g;
      if (bt(i + 1)) return true;
      used.delete(g);
      delete out[slot.m];
    }
    return false;
  };
  bt(0);
  return out;
}

// ---------- Build the group model from the live feed ----------
// Returns { ok, groups } where groups[letter] = { teams:[ids], matches:[...] }.
// Each match is { h, a, fixed, gh, ga } — fixed games carry their real score.
function buildGroups(live, resolveTeam) {
  const groups = {};
  const matches = (live && live.matches) || [];
  matches.forEach((mt) => {
    if (mt.stage !== "GROUP_STAGE") return;
    const letter = (mt.group || "").replace(/^GROUP[\s_]*/i, "").trim();
    if (!letter) return;
    const h = resolveTeam(mt.home && mt.home.code, mt.home && mt.home.name);
    const a = resolveTeam(mt.away && mt.away.code, mt.away && mt.away.name);
    if (!h || !a) return;
    if (!groups[letter]) groups[letter] = { teams: new Set(), matches: [] };
    groups[letter].teams.add(h);
    groups[letter].teams.add(a);
    const finished =
      mt.status === "FINISHED" && mt.homeScore != null && mt.awayScore != null;
    const inPlay =
      (mt.status === "IN_PLAY" || mt.status === "PAUSED") &&
      mt.homeScore != null &&
      mt.awayScore != null;
    groups[letter].matches.push({
      h,
      a,
      fixed: finished,
      gh: finished ? mt.homeScore : null,
      ga: finished ? mt.awayScore : null,
      // An in-progress match keeps its live score; the rest is simulated.
      live: inPlay
        ? { gh: mt.homeScore, ga: mt.awayScore, minute: mt.minute }
        : null,
    });
  });
  const letters = Object.keys(groups);
  const ok =
    letters.length === 12 &&
    letters.every((l) => groups[l].teams.size === 4);
  Object.values(groups).forEach((g) => (g.teams = [...g.teams]));
  return { ok, groups };
}

// Real knockout results already in the feed, keyed by unordered team pair, so a
// played knockout match locks to its true winner instead of being simulated.
function buildKoResults(live, resolveTeam, stageToKo) {
  const out = {};
  const matches = (live && live.matches) || [];
  matches.forEach((mt) => {
    if (!stageToKo || !stageToKo[mt.stage]) return;
    if (mt.status !== "FINISHED" || mt._provisional) return;
    const h = resolveTeam(mt.home && mt.home.code, mt.home && mt.home.name);
    const a = resolveTeam(mt.away && mt.away.code, mt.away && mt.away.name);
    if (!h || !a) return;
    let win = null;
    if (mt.winner === "HOME") win = h;
    else if (mt.winner === "AWAY") win = a;
    else if (mt.homeScore != null && mt.awayScore != null) {
      if (mt.homeScore > mt.awayScore) win = h;
      else if (mt.awayScore > mt.homeScore) win = a;
    }
    if (win) out[[h, a].sort().join("|")] = win;
  });
  return out;
}

// Rank a set of teams that are level on overall points, per the 2026 FIFA
// criteria order. New for this tournament: head-to-head results among the tied
// teams are applied FIRST (points, then goal difference, then goals), ahead of
// overall goal difference / goals — the reverse of every World Cup before 2026.
// Rating stands in for the final fair-play / FIFA-ranking steps.
//
// Applied recursively: once head-to-head splits the tied set, each still-level
// subset is re-ranked from the top of the criteria (FIFA re-applies the whole
// sequence to the smaller group). `overall` is each team's full-group line and
// `pool` is every group match's scoreline { h, a, gh, ga }.
function rankTied(ids, overall, pool, elo) {
  if (ids.length <= 1) return ids.slice();
  const set = new Set(ids);
  const h = {};
  ids.forEach((id) => (h[id] = { pts: 0, gf: 0, ga: 0 }));
  pool.forEach((m) => {
    if (!set.has(m.h) || !set.has(m.a)) return;
    const a = h[m.h];
    const b = h[m.a];
    a.gf += m.gh; a.ga += m.ga; b.gf += m.ga; b.ga += m.gh;
    if (m.gh > m.ga) a.pts += 3;
    else if (m.ga > m.gh) b.pts += 3;
    else { a.pts++; b.pts++; }
  });
  // Compare on the head-to-head sub-table only.
  const cmp = (x, y) =>
    h[y].pts - h[x].pts ||
    (h[y].gf - h[y].ga) - (h[x].gf - h[x].ga) ||
    h[y].gf - h[x].gf;
  const sorted = ids.slice().sort(cmp);
  const out = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    const block = sorted.slice(i, j);
    if (block.length === ids.length) {
      // Head-to-head separated no one: fall through to overall GD, overall
      // goals, then rating. No further recursion can help this block.
      block.sort(
        (x, y) =>
          overall[y].gd - overall[x].gd ||
          overall[y].gf - overall[x].gf ||
          adjElo(elo, y) - adjElo(elo, x)
      );
      out.push(...block);
    } else if (block.length === 1) {
      out.push(block[0]);
    } else {
      // A genuine sub-tie: re-apply the whole sequence to just these teams.
      out.push(...rankTied(block, overall, pool, elo));
    }
    i = j;
  }
  return out;
}

function koDecide(elo, idA, idB, koResults) {
  const real = koResults[[idA, idB].sort().join("|")];
  if (real) return real === idA ? idA : idB;
  return Math.random() < koWinProb(elo, idA, idB) ? idA : idB;
}

// ---------- One full simulation ----------
// Mutates the per-team `res` shape ({ gw, gd, finish, ko }) for scoring and
// returns nothing else; callers score and aggregate from `res`.
function simulateOnce(elo, groups, koResults, teamIds, bracketAcc) {
  const res = {};
  teamIds.forEach((id) => (res[id] = { gw: 0, gd: 0, finish: "out", ko: {} }));

  // Optionally tally, per knockout match, which team filled each seat and who
  // advanced — accumulated across sims into per-slot occupancy probabilities.
  const rec = bracketAcc
    ? (m, a, b, w) => {
        const e = bracketAcc[m] || (bracketAcc[m] = { a: {}, b: {}, w: {} });
        e.a[a] = (e.a[a] || 0) + 1;
        e.b[b] = (e.b[b] || 0) + 1;
        e.w[w] = (e.w[w] || 0) + 1;
      }
    : null;

  // --- Group stage ---
  const groupRank = {}; // letter -> [{id, pts, gd, gf}] sorted best-first
  const thirds = []; // { id, group, pts, gd, gf }
  Object.keys(groups).forEach((letter) => {
    const g = groups[letter];
    const stat = {};
    g.teams.forEach((id) => (stat[id] = { pts: 0, gf: 0, ga: 0, w: 0, d: 0 }));
    const played = []; // each match's scoreline, for head-to-head tiebreaks
    g.matches.forEach((mt) => {
      const [gh, ga] = mt.fixed
        ? [mt.gh, mt.ga]
        : mt.live
        ? simScorelineLive(elo, mt.h, mt.a, mt.live)
        : simScoreline(elo, mt.h, mt.a);
      played.push({ h: mt.h, a: mt.a, gh, ga });
      const sh = stat[mt.h];
      const sa = stat[mt.a];
      sh.gf += gh; sh.ga += ga; sa.gf += ga; sa.ga += gh;
      if (gh > ga) { sh.pts += 3; sh.w++; }
      else if (ga > gh) { sa.pts += 3; sa.w++; }
      else { sh.pts++; sa.pts++; sh.d++; sa.d++; }
    });
    // Rank by points, then settle any teams level on points by the 2026 FIFA
    // order — head-to-head among them first, then overall GD/goals, then rating.
    const overall = {};
    g.teams.forEach((id) => {
      overall[id] = {
        pts: stat[id].pts,
        gd: stat[id].gf - stat[id].ga,
        gf: stat[id].gf,
      };
    });
    const byPoints = g.teams
      .slice()
      .sort((x, y) => overall[y].pts - overall[x].pts);
    const order = [];
    for (let i = 0; i < byPoints.length; ) {
      let j = i + 1;
      while (j < byPoints.length && overall[byPoints[j]].pts === overall[byPoints[i]].pts) j++;
      if (j - i === 1) order.push(byPoints[i]);
      else order.push(...rankTied(byPoints.slice(i, j), overall, played, elo));
      i = j;
    }
    const ranked = order.map((id) => ({
      id,
      pts: overall[id].pts,
      gd: overall[id].gd,
      gf: overall[id].gf,
      w: stat[id].w,
      d: stat[id].d,
    }));
    groupRank[letter] = ranked;
    ranked.forEach((r, i) => {
      res[r.id].gw = r.w;
      res[r.id].gd = r.d;
      res[r.id].pos = i + 1; // raw group finishing position 1–4
      if (i === 0) res[r.id].finish = "winner";
      else if (i === 1) res[r.id].finish = "runnerup";
      else res[r.id].finish = "out"; // thirds upgraded below if they qualify
    });
    const third = ranked[2];
    if (third) thirds.push({ id: third.id, group: letter, pts: third.pts, gd: third.gd, gf: third.gf });
  });

  // Best 8 of the 12 third-place teams advance (points, GD, GF, then Elo).
  const advThirds = thirds
    .sort(
      (a, b) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf ||
        adjElo(elo, b.id) - adjElo(elo, a.id)
    )
    .slice(0, 8);
  advThirds.forEach((t) => (res[t.id].finish = "third"));
  const thirdAssign = assignThirds(advThirds.map((t) => t.group));

  // --- Knockout rounds ---
  const slotTeam = (slot) => {
    const r = groupRank[slot.g];
    if (slot.t === "W") return r[0].id;
    if (slot.t === "R") return r[1].id;
    return null;
  };
  const winners = {}; // match number -> winning id
  const koPoint = { r32: "r32", r16: "r16", qf: "qf", sf: "sf" };

  R32.forEach((mt) => {
    const a = mt.a.t === "3" ? null : slotTeam(mt.a);
    const b = mt.b.t === "3" ? null : slotTeam(mt.b);
    // Resolve whichever side is the third-place slot.
    const teamA = mt.a.t === "3" ? groupRank[thirdAssign[mt.m]][2].id : a;
    const teamB = mt.b.t === "3" ? groupRank[thirdAssign[mt.m]][2].id : b;
    const w = koDecide(elo, teamA, teamB, koResults);
    winners[mt.m] = w;
    res[w].ko.r32 = true;
    if (rec) rec(mt.m, teamA, teamB, w);
  });

  ["r16", "qf", "sf"].forEach((round) => {
    LATER_ROUNDS[round].forEach((mt) => {
      const teamA = winners[mt.a];
      const teamB = winners[mt.b];
      const w = koDecide(elo, teamA, teamB, koResults);
      winners[mt.m] = w;
      res[w].ko[koPoint[round]] = true;
      if (rec) rec(mt.m, teamA, teamB, w);
    });
  });

  // Semifinal losers contest the third-place match (match 103); semifinal
  // winners contest the final (match 104).
  const sf1 = LATER_ROUNDS.sf[0];
  const sf2 = LATER_ROUNDS.sf[1];
  const sfPairs = [sf1, sf2].map((mt) => {
    const teamA = winners[mt.a];
    const teamB = winners[mt.b];
    const w = winners[mt.m];
    return { loser: w === teamA ? teamB : teamA };
  });
  const tpWin = koDecide(elo, sfPairs[0].loser, sfPairs[1].loser, koResults);
  res[tpWin].ko.tp = true;
  if (rec) rec(103, sfPairs[0].loser, sfPairs[1].loser, tpWin);

  const champ = koDecide(elo, winners[101], winners[102], koResults);
  res[champ].ko.f = true;
  if (rec) rec(104, winners[101], winners[102], champ);

  return res;
}

// ---------- Public entry point ----------
// opts: { live, resolveTeam, scorePoints, stageToKo, entries, sims }
//   entries: [{ name, ids:[teamId,...] }] (optional) for pool-level projection.
// Returns { ok, sims, teams:{id->{...probabilities, projPts}}, entries:[...] }.
export function projectTournament(opts) {
  const {
    live,
    resolveTeam,
    scorePoints,
    stageToKo,
    entries = [],
    sims = DEFAULT_SIMS,
  } = opts;

  const { ok, groups } = buildGroups(live, resolveTeam);
  if (!ok) return { ok: false, reason: "Need all 12 groups of 4 from the feed." };

  const teamIds = Object.keys(TEAM_ELO);
  const koResults = buildKoResults(live, resolveTeam, stageToKo);
  // Current ratings: the snapshot updated by every match already played.
  const elo = liveElo(live, resolveTeam, stageToKo);

  // Per-match predictions for upcoming (not-yet-started) games with known teams.
  const predictions = ((live && live.matches) || [])
    .filter((m) => m.status === "SCHEDULED" || m.status === "TIMED")
    .map((m) => {
      const h = resolveTeam(m.home && m.home.code, m.home && m.home.name);
      const a = resolveTeam(m.away && m.away.code, m.away && m.away.name);
      if (!h || !a) return null;
      const isGroup = m.stage === "GROUP_STAGE";
      return {
        id: m.id,
        utcDate: m.utcDate,
        stage: m.stage,
        group: m.group || null,
        home: h,
        away: a,
        homeName: (m.home && m.home.name) || h,
        awayName: (m.away && m.away.name) || a,
        isGroup,
        ...predictMatch(elo, h, a, isGroup),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  // In-progress matches with their current win/draw/win probabilities.
  const liveGames = ((live && live.matches) || [])
    .filter(
      (m) =>
        (m.status === "IN_PLAY" || m.status === "PAUSED") &&
        m.homeScore != null &&
        m.awayScore != null
    )
    .map((m) => {
      const h = resolveTeam(m.home && m.home.code, m.home && m.home.name);
      const a = resolveTeam(m.away && m.away.code, m.away && m.away.name);
      if (!h || !a) return null;
      return {
        id: m.id,
        utcDate: m.utcDate,
        stage: m.stage,
        group: m.group || null,
        status: m.status,
        minute: m.minute,
        home: h,
        away: a,
        homeName: (m.home && m.home.name) || h,
        awayName: (m.away && m.away.name) || a,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        isGroup: m.stage === "GROUP_STAGE",
        ...predictLive(elo, h, a, {
          gh: m.homeScore,
          ga: m.awayScore,
          minute: m.minute,
        }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  // Per-team accumulators.
  const acc = {};
  teamIds.forEach(
    (id) =>
      (acc[id] = {
        groupWinner: 0, runnerUp: 0, pos3: 0, pos4: 0, advance: 0,
        r16: 0, qf: 0, sf: 0, final: 0, champ: 0, ptsSum: 0, glPtsSum: 0,
      })
  );
  // Per-entry accumulators.
  const eAcc = entries.map(() => ({ totalSum: 0, wins: 0 }));
  // Per-knockout-slot occupancy, filled by simulateOnce each run.
  const bracketAcc = {};

  for (let s = 0; s < sims; s++) {
    const res = simulateOnce(elo, groups, koResults, teamIds, bracketAcc);
    const ptsByTeam = {};
    teamIds.forEach((id) => {
      const r = res[id];
      const pts = scorePoints(r);
      ptsByTeam[id] = pts;
      const a = acc[id];
      a.ptsSum += pts;
      if (r.finish === "winner") a.groupWinner++; // pos 1
      if (r.finish === "runnerup") a.runnerUp++; // pos 2
      if (r.pos === 3) a.pos3++;
      else if (r.pos === 4) a.pos4++;
      if (r.finish === "winner" || r.finish === "runnerup" || r.finish === "third")
        a.advance++;
      a.glPtsSum += 3 * (r.gw || 0) + (r.gd || 0); // group league points (0–9)
      if (r.ko.r32) a.r16++; // won R32 => reached R16
      if (r.ko.r16) a.qf++;
      if (r.ko.qf) a.sf++;
      if (r.ko.sf) a.final++; // won SF => reached final
      if (r.ko.f) a.champ++;
    });

    if (entries.length) {
      let best = -Infinity;
      const totals = entries.map((e) =>
        e.ids.reduce((sum, id) => sum + (ptsByTeam[id] || 0), 0)
      );
      totals.forEach((t, i) => {
        eAcc[i].totalSum += t;
        if (t > best) best = t;
      });
      const leaders = [];
      totals.forEach((t, i) => {
        if (t === best) leaders.push(i);
      });
      leaders.forEach((i) => (eAcc[i].wins += 1 / leaders.length));
    }
  }

  const teams = {};
  teamIds.forEach((id) => {
    const a = acc[id];
    teams[id] = {
      groupWinner: a.groupWinner / sims,
      runnerUp: a.runnerUp / sims,
      // Full finishing-position distribution within the group: [P1,P2,P3,P4].
      place: [a.groupWinner / sims, a.runnerUp / sims, a.pos3 / sims, a.pos4 / sims],
      advance: a.advance / sims,
      r16: a.r16 / sims,
      qf: a.qf / sims,
      sf: a.sf / sims,
      final: a.final / sims,
      champ: a.champ / sims,
      projPts: a.ptsSum / sims,
      projGroupPts: a.glPtsSum / sims, // expected final group league points
      elo: Math.round(elo[id]), // current rating, after played-match updates
      eloBase: TEAM_ELO[id], // pre-tournament snapshot, for the delta
    };
  });

  // Projected final group tables: each group's teams ranked by expected league
  // points (then advance odds), so the order reads like a finished standings.
  const groupTables = Object.keys(groups)
    .sort()
    .map((letter) => ({
      group: letter,
      table: groups[letter].teams
        .map((id) => ({ id, ...teams[id] }))
        .sort(
          (a, b) =>
            b.projGroupPts - a.projGroupPts ||
            b.advance - a.advance ||
            b.groupWinner - a.groupWinner
        ),
    }));

  const entryOut = entries.map((e, i) => ({
    name: e.name,
    projTotal: eAcc[i].totalSum / sims,
    winProb: eAcc[i].wins / sims,
  }));

  // The projected bracket: for each knockout match, the full distribution of
  // teams that could fill each seat (sorted most- to least-likely, with each
  // team's probability of reaching that seat) plus the most-likely advancer.
  // `id`/`p` are the top team; `all` is every candidate with a non-zero chance.
  // Drawn left-to-right, R32 → Final.
  const seatDist = (counter) => {
    const all = [];
    for (const k in counter) {
      if (counter[k] > 0) all.push({ id: k, p: counter[k] / sims });
    }
    all.sort((x, y) => y.p - x.p);
    return {
      id: all.length ? all[0].id : null,
      p: all.length ? all[0].p : 0,
      alt: all.length > 1 ? { id: all[1].id, p: all[1].p } : null,
      all,
    };
  };
  const mkMatch = (m, extra) => {
    const e = bracketAcc[m] || { a: {}, b: {}, w: {} };
    return {
      m,
      seatA: seatDist(e.a),
      seatB: seatDist(e.b),
      winner: seatDist(e.w),
      ...extra,
    };
  };
  const bracket = {
    r32: BRACKET_ORDER.r32.map((m) => {
      const def = R32.find((x) => x.m === m);
      return mkMatch(m, { slotA: slotLabel(def.a), slotB: slotLabel(def.b) });
    }),
    r16: BRACKET_ORDER.r16.map((m) => mkMatch(m)),
    qf: BRACKET_ORDER.qf.map((m) => mkMatch(m)),
    sf: BRACKET_ORDER.sf.map((m) => mkMatch(m)),
    final: mkMatch(104),
    third: mkMatch(103),
  };

  return {
    ok: true,
    sims,
    teams,
    entries: entryOut,
    groups: groupTables,
    predictions,
    liveGames,
    bracket,
  };
}
