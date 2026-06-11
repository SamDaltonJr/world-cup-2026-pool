import { useState, useEffect, useMemo } from "react";

// ============================================================
// WORLD CUP 2026 TIER POOL
// Commissioner passcode: change ADMIN_CODE below before sharing
// Entries hard-lock at the opening kickoff (June 11, 2026, 19:00 UTC)
// ============================================================

const ADMIN_CODE = "commish2026";
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
    .replace(/[\u0300-\u036f]/g, "")
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
    pickCount: 1,
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
    pickCount: 1,
    teams: [
      { id: "CRO", name: "Croatia", odds: "+7000" },
      { id: "SUI", name: "Switzerland", odds: "+7000" },
      { id: "TUR", name: "Türkiye", odds: "+7500" },
      { id: "ECU", name: "Ecuador", odds: "+8000" },
      { id: "AUT", name: "Austria", odds: "+10000" },
    ],
  },
  {
    n: 6,
    pickCount: 1,
    teams: [
      { id: "SEN", name: "Senegal", odds: "+12500" },
      { id: "SWE", name: "Sweden", odds: "+15000" },
      { id: "CIV", name: "Ivory Coast", odds: "+15000" },
      { id: "CAN", name: "Canada", odds: "+20000" },
      { id: "PAR", name: "Paraguay", odds: "+20000" },
      { id: "SCO", name: "Scotland", odds: "+22500" },
      { id: "ALG", name: "Algeria", odds: "+25000" },
    ],
  },
  {
    n: 7,
    pickCount: 1,
    teams: [
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

function entryTeamIds(entry) {
  const ids = [];
  for (let i = 1; i <= 7; i++) if (entry.picks[i]) ids.push(entry.picks[i]);
  (entry.picks[8] || []).forEach((id) => ids.push(id));
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
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const ms = deadline.getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { h, m };
}

// ---------- Shared UI bits ----------

function Eyebrow({ children }) {
  return (
    <div className="text-xs font-bold uppercase tracking-widest text-emerald-700">
      {children}
    </div>
  );
}

function TeamChip({ team, selected, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "flex items-center justify-between w-full px-3 py-2 rounded-lg border text-left transition-colors " +
        (selected
          ? "bg-emerald-800 border-emerald-800 text-white"
          : disabled
          ? "bg-stone-100 border-stone-200 text-stone-400"
          : "bg-white border-stone-300 text-stone-800 hover:border-emerald-600")
      }
    >
      <span className="font-semibold text-sm">{team.name}</span>
      <span
        className={
          "text-xs font-mono " +
          (selected ? "text-emerald-200" : "text-stone-500")
        }
      >
        {team.odds}
      </span>
    </button>
  );
}

// ---------- Picks view ----------

function PicksView({ locked, onSaved }) {
  const [name, setName] = useState("");
  const [picks, setPicks] = useState({ 8: [] });
  const [tiebreaker, setTiebreaker] = useState("");
  const [goldenBoot, setGoldenBoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");

  const pickTeam = (tierN, teamId) => {
    setSavedMsg("");
    setError("");
    if (tierN === 8) {
      setPicks((p) => {
        const cur = p[8] || [];
        if (cur.includes(teamId))
          return { ...p, 8: cur.filter((id) => id !== teamId) };
        if (cur.length >= 2) return { ...p, 8: [cur[1], teamId] };
        return { ...p, 8: [...cur, teamId] };
      });
    } else {
      setPicks((p) => ({ ...p, [tierN]: p[tierN] === teamId ? null : teamId }));
    }
  };

  const slotIds = useMemo(() => {
    const ids = [];
    for (let i = 1; i <= 7; i++) ids.push(picks[i] || null);
    const t8 = picks[8] || [];
    ids.push(t8[0] || null);
    ids.push(t8[1] || null);
    return ids;
  }, [picks]);

  const complete =
    slotIds.every(Boolean) &&
    name.trim().length > 0 &&
    tiebreaker !== "" &&
    goldenBoot.trim().length > 0;

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Add your name first.");
    for (let i = 1; i <= 7; i++)
      if (!picks[i]) return setError(`Pick a team from Tier ${i}.`);
    if ((picks[8] || []).length !== 2)
      return setError("Pick exactly two teams from Tier 8.");
    const tb = parseInt(tiebreaker, 10);
    if (isNaN(tb) || tb < 0)
      return setError("Tiebreaker must be a number (total goals in the final).");
    if (!goldenBoot.trim()) return setError("Add your Golden Boot pick.");
    const slug = slugify(name);
    if (!slug) return setError("Name needs at least one letter or number.");
    setSaving(true);
    try {
      const entry = {
        name: name.trim(),
        picks: { ...picks, 8: [...picks[8]] },
        tiebreaker: tb,
        goldenBoot: goldenBoot.trim(),
        ts: Date.now(),
      };
      await window.storage.set("entry:" + slug, JSON.stringify(entry), true);
      setSavedMsg(
        `Picks saved for ${name.trim()}. Resubmit under the same name to change them before lock.`
      );
      if (onSaved) onSaved();
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

  return (
    <div className="pb-36">
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <label className="block text-sm font-semibold text-stone-700 mb-1">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSavedMsg("");
          }}
          placeholder="e.g. Curtis B"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-emerald-600"
        />
        <p className="text-xs text-stone-500 mt-2">
          Entries are visible to everyone in the pool. Resubmitting under the
          same name replaces your earlier picks.
        </p>
      </div>

      {TIERS.map((tier) => {
        const t8 = picks[8] || [];
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
                {tier.teams.length} teams
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tier.teams.map((tm) => (
                <TeamChip
                  key={tm.id}
                  team={tm}
                  selected={
                    tier.n === 8 ? t8.includes(tm.id) : picks[tier.n] === tm.id
                  }
                  onClick={() => pickTeam(tier.n, tm.id)}
                />
              ))}
            </div>
            {tier.n === 8 && (
              <p className="text-xs text-stone-500 mt-2">
                Selecting a third team swaps out your earliest Tier 8 pick.
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
          onChange={(e) => {
            setGoldenBoot(e.target.value);
            setSavedMsg("");
          }}
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
      {savedMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-3 mb-4">
          {savedMsg}
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
              {slotIds.filter(Boolean).length}/9 picked
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {slotIds.map((id, i) => (
              <span
                key={i}
                className={
                  "px-2 py-1 rounded text-xs font-mono " +
                  (id
                    ? "bg-emerald-700 text-white"
                    : "bg-emerald-900 text-emerald-500 border border-emerald-800")
                }
              >
                {id || (i < 7 ? `T${i + 1}` : "T8")}
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

function LeaderboardView({ results, settings }) {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [loadError, setLoadError] = useState("");

  const loadEntries = async () => {
    setLoadError("");
    try {
      const listed = await window.storage.list("entry:", true);
      const keys = (listed && listed.keys) || [];
      const loaded = [];
      await Promise.all(
        keys.map(async (k) => {
          try {
            const res = await window.storage.get(k, true);
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
        const bootBonus =
          settings.goldenBootWinner &&
          bootMatch(e.goldenBoot, settings.goldenBootWinner)
            ? GOLDEN_BOOT_PTS
            : 0;
        return { ...e, total: teamTotal + bootBonus, bootBonus, ids };
      })
      .sort((a, b) => b.total - a.total || a.ts - b.ts);
  }, [entries, results, settings]);

  if (entries === null)
    return (
      <div className="text-center text-stone-500 py-10 text-sm">
        Loading entries…
      </div>
    );

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
              <div className="flex items-center gap-3">
                <span className="w-7 text-center font-mono text-sm text-stone-400">
                  {i + 1}
                </span>
                <span className="font-semibold text-stone-800">{e.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-stone-400 font-mono">
                  TB {e.tiebreaker}
                </span>
                <span className="font-mono font-bold text-emerald-800 text-lg">
                  {e.total}
                </span>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-stone-100 px-4 py-3">
                {e.ids.map((id) => {
                  const tm = ALL_TEAMS[id];
                  const r = results[id];
                  const pts = teamPoints(r);
                  const out =
                    r &&
                    (r.finish === "out" ||
                      (r.finish &&
                        r.finish !== "" &&
                        !r.ko?.f &&
                        false));
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
                        {tm ? tm.name : id}
                      </span>
                      <span className="font-mono text-sm text-stone-600">
                        {pts}
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
          Pick one team from each of Tiers 1 through 7 and two teams from Tier
          8, nine teams total. You also pick the Golden Boot winner, the
          tournament&apos;s top scorer, for a bonus. Your teams earn points all
          tournament long. Duplicated rosters are allowed. Entries lock at the
          opening kickoff, June 11 at 3:00 PM ET. Tiebreaker is total goals in
          the Final, closest without going over.
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

function AdminView({ results, setResults, settings, setSettings }) {
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
          const res = await window.storage.list("entry:", true);
          const keys = (res && res.keys) || [];
          const items = [];
          await Promise.all(
            keys.map(async (k) => {
              try {
                const v = await window.storage.get(k, true);
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

  const saveResults = async () => {
    try {
      await window.storage.set("results", JSON.stringify(draft), true);
      setResults(draft);
      setSaveMsg("Results saved. Leaderboard is live.");
    } catch (e) {
      setSaveMsg("Save failed, try again.");
    }
  };

  const setLock = async (lockState) => {
    try {
      const next = { ...settings, lockState };
      await window.storage.set("settings", JSON.stringify(next), true);
      setSettings(next);
    } catch (e) {
      setSaveMsg("Could not update lock state.");
    }
  };

  const saveBootWinner = async () => {
    try {
      const next = { ...settings, goldenBootWinner: bootWinner.trim() };
      await window.storage.set("settings", JSON.stringify(next), true);
      setSettings(next);
      setSaveMsg("Golden Boot winner saved.");
    } catch (e) {
      setSaveMsg("Could not save Golden Boot winner.");
    }
  };

  const deleteEntry = async (key) => {
    try {
      await window.storage.delete(key, true);
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

      <Eyebrow>Match results, by team</Eyebrow>
      <p className="text-xs text-stone-500 mt-1 mb-3">
        Update after each matchday: group wins and draws, then group finish,
        then check off knockout wins as they happen. Hit Save when done.
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
              r.finish === "third";
            return (
              <div
                key={tm.id}
                className="bg-white border border-stone-200 rounded-xl p-3 mb-2"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold text-sm text-stone-800 w-32">
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
  const [tab, setTab] = useState("picks");
  const [results, setResults] = useState({});
  const [settings, setSettings] = useState({ lockState: "auto" });
  const [loaded, setLoaded] = useState(false);

  const deadline = useMemo(() => new Date(DEADLINE_UTC), []);
  const countdown = useCountdown(deadline);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("results", true);
        if (r && r.value) setResults(JSON.parse(r.value));
      } catch (e) {
        // no results yet
      }
      try {
        const s = await window.storage.get("settings", true);
        if (s && s.value) setSettings(JSON.parse(s.value));
      } catch (e) {
        // default settings
      }
      setLoaded(true);
    })();
  }, []);

  const locked =
    settings.lockState === "locked"
      ? true
      : settings.lockState === "open"
      ? false
      : Date.now() >= deadline.getTime();

  const tabs = [
    ["picks", "Make Picks"],
    ["board", "Leaderboard"],
    ["rules", "Rules"],
    ["admin", "Commissioner"],
  ];

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
              ? `Entries lock in ${countdown.h}h ${countdown.m}m (kickoff, 3:00 PM ET)`
              : "Entries lock at kickoff"}
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 flex gap-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                "px-3 py-2 text-sm font-semibold rounded-t-lg " +
                (tab === id
                  ? "bg-stone-100 text-emerald-900"
                  : "text-emerald-200 hover:text-white")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">
        {!loaded ? (
          <div className="text-center text-stone-500 py-10 text-sm">
            Warming up…
          </div>
        ) : tab === "picks" ? (
          <PicksView locked={locked} />
        ) : tab === "board" ? (
          <LeaderboardView results={results} settings={settings} />
        ) : tab === "rules" ? (
          <RulesView />
        ) : (
          <AdminView
            results={results}
            setResults={setResults}
            settings={settings}
            setSettings={setSettings}
          />
        )}
      </main>
    </div>
  );
}
