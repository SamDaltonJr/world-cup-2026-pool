import { useState, useEffect, useMemo } from "react";
import { storage } from "./storage.js";
import { isConfigured } from "./supabaseClient.js";

// ============================================================
// WORLD CUP 2026 TIER POOL
// Commissioner passcode: set VITE_ADMIN_CODE (falls back to the default below)
// Entries hard-lock at the opening kickoff (June 11, 2026, 19:00 UTC)
// ============================================================

const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE || "commish2026";
const DEADLINE_UTC = "2026-06-11T19:00:00Z"; // Opening kickoff: 1pm Mexico City / 3pm ET

const SCORING = {
  groupWin: 3,
  groupDraw: 1,
  groupWinner: 3,
  runnerUp: 2,
  thirdQual: 1,
  r32: 4,
  r16: 5,
  qf: 6,
  sf: 8,
  thirdPlace: 3,
  final: 12,
};

const GOLDEN_BOOT_PTS = 8;
const BOOT_SUGGESTIONS = [
  "Kylian Mbappé (France)",
  "Harry Kane (England)",
  "Erling Haaland (Norway)",
  "Lamine Yamal (Spain)",
  "Lionel Messi (Argentina)",
  "Cristiano Ronaldo (Portugal)",
  "Vinícius Júnior (Brazil)",
  "Julián Álvarez (Argentina)",
  "Ousmane Dembélé (France)",
  "Viktor Gyökeres (Sweden)",
  "Alexander Isak (Sweden)",
  "Raphinha (Brazil)",
  "Jude Bellingham (England)",
  "Memphis Depay (Netherlands)",
  "Christian Pulisic (USA)",
];

function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bootMatch(pick, winner) {
  const a = normName(pick);
  const b = normName(winner);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const TIERS = [
  {
    n: 1,
    pickCount: 1,
    teams: [
      { id: "ESP", name: "Spain", odds: "+450" },
      { id: "FRA", name: "France", odds: "+500" },
    ],
  },
  {
    n: 2,
    pickCount: 1,
    teams: [
      { id: "ENG", name: "England", odds: "+700" },
      { id: "POR", name: "Portugal", odds: "+800" },
      { id: "BRA", name: "Brazil", odds: "+850" },
      { id: "ARG", name: "Argentina", odds: "+1000" },
    ],
  },
  {
    n: 3,
    pickCount: 1,
    teams: [
      { id: "GER", name: "Germany", odds: "+1300" },
      { id: "NED", name: "Netherlands", odds: "+1700" },
      { id: "BEL", name: "Belgium", odds: "+2200" },
    ],
  },
  {
    n: 4,
    pickCount: 2,
    teams: [
      { id: "NOR", name: "Norway", odds: "+3000" },
      { id: "COL", name: "Colombia", odds: "+4000" },
      { id: "MAR", name: "Morocco", odds: "+5000" },
      { id: "JPN", name: "Japan", odds: "+5000" },
      { id: "USA", name: "USA", odds: "+5500" },
      { id: "MEX", name: "Mexico", odds: "+6000" },
      { id: "URU", name: "Uruguay", odds: "+6000" },
    ],
  },
  {
    n: 5,
    pickCount: 2,
    teams: [
      { id: "CRO", name: "Croatia", odds: "+7000" },
      { id: "SUI", name: "Switzerland", odds: "+7000" },
      { id: "TUR", name: "Türkiye", odds: "+7500" },
      { id: "ECU", name: "Ecuador", odds: "+8000" },
      { id: "AUT", name: "Austria", odds: "+10000" },
      { id: "CIV", name: "Ivory Coast", odds: "+15000" },
    ],
  },
  {
    n: 6,
    pickCount: 1,
    teams: [
      { id: "SEN", name: "Senegal", odds: "+12500" },
      { id: "SWE", name: "Sweden", odds: "+15000" },
      { id: "PAR", name: "Paraguay", odds: "+20000" },
      { id: "SCO", name: "Scotland", odds: "+22500" },
      { id: "ALG", name: "Algeria", odds: "+25000" },
    ],
  },
  {
    n: 7,
    pickCount: 2,
    teams: [
      { id: "CAN", name: "Canada", odds: "+20000" },
      { id: "EGY", name: "Egypt", odds: "+30000" },
      { id: "GHA", name: "Ghana", odds: "+40000" },
      { id: "BIH", name: "Bosnia & Herz.", odds: "+40000" },
      { id: "KOR", name: "South Korea", odds: "+40000" },
      { id: "CZE", name: "Czechia", odds: "+70000" },
    ],
  },
  {
    n: 8,
    pickCount: 2,
    teams: [
      { id: "IRN", name: "Iran", odds: "+100000" },
      { id: "TUN", name: "Tunisia", odds: "+150000" },
      { id: "AUS", name: "Australia", odds: "+200000" },
      { id: "COD", name: "DR Congo", odds: "+200000" },
      { id: "CPV", name: "Cape Verde", odds: "+250000" },
      { id: "UZB", name: "Uzbekistan", odds: "+250000" },
      { id: "HAI", name: "Haiti", odds: "+250000" },
      { id: "PAN", name: "Panama", odds: "+250000" },
      { id: "CUW", name: "Curaçao", odds: "+250000" },
      { id: "KSA", name: "Saudi Arabia", odds: "+250000" },
      { id: "QAT", name: "Qatar", odds: "+250000" },
      { id: "NZL", name: "New Zealand", odds: "+250000" },
      { id: "IRQ", name: "Iraq", odds: "+250000" },
      { id: "JOR", name: "Jordan", odds: "+250000" },
      { id: "RSA", name: "South Africa", odds: "+250000" },
    ],
  },
];

const ALL_TEAMS = {};
TIERS.forEach((t) =>
  t.teams.forEach((tm) => {
    ALL_TEAMS[tm.id] = { ...tm, tier: t.n };
  })
);

const FINISH_OPTIONS = [
  { value: "", label: "Group in progress" },
  { value: "winner", label: "Won group (+3)" },
  { value: "runnerup", label: "Runner-up (+2)" },
  { value: "third", label: "3rd-place qualifier (+1)" },
  { value: "out", label: "Eliminated" },
];

const KO_STAGES = [
  { key: "r32", label: "Won Rd of 32", pts: SCORING.r32 },
  { key: "r16", label: "Won Rd of 16", pts: SCORING.r16 },
  { key: "qf", label: "Won Quarterfinal", pts: SCORING.qf },
  { key: "sf", label: "Won Semifinal", pts: SCORING.sf },
  { key: "tp", label: "Won 3rd-Place Match", pts: SCORING.thirdPlace },
  { key: "f", label: "Won the Final", pts: SCORING.final },
];

const blankResult = () => ({ gw: 0, gd: 0, finish: "", ko: {} });

function teamPoints(r) {
  if (!r) return 0;
  let pts = (r.gw || 0) * SCORING.groupWin + (r.gd || 0) * SCORING.groupDraw;
  if (r.finish === "winner") pts += SCORING.groupWinner;
  if (r.finish === "runnerup") pts += SCORING.runnerUp;
  if (r.finish === "third") pts += SCORING.thirdQual;
  KO_STAGES.forEach((s) => {
    if (r.ko && r.ko[s.key]) pts += s.pts;
  });
  return pts;
}

// How many games a team has actually played and the most pool points those
// played games could have yielded — the team's "ceiling so far". Derived from
// the live feed (group standings + finished knockout matches) so it always
// reflects real play. Group game ceiling is a win (3); a completed group also
// puts the +3 group-winner bonus on the table; each knockout game ceiling is
// that round's win value. Returns { played, max }. Points actually earned come
// from the commissioner-confirmed results (teamPoints), so earned never exceeds
// this max in normal operation (the feed leads the commissioner's edits).
function teamCeiling(id, live) {
  let played = 0;
  let max = 0;
  if (!live || !id) return { played, max };
  (live.standings || []).forEach((g) => {
    (g.table || []).forEach((row) => {
      if (liveTeamToId(row.code, row.name) !== id) return;
      const gp = Math.min(3, row.played || 0);
      played += gp;
      max += gp * SCORING.groupWin;
      // Group finished: winning it was achievable, so add the winner bonus.
      if ((row.played || 0) >= 3) max += SCORING.groupWinner;
    });
  });
  (live.matches || []).forEach((mt) => {
    const ko = STAGE_TO_KO[mt.stage];
    if (!ko || mt.status !== "FINISHED" || mt._provisional) return;
    const hId = liveTeamToId(mt.home && mt.home.code, mt.home && mt.home.name);
    const aId = liveTeamToId(mt.away && mt.away.code, mt.away && mt.away.name);
    if (hId !== id && aId !== id) return;
    played += 1;
    const stage = KO_STAGES.find((s) => s.key === ko);
    if (stage) max += stage.pts;
  });
  return { played, max };
}

// ---------- Live feed: provider -> pool mapping & scoring derivation ----------
// The `live` payload is written to Supabase by scripts/sync-results.mjs and has
// the shape: { updatedAt, source, matches:[...], standings:[...] }.

function normTeamName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Safety net for the few teams whose feed name doesn't obviously match our
// label. The three-letter code is tried first and usually matches the FIFA
// tla, so this only catches the stragglers.
const NAME_ALIASES = {
  "korea republic": "KOR",
  "south korea": "KOR",
  "ivory coast": "CIV",
  "cote divoire": "CIV",
  turkiye: "TUR",
  turkey: "TUR",
  "united states": "USA",
  usa: "USA",
  "dr congo": "COD",
  "congo dr": "COD",
  "democratic republic of congo": "COD",
  "cape verde": "CPV",
  "cabo verde": "CPV",
  czechia: "CZE",
  "czech republic": "CZE",
  "bosnia and herzegovina": "BIH",
  "bosnia herzegovina": "BIH",
  "saudi arabia": "KSA",
  "south africa": "RSA",
  "new zealand": "NZL",
};

const POOL_NAME_TO_ID = {};
Object.values(ALL_TEAMS).forEach((t) => {
  POOL_NAME_TO_ID[normTeamName(t.name)] = t.id;
});

// Feed three-letter codes that differ from our pool ids. football-data uses
// URY for Uruguay where we use URU; the name fallback also catches it, this is
// just belt-and-suspenders.
const CODE_ALIASES = { URY: "URU" };

// Resolve a feed team (code + name) to a pool team id, or null if it isn't one
// of our 48 (the Results tab still shows it, it just isn't highlighted).
function liveTeamToId(code, name) {
  if (code) {
    const c = code.toUpperCase();
    if (ALL_TEAMS[c]) return c;
    if (CODE_ALIASES[c]) return CODE_ALIASES[c];
  }
  const n = normTeamName(name);
  if (n) {
    if (POOL_NAME_TO_ID[n]) return POOL_NAME_TO_ID[n];
    if (NAME_ALIASES[n]) return NAME_ALIASES[n];
  }
  return null;
}

const STAGE_TO_KO = {
  LAST_32: "r32",
  ROUND_OF_32: "r32",
  LAST_16: "r16",
  ROUND_OF_16: "r16",
  QUARTER_FINALS: "qf",
  QUARTER_FINAL: "qf",
  SEMI_FINALS: "sf",
  SEMI_FINAL: "sf",
  THIRD_PLACE: "tp",
  PLAY_OFF_FOR_THIRD_PLACE: "tp",
  FINAL: "f",
};

const STAGE_LABELS = {
  GROUP_STAGE: "Group stage",
  LAST_32: "Round of 32",
  ROUND_OF_32: "Round of 32",
  LAST_16: "Round of 16",
  ROUND_OF_16: "Round of 16",
  QUARTER_FINALS: "Quarterfinals",
  SEMI_FINALS: "Semifinals",
  THIRD_PLACE: "Third-place match",
  PLAY_OFF_FOR_THIRD_PLACE: "Third-place match",
  FINAL: "Final",
};

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Turn the live feed into the per-team results shape the pool scores on. Group
// W/D and finish come from the standings (including the 2026 "8 best third-place
// teams advance" rule); knockout wins come from finished knockout matches.
// Nothing is auto-committed — the commissioner reviews this in the form and
// hits Save. `prev` seeds the output so manual edits aren't clobbered for teams
// the feed has nothing to say about yet.
function deriveResults(live, prev) {
  const out = {};
  Object.keys(ALL_TEAMS).forEach((id) => {
    out[id] =
      prev && prev[id] ? JSON.parse(JSON.stringify(prev[id])) : blankResult();
  });
  if (!live) return out;

  // --- Group stage from standings ---
  const meta = {}; // id -> { pos, played }
  const thirds = [];
  (live.standings || []).forEach((g) => {
    (g.table || []).forEach((row) => {
      const id = liveTeamToId(row.code, row.name);
      if (!id || !out[id]) return;
      out[id].gw = Math.min(3, row.won || 0);
      out[id].gd = Math.min(3, row.draw || 0);
      meta[id] = { pos: row.position, played: row.played || 0 };
      if (row.position === 3)
        thirds.push({
          id,
          points: row.points || 0,
          gd: row.gd || 0,
          gf: row.gf || 0,
          played: row.played || 0,
        });
    });
  });

  // Best 8 of the 12 third-place teams advance. Only rank teams that have
  // finished all three group games so a mid-round table can't crown a third.
  const advancingThirds = new Set(
    thirds
      .filter((t) => t.played >= 3)
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf)
      .slice(0, 8)
      .map((t) => t.id)
  );

  Object.keys(out).forEach((id) => {
    const m = meta[id];
    if (!m) return; // not in any group table yet; leave as-is
    if (m.played < 3) out[id].finish = ""; // group still in progress
    else if (m.pos === 1) out[id].finish = "winner";
    else if (m.pos === 2) out[id].finish = "runnerup";
    else if (m.pos === 3)
      out[id].finish = advancingThirds.has(id) ? "third" : "out";
    else out[id].finish = "out";
  });

  // --- Knockout wins from finished matches ---
  (live.matches || []).forEach((mt) => {
    const ko = STAGE_TO_KO[mt.stage];
    // Only count official finals — skip provisional (carried-forward) live
    // scores so a knockout win isn't credited off an unconfirmed result.
    if (!ko || mt.status !== "FINISHED" || mt._provisional) return;
    let side = mt.winner; // HOME | AWAY | DRAW | null
    if (side !== "HOME" && side !== "AWAY") {
      if (mt.homeScore != null && mt.awayScore != null) {
        if (mt.homeScore > mt.awayScore) side = "HOME";
        else if (mt.awayScore > mt.homeScore) side = "AWAY";
      }
    }
    if (side !== "HOME" && side !== "AWAY") return;
    const t = side === "HOME" ? mt.home : mt.away;
    const id = liveTeamToId(t && t.code, t && t.name);
    if (id && out[id]) out[id].ko = { ...out[id].ko, [ko]: true };
  });

  return out;
}

function entryTeamIds(entry) {
  // Picks are stored per tier. New entries use arrays for every tier; older
  // entries may have a bare string for single-pick tiers — handle both.
  const ids = [];
  TIERS.forEach((t) => {
    const v = entry.picks ? entry.picks[t.n] : null;
    if (Array.isArray(v)) v.forEach((id) => id && ids.push(id));
    else if (v) ids.push(v);
  });
  return ids;
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function useCountdown(deadline) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = deadline.getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { h, m, s };
}

// ---------- Shared UI bits ----------

function Eyebrow({ children }) {
  return (
    <div className="text-xs font-bold uppercase tracking-widest text-emerald-700">
      {children}
    </div>
  );
}

// Pool team id (FIFA three-letter code) -> ISO 3166-1 alpha-2 for flag images.
// England and Scotland use flagcdn's UK-subdivision codes so they get their own
// flags rather than the Union Jack.
const FIFA_TO_ISO = {
  ESP: "es", FRA: "fr", ENG: "gb-eng", POR: "pt", BRA: "br", ARG: "ar",
  GER: "de", NED: "nl", BEL: "be", NOR: "no", COL: "co", MAR: "ma",
  JPN: "jp", USA: "us", MEX: "mx", URU: "uy", CRO: "hr", SUI: "ch",
  TUR: "tr", ECU: "ec", AUT: "at", CIV: "ci", SEN: "sn", SWE: "se",
  PAR: "py", SCO: "gb-sct", ALG: "dz", CAN: "ca", EGY: "eg", GHA: "gh",
  BIH: "ba", KOR: "kr", CZE: "cz", IRN: "ir", TUN: "tn", AUS: "au",
  COD: "cd", CPV: "cv", UZB: "uz", HAI: "ht", PAN: "pa", CUW: "cw",
  KSA: "sa", QAT: "qa", NZL: "nz", IRQ: "iq", JOR: "jo", RSA: "za",
};

// A small country flag for a pool team id. Renders nothing for ids we don't
// have a flag for, so it degrades cleanly. Flags are 4:3 (e.g. 20x15).
function Flag({ id, className = "" }) {
  const iso = FIFA_TO_ISO[id];
  if (!iso) return null;
  return (
    <img
      src={`https://flagcdn.com/w40/${iso}.png`}
      srcSet={`https://flagcdn.com/w80/${iso}.png 2x`}
      width={20}
      height={15}
      alt=""
      loading="lazy"
      className={"inline-block rounded-[2px] object-cover shrink-0 " + className}
    />
  );
}

function TeamChip({ team, selected, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "flex items-center w-full px-3 py-2 rounded-lg border text-left transition-colors " +
        (selected
          ? "bg-emerald-800 border-emerald-800 text-white"
          : disabled
          ? "bg-stone-100 border-stone-200 text-stone-400"
          : "bg-white border-stone-300 text-stone-800 hover:border-emerald-600")
      }
    >
      <Flag id={team.id} className="mr-2" />
      <span className="font-semibold text-sm">{team.name}</span>
    </button>
  );
}

// ---------- Picks view ----------

function PicksView({ locked, onViewBoard }) {
  const [name, setName] = useState("");
  const [picks, setPicks] = useState({});
  const [tiebreaker, setTiebreaker] = useState("");
  const [goldenBoot, setGoldenBoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState("");

  const totalPicks = useMemo(
    () => TIERS.reduce((s, t) => s + t.pickCount, 0),
    []
  );

  const pickTeam = (tierN, teamId) => {
    setError("");
    const tier = TIERS.find((t) => t.n === tierN);
    const cap = tier.pickCount;
    setPicks((p) => {
      const cur = p[tierN] || [];
      if (cur.includes(teamId))
        return { ...p, [tierN]: cur.filter((id) => id !== teamId) };
      // At capacity: drop the earliest pick and add the new one.
      if (cur.length >= cap) return { ...p, [tierN]: [...cur.slice(1), teamId] };
      return { ...p, [tierN]: [...cur, teamId] };
    });
  };

  // One display slot per required pick, in tier order, padded with nulls.
  const slots = useMemo(() => {
    const out = [];
    TIERS.forEach((t) => {
      const cur = picks[t.n] || [];
      for (let i = 0; i < t.pickCount; i++)
        out.push({ id: cur[i] || null, tierN: t.n });
    });
    return out;
  }, [picks]);

  const filledCount = slots.filter((s) => s.id).length;
  const allPicked = TIERS.every(
    (t) => (picks[t.n] || []).length === t.pickCount
  );

  const complete =
    allPicked &&
    name.trim().length > 0 &&
    tiebreaker !== "" &&
    goldenBoot.trim().length > 0;

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Add your name first.");
    for (const t of TIERS) {
      if ((picks[t.n] || []).length !== t.pickCount)
        return setError(
          `Pick ${t.pickCount} team${t.pickCount > 1 ? "s" : ""} from Tier ${
            t.n
          }.`
        );
    }
    const tb = parseInt(tiebreaker, 10);
    if (isNaN(tb) || tb < 0)
      return setError("Tiebreaker must be a number (total goals in the final).");
    if (!goldenBoot.trim()) return setError("Add your Golden Boot pick.");
    const slug = slugify(name);
    if (!slug) return setError("Name needs at least one letter or number.");
    setSaving(true);
    try {
      const cleanPicks = {};
      TIERS.forEach((t) => {
        cleanPicks[t.n] = [...(picks[t.n] || [])];
      });
      const entry = {
        name: name.trim(),
        picks: cleanPicks,
        tiebreaker: tb,
        goldenBoot: goldenBoot.trim(),
        ts: Date.now(),
      };
      await storage.set("entry:" + slug, JSON.stringify(entry), true);
      setSubmitted(entry);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError("Could not save your entry. Try again in a moment.");
    }
    setSaving(false);
  };

  if (locked) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-6 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <div className="font-bold text-stone-800 text-lg">Entries are locked</div>
        <p className="text-stone-600 text-sm mt-1">
          The opening match has kicked off. Head to the leaderboard to follow the
          standings.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="pb-10">
        <div className="bg-white border-2 border-emerald-300 rounded-xl p-6 text-center mb-4">
          <div className="text-4xl mb-2">✅</div>
          <div className="font-extrabold text-emerald-900 text-xl">
            You&apos;re in, {submitted.name}!
          </div>
          <p className="text-stone-600 text-sm mt-2">
            All {totalPicks} picks are saved. You can resubmit under the same
            name to change them anytime before the opening kickoff — after that
            they&apos;re locked.
          </p>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
          <Eyebrow>Your lineup · {totalPicks} teams</Eyebrow>
          <div className="mt-2">
            {TIERS.map((t) => {
              const ids = submitted.picks[t.n] || [];
              return (
                <div
                  key={t.n}
                  className="flex items-start justify-between gap-3 py-2 border-b border-stone-100 last:border-0"
                >
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wide whitespace-nowrap pt-0.5">
                    Tier {t.n}
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 justify-end text-sm font-semibold text-stone-800">
                    {ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Flag id={id} />
                        {ALL_TEAMS[id] ? ALL_TEAMS[id].name : id}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
          <div className="flex justify-between py-1">
            <span className="text-sm text-stone-600">Golden Boot</span>
            <span className="text-sm font-semibold text-stone-800">
              {submitted.goldenBoot}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-sm text-stone-600">
              Final tiebreaker (goals)
            </span>
            <span className="text-sm font-semibold text-stone-800">
              {submitted.tiebreaker}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setSubmitted(null)}
            className="flex-1 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-700 font-bold text-sm hover:border-emerald-600"
          >
            Edit my picks
          </button>
          {onViewBoard && (
            <button
              onClick={onViewBoard}
              className="flex-1 py-2.5 rounded-lg bg-emerald-800 text-white font-bold text-sm hover:bg-emerald-700"
            >
              View leaderboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-36">
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <label className="block text-sm font-semibold text-stone-700 mb-1">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Curtis B"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-emerald-600"
        />
        <p className="text-xs text-stone-500 mt-2">
          Your name shows on the entry list, but your picks stay hidden from
          everyone until the opening kickoff. Resubmitting under the same name
          replaces your earlier picks.
        </p>
      </div>

      {TIERS.map((tier) => {
        const cur = picks[tier.n] || [];
        return (
          <div
            key={tier.n}
            className="bg-white border border-stone-200 rounded-xl p-4 mb-4"
          >
            <div className="flex items-baseline justify-between mb-3">
              <Eyebrow>
                Tier {tier.n} · pick {tier.pickCount}
              </Eyebrow>
              <span className="text-xs text-stone-500">
                {cur.length}/{tier.pickCount} · {tier.teams.length} teams
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tier.teams.map((tm) => (
                <TeamChip
                  key={tm.id}
                  team={tm}
                  selected={cur.includes(tm.id)}
                  onClick={() => pickTeam(tier.n, tm.id)}
                />
              ))}
            </div>
            {tier.pickCount > 1 && (
              <p className="text-xs text-stone-500 mt-2">
                Pick {tier.pickCount}. Selecting another team swaps out your
                earliest pick in this tier.
              </p>
            )}
          </div>
        );
      })}

      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <label className="block text-sm font-semibold text-stone-700 mb-1">
          Golden Boot pick: tournament top scorer
        </label>
        <input
          list="boot-suggestions"
          value={goldenBoot}
          onChange={(e) => setGoldenBoot(e.target.value)}
          placeholder="Start typing a player's name"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-emerald-600"
        />
        <datalist id="boot-suggestions">
          {BOOT_SUGGESTIONS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <p className="text-xs text-stone-500 mt-2">
          Worth {GOLDEN_BOOT_PTS} bonus points if you nail it. Any player is
          fair game, the list is just suggestions.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <label className="block text-sm font-semibold text-stone-700 mb-1">
          Tiebreaker: total goals scored in the Final
        </label>
        <input
          type="number"
          min="0"
          value={tiebreaker}
          onChange={(e) => setTiebreaker(e.target.value)}
          placeholder="e.g. 3"
          className="w-32 border border-stone-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-emerald-600"
        />
        <p className="text-xs text-stone-500 mt-2">
          Closest without going over wins ties. Includes extra time, not
          shootout kicks.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Lineup card */}
      <div className="fixed bottom-0 left-0 right-0 bg-emerald-950 border-t-4 border-amber-400 px-4 py-3 z-10">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-amber-300 text-xs font-bold uppercase tracking-widest">
              Lineup card
            </span>
            <span className="text-emerald-200 text-xs font-mono">
              {filledCount}/{totalPicks} picked
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {slots.map((s, i) => (
              <span
                key={i}
                className={
                  "px-2 py-1 rounded text-xs font-mono " +
                  (s.id
                    ? "bg-emerald-700 text-white"
                    : "bg-emerald-900 text-emerald-500 border border-emerald-800")
                }
              >
                {s.id || `T${s.tierN}`}
              </span>
            ))}
          </div>
          <button
            onClick={submit}
            disabled={!complete || saving}
            className={
              "w-full py-2 rounded-lg font-bold text-sm " +
              (complete && !saving
                ? "bg-amber-400 text-emerald-950 hover:bg-amber-300"
                : "bg-emerald-900 text-emerald-600")
            }
          >
            {saving
              ? "Saving…"
              : complete
              ? "Submit picks"
              : "Complete picks, name, tiebreaker, and Golden Boot"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Leaderboard ----------

function LeaderboardView({ results, settings, locked, live }) {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [sortBy, setSortBy] = useState("total"); // "total" | "pct"

  const loadEntries = async () => {
    setLoadError("");
    try {
      const listed = await storage.list("entry:", true);
      const keys = (listed && listed.keys) || [];
      const loaded = [];
      await Promise.all(
        keys.map(async (k) => {
          try {
            const res = await storage.get(k, true);
            if (res && res.value) loaded.push(JSON.parse(res.value));
          } catch (e) {
            // skip unreadable entry
          }
        })
      );
      setEntries(loaded);
    } catch (e) {
      setEntries([]);
      setLoadError("Could not load entries yet. Pull to refresh or try again.");
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const ranked = useMemo(() => {
    if (!entries) return [];
    return entries
      .map((e) => {
        const ids = entryTeamIds(e);
        const teamTotal = ids.reduce(
          (sum, id) => sum + teamPoints(results[id]),
          0
        );
        // Games played and ceiling across this entry's teams (from the feed).
        const ceiling = ids.reduce(
          (acc, id) => {
            const c = teamCeiling(id, live);
            acc.played += c.played;
            acc.max += c.max;
            return acc;
          },
          { played: 0, max: 0 }
        );
        const bootBonus =
          settings.goldenBootWinner &&
          bootMatch(e.goldenBoot, settings.goldenBootWinner)
            ? GOLDEN_BOOT_PTS
            : 0;
        return {
          ...e,
          total: teamTotal + bootBonus,
          teamTotal,
          bootBonus,
          ids,
          played: ceiling.played,
          maxPts: ceiling.max,
          // Share of the ceiling banked so far (team points only, no boot bonus).
          pct: ceiling.max ? teamTotal / ceiling.max : 0,
        };
      })
      .sort((a, b) =>
        sortBy === "pct"
          ? b.pct - a.pct || b.total - a.total || a.ts - b.ts
          : b.total - a.total || a.ts - b.ts
      );
  }, [entries, results, settings, live, sortBy]);

  if (entries === null)
    return (
      <div className="text-center text-stone-500 py-10 text-sm">
        Loading entries…
      </div>
    );

  // Before the deadline, keep everyone's actual picks hidden — only show who
  // has entered. Full lineups + standings unlock once entries lock.
  if (!locked) {
    const names = entries
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <Eyebrow>Entered ({names.length})</Eyebrow>
          <button
            onClick={loadEntries}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
          >
            Refresh
          </button>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-3 mb-3">
          🔒 Everyone&apos;s picks stay hidden until the opening kickoff. The
          full lineups and live standings unlock the moment entries lock.
        </div>
        {loadError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-3">
            {loadError}
          </div>
        )}
        {names.length === 0 && !loadError && (
          <div className="bg-white border border-stone-200 rounded-xl p-6 text-center text-stone-500 text-sm">
            No entries yet. Be the first on the pitch.
          </div>
        )}
        {names.map((nm, i) => (
          <div
            key={nm + i}
            className="bg-white border border-stone-200 rounded-xl mb-2 px-4 py-3 flex items-center gap-3"
          >
            <span className="text-emerald-600">✓</span>
            <span className="font-semibold text-stone-800">{nm}</span>
            <span className="ml-auto text-xs text-stone-400">locked in</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Standings</Eyebrow>
        <button
          onClick={loadEntries}
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
        >
          Refresh
        </button>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-stone-500">Sort by</span>
        <div className="inline-flex rounded-lg border border-stone-300 overflow-hidden">
          {[
            ["total", "Total points"],
            ["pct", "% of possible"],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setSortBy(val)}
              className={
                "px-3 py-1.5 text-xs font-bold " +
                (sortBy === val
                  ? "bg-emerald-800 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-100")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-3">
          {loadError}
        </div>
      )}
      {ranked.length === 0 && !loadError && (
        <div className="bg-white border border-stone-200 rounded-xl p-6 text-center text-stone-500 text-sm">
          No entries yet. Be the first on the tee… er, pitch.
        </div>
      )}
      {ranked.map((e, i) => {
        const slug = slugify(e.name);
        const isOpen = expanded === slug;
        return (
          <div
            key={slug + i}
            className="bg-white border border-stone-200 rounded-xl mb-2 overflow-hidden"
          >
            <button
              onClick={() => setExpanded(isOpen ? null : slug)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-7 text-center font-mono text-sm text-stone-400 shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <span className="font-semibold text-stone-800">{e.name}</span>
                  <div className="text-xs text-stone-400 font-mono">
                    {e.played > 0
                      ? `${e.played} game${e.played === 1 ? "" : "s"} played · ${
                          e.teamTotal
                        } of ${e.maxPts} possible`
                      : "no games played yet"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-stone-400 font-mono">
                  TB {e.tiebreaker}
                </span>
                <div className="w-12 text-right">
                  <div
                    className={
                      "font-mono font-bold leading-none " +
                      (sortBy === "pct"
                        ? "text-emerald-800 text-lg"
                        : "text-stone-400 text-xs")
                    }
                  >
                    {e.maxPts ? Math.round(e.pct * 100) + "%" : "—"}
                  </div>
                  <div
                    className={
                      "font-mono font-bold leading-none " +
                      (sortBy === "pct"
                        ? "text-stone-400 text-xs mt-0.5"
                        : "text-emerald-800 text-lg")
                    }
                  >
                    {e.total}
                  </div>
                </div>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-stone-100 px-4 py-3">
                {e.ids.map((id) => {
                  const tm = ALL_TEAMS[id];
                  const r = results[id];
                  const pts = teamPoints(r);
                  const c = teamCeiling(id, live);
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between py-1"
                    >
                      <span
                        className={
                          "text-sm " +
                          (r && r.finish === "out"
                            ? "text-stone-400 line-through"
                            : "text-stone-700")
                        }
                      >
                        <span className="font-mono text-xs text-stone-400 mr-2">
                          T{tm ? tm.tier : "?"}
                        </span>
                        <Flag id={id} className="mr-1.5 align-[-2px]" />
                        {tm ? tm.name : id}
                        <span className="font-mono text-xs text-stone-400 ml-2">
                          {c.played} GP
                        </span>
                      </span>
                      <span className="font-mono text-sm text-stone-600">
                        {pts}
                        <span className="text-stone-400"> / {c.max}</span>
                      </span>
                    </div>
                  );
                })}
                {e.goldenBoot && (
                  <div className="flex items-center justify-between py-1 mt-1 border-t border-stone-100">
                    <span className="text-sm text-stone-700">
                      <span className="font-mono text-xs text-stone-400 mr-2">
                        GB
                      </span>
                      {e.goldenBoot}
                      {e.bootBonus > 0 ? " ✓" : ""}
                    </span>
                    <span className="font-mono text-sm text-stone-600">
                      {e.bootBonus}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Analysis (pick distribution) ----------

function AnalysisView({ locked }) {
  const [entries, setEntries] = useState(null);
  const [loadError, setLoadError] = useState("");

  const loadEntries = async () => {
    setLoadError("");
    try {
      const listed = await storage.list("entry:", true);
      const keys = (listed && listed.keys) || [];
      const loaded = [];
      await Promise.all(
        keys.map(async (k) => {
          try {
            const res = await storage.get(k, true);
            if (res && res.value) loaded.push(JSON.parse(res.value));
          } catch (e) {
            // skip unreadable entry
          }
        })
      );
      setEntries(loaded);
    } catch (e) {
      setEntries([]);
      setLoadError("Could not load entries yet. Try again in a moment.");
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const total = entries ? entries.length : 0;

  // tierCounts[tierN][teamId] = how many entries picked that team.
  const tierCounts = useMemo(() => {
    const out = {};
    TIERS.forEach((t) => {
      out[t.n] = {};
      t.teams.forEach((tm) => (out[t.n][tm.id] = 0));
    });
    (entries || []).forEach((e) => {
      TIERS.forEach((t) => {
        const v = e.picks ? e.picks[t.n] : null;
        const ids = Array.isArray(v) ? v : v ? [v] : [];
        ids.forEach((id) => {
          if (out[t.n][id] != null) out[t.n][id] += 1;
        });
      });
    });
    return out;
  }, [entries]);

  // Golden Boot popularity (free-text, so just group by the trimmed string).
  const bootCounts = useMemo(() => {
    const map = {};
    (entries || []).forEach((e) => {
      const b = (e.goldenBoot || "").trim();
      if (b) map[b] = (map[b] || 0) + 1;
    });
    return Object.entries(map).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
  }, [entries]);

  if (entries === null)
    return (
      <div className="text-center text-stone-500 py-10 text-sm">
        Loading entries…
      </div>
    );

  // Picks stay secret until the opening kickoff, same as the leaderboard.
  if (!locked)
    return (
      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-3">
        🔒 Pick analysis unlocks at the opening kickoff, once everyone&apos;s
        picks become visible.
      </div>
    );

  if (total === 0)
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-6 text-center text-stone-500 text-sm">
        No entries to analyze yet.
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Pick distribution · {total} entries</Eyebrow>
        <button
          onClick={loadEntries}
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
        >
          Refresh
        </button>
      </div>
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-3">
          {loadError}
        </div>
      )}

      {TIERS.map((tier) => {
        const rows = tier.teams
          .map((tm) => ({ tm, count: tierCounts[tier.n][tm.id] || 0 }))
          .sort((a, b) => b.count - a.count || a.tm.name.localeCompare(b.tm.name));
        return (
          <div
            key={tier.n}
            className="bg-white border border-stone-200 rounded-xl p-4 mb-4"
          >
            <div className="flex items-baseline justify-between mb-2">
              <Eyebrow>
                Tier {tier.n} · pick {tier.pickCount}
              </Eyebrow>
              <span className="text-xs text-stone-400">
                {tier.teams.length} teams
              </span>
            </div>
            {rows.map(({ tm, count }) => {
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={tm.id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="flex items-center gap-1.5 text-sm text-stone-700 min-w-0">
                      <Flag id={tm.id} />
                      <span className="truncate">{tm.name}</span>
                    </span>
                    <span className="text-xs font-mono text-stone-500 shrink-0">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded bg-stone-100 overflow-hidden">
                    <div
                      className={
                        "h-full rounded " +
                        (count > 0 ? "bg-emerald-600" : "bg-stone-200")
                      }
                      style={{ width: pct + "%" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {bootCounts.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <Eyebrow>Golden Boot picks</Eyebrow>
          <div className="mt-2">
            {bootCounts.map(([name, count]) => (
              <div
                key={name}
                className="flex items-center justify-between py-1 border-b border-stone-100 last:border-0"
              >
                <span className="text-sm text-stone-700">{name}</span>
                <span className="text-xs font-mono text-stone-500">
                  {count} · {total ? Math.round((count / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Results (live feed) ----------

function MatchRow({ m }) {
  const live = m.status === "IN_PLAY" || m.status === "PAUSED";
  const done = m.status === "FINISHED";
  const hId = liveTeamToId(m.home && m.home.code, m.home && m.home.name);
  const aId = liveTeamToId(m.away && m.away.code, m.away && m.away.name);
  const hp = !!hId;
  const ap = !!aId;
  const hasScore = (live || done) && m.homeScore != null && m.awayScore != null;
  const when = new Date(m.utcDate).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const liveLabel = "LIVE" + (m.minute ? " " + m.minute + "'" : "");
  const meta =
    (live ? liveLabel : done ? "FT" : when) +
    (m.group ? " · " + m.group.replace("GROUP_", "Group ") : "");
  return (
    <div className="py-2 border-b border-stone-100 last:border-0">
      <div className="flex items-center gap-2">
        <span
          className={
            "flex-1 text-sm " +
            (hp ? "font-bold text-emerald-900" : "text-stone-700")
          }
        >
          <span className="flex items-center justify-end gap-1.5">
            {(m.home && m.home.name) || "TBD"}
            <Flag id={hId} />
          </span>
        </span>
        <span
          className={
            "px-2 py-0.5 rounded font-mono text-sm tabular-nums " +
            (live
              ? "bg-red-600 text-white"
              : done
              ? "bg-stone-800 text-white"
              : "text-stone-400")
          }
        >
          {hasScore ? `${m.homeScore}–${m.awayScore}` : "v"}
        </span>
        <span
          className={
            "flex-1 text-sm " +
            (ap ? "font-bold text-emerald-900" : "text-stone-700")
          }
        >
          <span className="flex items-center gap-1.5">
            <Flag id={aId} />
            {(m.away && m.away.name) || "TBD"}
          </span>
        </span>
      </div>
      <div className="text-center text-[11px] text-stone-400 mt-0.5">{meta}</div>
    </div>
  );
}

function GroupTable({ g }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-3 mb-3">
      <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">
        Group {g.group}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-stone-400">
            <th className="text-left font-medium py-1">Team</th>
            <th className="w-6 text-center font-medium">P</th>
            <th className="w-6 text-center font-medium">W</th>
            <th className="w-6 text-center font-medium">D</th>
            <th className="w-6 text-center font-medium">L</th>
            <th className="w-8 text-center font-medium">GD</th>
            <th className="w-7 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {(g.table || []).map((r) => {
            const id = liveTeamToId(r.code, r.name);
            const pooled = !!id;
            return (
              <tr key={r.code || r.name} className="border-t border-stone-100">
                <td
                  className={
                    "py-1 " +
                    (pooled ? "font-bold text-emerald-900" : "text-stone-700")
                  }
                >
                  <span className="font-mono text-[11px] text-stone-400 mr-1">
                    {r.position}
                  </span>
                  <Flag id={id} className="mr-1.5 align-[-2px]" />
                  {r.name}
                </td>
                <td className="text-center text-stone-600">{r.played}</td>
                <td className="text-center text-stone-600">{r.won}</td>
                <td className="text-center text-stone-600">{r.draw}</td>
                <td className="text-center text-stone-600">{r.lost}</td>
                <td className="text-center text-stone-600">
                  {r.gd > 0 ? "+" + r.gd : r.gd}
                </td>
                <td className="text-center font-bold text-stone-800">
                  {r.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultsView({ live }) {
  const matches = (live && live.matches) || [];
  const standings = ((live && live.standings) || [])
    .slice()
    .sort((a, b) => (a.group || "").localeCompare(b.group || ""));

  if (!live || (matches.length === 0 && standings.length === 0)) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-6 text-center">
        <div className="text-3xl mb-2">📡</div>
        <div className="font-bold text-stone-800">No live data yet</div>
        <p className="text-stone-600 text-sm mt-1">
          Match scores and group standings show up here once the live sync runs.
          If the tournament is underway and this stays empty, check the{" "}
          <span className="font-mono">Sync live results</span> GitHub Action.
        </p>
      </div>
    );
  }

  // Categorize by kickoff time, not just feed status. football-data's free tier
  // leaves a finished match marked TIMED for ~30 min before posting the result,
  // so a match that has already kicked off must never fall into "Upcoming" — it
  // belongs in results/live (with its live or carried score, or just "started").
  const now = Date.now();
  const started = (m) => new Date(m.utcDate).getTime() <= now;

  const recent = matches
    .filter(started)
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, 20);
  const upcoming = matches
    .filter((m) => !started(m))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, 12);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Live results</Eyebrow>
        <span className="text-xs text-stone-400">
          {live.source ? live.source + " · " : ""}updated{" "}
          {timeAgo(live.updatedAt)}
        </span>
      </div>

      {recent.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl p-3 mb-4">
          <div className="text-xs font-bold text-stone-400 uppercase tracking-wide mb-1">
            Results &amp; live
          </div>
          {recent.map((m) => (
            <MatchRow key={m.id} m={m} />
          ))}
        </div>
      )}

      {standings.length > 0 && (
        <>
          <div className="text-xs font-bold text-stone-400 uppercase tracking-wide mb-2">
            Group standings
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            {standings.map((g) => (
              <GroupTable key={g.group} g={g} />
            ))}
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl p-3 mt-1">
          <div className="text-xs font-bold text-stone-400 uppercase tracking-wide mb-1">
            Upcoming
          </div>
          {upcoming.map((m) => (
            <MatchRow key={m.id} m={m} />
          ))}
        </div>
      )}

      <p className="text-xs text-stone-400 mt-3">
        Your pool teams are highlighted. Scores and tables come straight from the
        live feed; the commissioner still confirms how they translate into pool
        points.
      </p>
    </div>
  );
}

// ---------- Rules ----------

function RulesView() {
  const rows = [
    ["Group stage win", SCORING.groupWin],
    ["Group stage draw", SCORING.groupDraw],
    ["Won the group (bonus)", SCORING.groupWinner],
    ["Advanced as runner-up (bonus)", SCORING.runnerUp],
    ["Advanced as 3rd-place qualifier (bonus)", SCORING.thirdQual],
    ["Round of 32 win", SCORING.r32],
    ["Round of 16 win", SCORING.r16],
    ["Quarterfinal win", SCORING.qf],
    ["Semifinal win", SCORING.sf],
    ["Third-place match win", SCORING.thirdPlace],
    ["Winning the Final", SCORING.final],
    ["Correct Golden Boot pick (bonus)", GOLDEN_BOOT_PTS],
  ];
  return (
    <div>
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <Eyebrow>How it works</Eyebrow>
        <p className="text-sm text-stone-700 mt-2">
          Pick the listed number of teams from each tier (most are one, some are
          two), {TIERS.reduce((s, t) => s + t.pickCount, 0)} teams in all. You
          also pick the Golden Boot winner, the tournament&apos;s top scorer, for
          a bonus. Your teams earn points all tournament long. Duplicated rosters
          are allowed. Entries lock at the opening kickoff, June 11 at 3:00 PM
          ET. Tiebreaker is total goals in the Final, closest without going over.
        </p>
      </div>
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <Eyebrow>Scoring</Eyebrow>
        <div className="mt-2">
          {rows.map(([label, pts]) => (
            <div
              key={label}
              className="flex justify-between py-1 border-b border-stone-100 last:border-0"
            >
              <span className="text-sm text-stone-700">{label}</span>
              <span className="font-mono font-bold text-emerald-800">
                {pts}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-stone-500 mt-3">
          A champion that also won its group banks roughly 45+ points. A Tier 8
          team that steals two group wins and qualifies is worth real points,
          choose wisely down there.
        </p>
      </div>
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <Eyebrow>The tiers</Eyebrow>
        {TIERS.map((t) => (
          <div key={t.n} className="mt-3">
            <div className="text-xs font-bold text-stone-500 uppercase tracking-wide">
              Tier {t.n} · pick {t.pickCount}
            </div>
            <p className="text-sm text-stone-700">
              {t.teams.map((tm) => tm.name).join(", ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Commissioner ----------

function AdminView({ results, setResults, settings, setSettings, live }) {
  const [authed, setAuthed] = useState(false);
  const [code, setCode] = useState("");
  const [draft, setDraft] = useState(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [entryList, setEntryList] = useState([]);
  const [bootWinner, setBootWinner] = useState("");

  useEffect(() => {
    if (authed) {
      const d = {};
      Object.keys(ALL_TEAMS).forEach((id) => {
        d[id] = results[id] ? JSON.parse(JSON.stringify(results[id])) : blankResult();
      });
      setDraft(d);
      setBootWinner(settings.goldenBootWinner || "");
      (async () => {
        try {
          const res = await storage.list("entry:", true);
          const keys = (res && res.keys) || [];
          const items = [];
          await Promise.all(
            keys.map(async (k) => {
              try {
                const v = await storage.get(k, true);
                const parsed = v && v.value ? JSON.parse(v.value) : null;
                items.push({
                  key: k,
                  name: parsed ? parsed.name : k.replace("entry:", ""),
                  goldenBoot: parsed ? parsed.goldenBoot || "" : "",
                });
              } catch (e) {
                items.push({
                  key: k,
                  name: k.replace("entry:", ""),
                  goldenBoot: "",
                });
              }
            })
          );
          items.sort((a, b) => a.name.localeCompare(b.name));
          setEntryList(items);
        } catch (e) {
          setEntryList([]);
        }
      })();
    }
  }, [authed]);

  if (!authed) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-6 max-w-sm mx-auto">
        <Eyebrow>Commissioner access</Eyebrow>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Passcode"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 mt-3 focus:outline-none focus:border-emerald-600"
        />
        <button
          onClick={() => {
            if (code === ADMIN_CODE) setAuthed(true);
            else setCode("");
          }}
          className="w-full mt-3 py-2 rounded-lg bg-emerald-800 text-white font-bold text-sm hover:bg-emerald-700"
        >
          Enter
        </button>
      </div>
    );
  }

  if (!draft)
    return (
      <div className="text-center text-stone-500 py-10 text-sm">Loading…</div>
    );

  const update = (id, patch) => {
    setSaveMsg("");
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  };
  const toggleKo = (id, key) => {
    setSaveMsg("");
    setDraft((d) => ({
      ...d,
      [id]: { ...d[id], ko: { ...d[id].ko, [key]: !d[id].ko[key] } },
    }));
  };

  const syncFromApi = () => {
    if (!live) return;
    setDraft((d) => deriveResults(live, d));
    setSaveMsg(
      "Pulled the live feed into the form below — review every team, then Save results."
    );
  };

  const saveResults = async () => {
    try {
      await storage.set("results", JSON.stringify(draft), true);
      setResults(draft);
      setSaveMsg("Results saved. Leaderboard is live.");
    } catch (e) {
      setSaveMsg("Save failed, try again.");
    }
  };

  const setLock = async (lockState) => {
    try {
      const next = { ...settings, lockState };
      await storage.set("settings", JSON.stringify(next), true);
      setSettings(next);
    } catch (e) {
      setSaveMsg("Could not update lock state.");
    }
  };

  const saveBootWinner = async () => {
    try {
      const next = { ...settings, goldenBootWinner: bootWinner.trim() };
      await storage.set("settings", JSON.stringify(next), true);
      setSettings(next);
      setSaveMsg("Golden Boot winner saved.");
    } catch (e) {
      setSaveMsg("Could not save Golden Boot winner.");
    }
  };

  const deleteEntry = async (key) => {
    try {
      await storage.delete(key, true);
      setEntryList((ls) => ls.filter((l) => l.key !== key));
    } catch (e) {
      setSaveMsg("Could not delete that entry.");
    }
  };

  const stepper = (id, field, max) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => update(id, { [field]: Math.max(0, draft[id][field] - 1) })}
        className="w-6 h-6 rounded bg-stone-200 text-stone-700 text-sm font-bold"
      >
        −
      </button>
      <span className="w-5 text-center font-mono text-sm">
        {draft[id][field]}
      </span>
      <button
        onClick={() =>
          update(id, { [field]: Math.min(max, draft[id][field] + 1) })
        }
        className="w-6 h-6 rounded bg-stone-200 text-stone-700 text-sm font-bold"
      >
        +
      </button>
    </div>
  );

  return (
    <div className="pb-24">
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <Eyebrow>Entry lock</Eyebrow>
        <div className="flex gap-2 mt-2">
          {[
            ["auto", "Auto (locks at kickoff)"],
            ["locked", "Lock now"],
            ["open", "Force open"],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setLock(val)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-bold " +
                ((settings.lockState || "auto") === val
                  ? "bg-emerald-800 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <Eyebrow>Golden Boot winner</Eyebrow>
        <p className="text-xs text-stone-500 mt-1">
          Set this when the tournament ends. Matching entries earn{" "}
          {GOLDEN_BOOT_PTS} points. Matching ignores accents and country tags,
          so check the count below catches everyone it should.
        </p>
        <div className="flex gap-2 mt-2">
          <input
            value={bootWinner}
            onChange={(e) => setBootWinner(e.target.value)}
            placeholder="e.g. Kylian Mbappé"
            className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
          />
          <button
            onClick={saveBootWinner}
            className="px-4 py-2 rounded-lg bg-emerald-800 text-white text-sm font-bold hover:bg-emerald-700"
          >
            Set
          </button>
        </div>
        {settings.goldenBootWinner && (
          <p className="text-xs text-emerald-700 mt-2">
            Current: {settings.goldenBootWinner} ·{" "}
            {
              entryList.filter((l) =>
                bootMatch(l.goldenBoot, settings.goldenBootWinner)
              ).length
            }{" "}
            matching entries
          </p>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <Eyebrow>Entries ({entryList.length})</Eyebrow>
        {entryList.length === 0 && (
          <p className="text-sm text-stone-500 mt-2">No entries yet.</p>
        )}
        {entryList.map((l) => (
          <div
            key={l.key}
            className="flex items-center justify-between py-1.5 border-b border-stone-100 last:border-0"
          >
            <span className="text-sm text-stone-700">
              {l.name}
              {l.goldenBoot && (
                <span className="text-xs text-stone-400 ml-2">
                  GB: {l.goldenBoot}
                </span>
              )}
            </span>
            <button
              onClick={() => deleteEntry(l.key)}
              className="text-xs text-red-600 font-semibold hover:text-red-800"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Eyebrow>Sync from live feed</Eyebrow>
          {live && (
            <span className="text-xs text-stone-400">
              feed updated {timeAgo(live.updatedAt)}
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-1">
          Pulls group W/D, group finish (including the 8 best third-place
          qualifiers), and knockout wins from the live feed into the form below.
          Nothing saves until you review and hit <strong>Save results</strong>,
          so you can fix anything the feed gets wrong.
        </p>
        <button
          onClick={syncFromApi}
          disabled={!live}
          className={
            "mt-2 px-4 py-2 rounded-lg text-sm font-bold " +
            (live
              ? "bg-emerald-800 text-white hover:bg-emerald-700"
              : "bg-stone-100 text-stone-400")
          }
        >
          {live ? "Sync from API" : "No live feed available yet"}
        </button>
      </div>

      <Eyebrow>Match results, by team</Eyebrow>
      <p className="text-xs text-stone-500 mt-1 mb-3">
        Update after each matchday: group wins and draws, then group finish,
        then check off knockout wins as they happen. Hit Save when done. Use
        Sync above to fill this in automatically, then adjust.
      </p>

      {TIERS.map((tier) => (
        <div key={tier.n} className="mb-3">
          <div className="text-xs font-bold text-stone-400 uppercase tracking-wide mb-1">
            Tier {tier.n}
          </div>
          {tier.teams.map((tm) => {
            const r = draft[tm.id];
            const advanced =
              r.finish === "winner" ||
              r.finish === "runnerup" ||
              r.finish === "third" ||
              (r.ko && Object.values(r.ko).some(Boolean));
            return (
              <div
                key={tm.id}
                className="bg-white border border-stone-200 rounded-xl p-3 mb-2"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold text-sm text-stone-800 w-36 flex items-center gap-1.5">
                    <Flag id={tm.id} />
                    {tm.name}
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-stone-500">W</span>
                      {stepper(tm.id, "gw", 3)}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-stone-500">D</span>
                      {stepper(tm.id, "gd", 3)}
                    </div>
                    <select
                      value={r.finish}
                      onChange={(e) => update(tm.id, { finish: e.target.value })}
                      className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white text-stone-700"
                    >
                      {FINISH_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="font-mono text-sm font-bold text-emerald-800 w-8 text-right">
                      {teamPoints(r)}
                    </span>
                  </div>
                </div>
                {advanced && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-stone-100">
                    {KO_STAGES.map((s) => (
                      <label
                        key={s.key}
                        className="flex items-center gap-1 text-xs text-stone-600"
                      >
                        <input
                          type="checkbox"
                          checked={!!r.ko[s.key]}
                          onChange={() => toggleKo(tm.id, s.key)}
                        />
                        {s.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="fixed bottom-0 left-0 right-0 bg-emerald-950 px-4 py-3 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={saveResults}
            className="flex-1 py-2 rounded-lg bg-amber-400 text-emerald-950 font-bold text-sm hover:bg-amber-300"
          >
            Save results
          </button>
          {saveMsg && (
            <span className="text-emerald-200 text-xs">{saveMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- App shell ----------

export default function WorldCupTierPool() {
  const [tab, setTab] = useState(null);
  const [results, setResults] = useState({});
  const [settings, setSettings] = useState({ lockState: "auto" });
  const [live, setLive] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const deadline = useMemo(() => new Date(DEADLINE_UTC), []);
  const countdown = useCountdown(deadline);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("results", true);
        if (r && r.value) setResults(JSON.parse(r.value));
      } catch (e) {
        // no results yet
      }
      try {
        const s = await storage.get("settings", true);
        if (s && s.value) setSettings(JSON.parse(s.value));
      } catch (e) {
        // default settings
      }
      try {
        const l = await storage.get("live", true);
        if (l && l.value) setLive(JSON.parse(l.value));
      } catch (e) {
        // no live feed yet
      }
      setLoaded(true);
    })();
  }, []);

  // Poll the live feed so an open page picks up new scores without a reload.
  // The poller refreshes Supabase every ~5 min; checking once a minute keeps the
  // Results tab current with negligible load.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const l = await storage.get("live", true);
        if (l && l.value) setLive(JSON.parse(l.value));
      } catch (e) {
        // transient; try again next tick
      }
    }, 60000);
    return () => clearInterval(t);
  }, []);

  const locked =
    settings.lockState === "locked"
      ? true
      : settings.lockState === "open"
      ? false
      : Date.now() >= deadline.getTime();

  // Once entries lock, the pool is about following along, so lead with Results
  // and tuck the now-inactive Make Picks tab at the end, grayed. Before lock,
  // Make Picks stays front-and-center. The third item flags a "muted" tab.
  const tabs = locked
    ? [
        ["results", "Results"],
        ["board", "Leaderboard"],
        ["analysis", "Analysis"],
        ["rules", "Rules"],
        ["admin", "Commissioner"],
        ["picks", "Make Picks", true],
      ]
    : [
        ["picks", "Make Picks"],
        ["board", "Leaderboard"],
        ["analysis", "Analysis"],
        ["results", "Results"],
        ["rules", "Rules"],
        ["admin", "Commissioner"],
      ];

  // Default to Results after lock, Make Picks before, until the user picks a tab.
  const activeTab = tab || (locked ? "results" : "picks");

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-emerald-950 text-white">
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-4">
          <div className="text-amber-300 text-xs font-bold uppercase tracking-widest">
            World Cup 2026 · Masters-style tier pool
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1">
            The 48-Team Tier Pool
          </h1>
          <div className="text-emerald-200 text-sm mt-1 font-mono">
            {locked
              ? "Entries locked · tournament underway"
              : countdown
              ? `Entries lock in ${countdown.h}h ${String(countdown.m).padStart(
                  2,
                  "0"
                )}m ${String(countdown.s).padStart(2, "0")}s (kickoff, 3:00 PM ET)`
              : "Entries lock at kickoff"}
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 flex gap-1 overflow-x-auto flex-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map(([id, label, muted]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                "px-3 py-2 text-sm font-semibold rounded-t-lg shrink-0 whitespace-nowrap " +
                (activeTab === id
                  ? "bg-stone-100 text-emerald-900"
                  : muted
                  ? "text-emerald-200/40 hover:text-emerald-200/70"
                  : "text-emerald-200 hover:text-white")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">
        {!isConfigured && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-lg px-4 py-3 mb-4">
            <strong>Heads up:</strong> Supabase isn&apos;t configured, so entries
            are saved only in this browser and won&apos;t be shared with the
            pool. Add <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> (see SETUP.md) to go live.
          </div>
        )}
        {!loaded ? (
          <div className="text-center text-stone-500 py-10 text-sm">
            Warming up…
          </div>
        ) : activeTab === "picks" ? (
          <PicksView locked={locked} onViewBoard={() => setTab("board")} />
        ) : activeTab === "board" ? (
          <LeaderboardView
            results={results}
            settings={settings}
            locked={locked}
            live={live}
          />
        ) : activeTab === "results" ? (
          <ResultsView live={live} />
        ) : activeTab === "analysis" ? (
          <AnalysisView locked={locked} />
        ) : activeTab === "rules" ? (
          <RulesView />
        ) : (
          <AdminView
            results={results}
            setResults={setResults}
            settings={settings}
            setSettings={setSettings}
            live={live}
          />
        )}
      </main>
    </div>
  );
}
