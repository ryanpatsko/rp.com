import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule } from 'ag-grid-community';
import { AgGridProvider } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import * as contestApi from '../contestApi';
import { regionSlug, RegionPill } from '../RegionPill';
import { TeamLogo, TeamLabel } from '../TeamLogo';
import {
  PLAYER_POOL_PAST_RESULTS,
  PLAYER_POOL_FIRST_PRIZE_USD,
  PLAYER_POOL_SECOND_PRIZE_USD,
  buildPlayerPoolTrophyCase,
} from '../data/playerPoolPastResults';
import './Contests.css';

const TABS = { draft: 'draft', teams: 'teams', leaderboard: 'leaderboard', players: 'players', pastResults: 'pastResults' };

const pastResultsMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
/** Match API score refresh schedule (~2 min). */
const LEADERBOARD_REFRESH_MS = 2 * 60 * 1000;
const NUM_ROUNDS = 6;
const INJURY_KEY_INSTRUCTIONS = 'Hardcoded injuries for draft board badges';

const INJURIES = [
  { team: 'Duke', name: 'Patrick Ngongba II', status: 'Q', note: 'Has a chance to play the first weekend' },
  { team: 'Duke', name: 'Caleb Foster', status: 'Q', note: 'Fractured foot, out a little while longer' },
  { team: 'Louisville', name: 'Mikel Brown', status: 'O' },
  { team: 'UNC', name: 'Caleb Wilson', status: 'O' },
  { team: 'BYU', name: 'Richie Saunders', status: 'O' },
  { team: 'Michigan', name: 'L.J. Cason', status: 'O' },
  { team: 'Alabama', name: 'Aden Holloway', status: 'D', note: 'Arrested with 2.1 pounds of weed' },
  { team: 'Texas Tech', name: 'JT Toppin', status: 'O' },
];

function normText(s) {
  let v = String(s || '').trim().toLowerCase();
  // Strip common suffixes like "jr" / "jr."
  v = v.replace(/\s+jr\.?$/, '');
  return v;
}

function injuryKey(team, playerName) {
  return `${normText(team)}|${normText(playerName)}`;
}

const INJURY_BY_TEAM_AND_NAME = INJURIES.reduce((acc, x) => {
  acc[injuryKey(x.team, x.name)] = { status: x.status, note: x.note };
  return acc;
}, {});

const INJURY_BY_NAME = INJURIES.reduce((acc, x) => {
  const key = normText(x.name);
  if (!acc[key]) acc[key] = { status: x.status, note: x.note };
  return acc;
}, {});

function getPlayerInjury(player) {
  if (!player) return null;
  const team = player.team_abbreviation || player.team_name || '';
  const key = injuryKey(team, player.name);
  return INJURY_BY_TEAM_AND_NAME[key] || INJURY_BY_NAME[normText(player.name)] || null;
}

function InjuryBadge({ injury }) {
  if (!injury?.status) return null;
  const status = String(injury.status).toUpperCase();
  const note = injury.note ? String(injury.note) : '';
  const title = note ? `${status}: ${note}` : status;
  const cls = status === 'O' ? 'injury-badge--o' : (status === 'D' ? 'injury-badge--d' : 'injury-badge--q');
  return (
    <span className={`injury-badge ${cls}`} title={title} aria-label={title}>
      {status}
    </span>
  );
}

/**
 * Bracket-aware max games for a roster. Group by team; when two teams could meet, assume the
 * team with more rostered players advances. East/South = left side, West/Midwest = right.
 */
function getMaxGamesForRoster(players) {
  if (!players?.length) return 0;
  const norm = (r) => (r || '').trim().toLowerCase();
  const teamKey = (p) => p.team_abbreviation || p.team_name || p.team_id || '?';
  const byTeam = new Map();
  for (const p of players) {
    const key = teamKey(p);
    if (!byTeam.has(key)) byTeam.set(key, { count: 0, region: norm(p.region) });
    byTeam.get(key).count += 1;
  }
  const byRegion = { east: [], south: [], west: [], midwest: [] };
  for (const { count, region } of byTeam.values()) {
    if (region === 'east') byRegion.east.push(count);
    else if (region === 'south') byRegion.south.push(count);
    else if (region === 'west') byRegion.west.push(count);
    else if (region === 'midwest') byRegion.midwest.push(count);
  }
  const top = (arr, n) => arr.slice(0, n);
  const sum = (arr) => arr.reduce((s, x) => s + x, 0);
  for (const r of Object.keys(byRegion)) byRegion[r].sort((a, b) => b - a);

  const r1 = Math.min(8, players.length);
  const r2 = Math.min(8, players.length);
  const r3 = Math.min(8, sum(top(byRegion.east, 4)) + sum(top(byRegion.south, 4)) + sum(top(byRegion.west, 4)) + sum(top(byRegion.midwest, 4)));
  const r4 = sum(top(byRegion.east, 2)) + sum(top(byRegion.south, 2)) + sum(top(byRegion.west, 2)) + sum(top(byRegion.midwest, 2));
  const r5 = (byRegion.east[0] ?? 0) + (byRegion.south[0] ?? 0) + (byRegion.west[0] ?? 0) + (byRegion.midwest[0] ?? 0);
  const leftBest = Math.max(0, ...byRegion.east, ...byRegion.south);
  const rightBest = Math.max(0, ...byRegion.west, ...byRegion.midwest);
  const r6 = leftBest + rightBest;

  return r1 + r2 + r3 + r4 + r5 + r6;
}

/** teamEliminatedAfterRound from API: team id -> bracket round lost (same numbering as score columns). */
function getTeamElimRound(player, teamEliminatedAfterRound) {
  if (!teamEliminatedAfterRound || !player || player.team_id == null) return null;
  const r = teamEliminatedAfterRound[String(player.team_id)];
  if (r == null) return null;
  const n = Number(r);
  return Number.isNaN(n) ? null : n;
}

function isTeamActiveInBracket(player, teamEliminatedAfterRound) {
  return getTeamElimRound(player, teamEliminatedAfterRound) == null;
}

function countPlayedGamesForPlayers(players, scores) {
  if (!players?.length || !scores) return 0;
  let total = 0;
  for (const pl of players) {
    const byRound = scores[String(pl.id)];
    if (!byRound || typeof byRound !== 'object') continue;
    for (let r = 1; r <= 6; r++) {
      if (Object.prototype.hasOwnProperty.call(byRound, String(r))) total += 1;
    }
  }
  return total;
}

function getNextManagerIndex(pickNumber1Based, numTeams = 8) {
  const round = Math.floor((pickNumber1Based - 1) / numTeams);
  const pickInRound = (pickNumber1Based - 1) % numTeams;
  return round % 2 === 0 ? pickInRound : numTeams - 1 - pickInRound;
}

const DRAFT_GRID_HEIGHT = '60vh';
const formatOneDecimal = (params) => {
  const v = params.value;
  if (v != null && typeof v === 'number' && !Number.isNaN(v)) return v.toFixed(1);
  return v ?? '—';
};

const rightAlign = { cellStyle: { textAlign: 'right' }, headerClass: 'draft-col-right', cellClass: 'draft-col-right' };
const centerAlign = { cellStyle: { textAlign: 'center' }, headerClass: 'draft-col-center', cellClass: 'draft-col-center' };

const seedComparator = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na)) return Number.isNaN(nb) ? 0 : 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb;
};

const REGIONS_ORDER = ['East', 'South', 'West', 'Midwest'];

/** Default (chalk) expected games: higher seed wins every game. 1-seeds: East/West 6, South/Midwest 5; 2→4; 3–4→3; 5–8→2; 9–16→1. */
function getDefaultExpectedGames(region, seed) {
  const s = Number(seed);
  if (Number.isNaN(s) || s < 1) return 1;
  if (s === 1) {
    const r = (region || '').trim().toLowerCase();
    if (r === 'east' || r === 'west') return 6;
    if (r === 'south' || r === 'midwest') return 5;
    return 6;
  }
  if (s === 2) return 4;
  if (s === 3 || s === 4) return 3;
  if (s >= 5 && s <= 8) return 2;
  return 1;
}

/** Chalk through round 3: each region sends 1 or 2. Bracket index 0–15 = bits for East, South, West, Midwest (1=that region sends 2-seed). */
function buildBracketScenarios() {
  const list = [];
  for (let i = 0; i < 16; i++) {
    const eastSeed = (i & 1) ? 2 : 1;
    const southSeed = (i & 2) ? 2 : 1;
    const westSeed = (i & 4) ? 2 : 1;
    const midwestSeed = (i & 8) ? 2 : 1;
    const left = eastSeed <= southSeed ? { region: 'East', seed: eastSeed } : { region: 'South', seed: southSeed };
    const right = westSeed <= midwestSeed ? { region: 'West', seed: westSeed } : { region: 'Midwest', seed: midwestSeed };
    const champion = left.seed <= right.seed ? left : right;
    const runnerUp = left.seed <= right.seed ? right : left;
    const finalFour = [
      { region: 'East', seed: eastSeed },
      { region: 'South', seed: southSeed },
      { region: 'West', seed: westSeed },
      { region: 'Midwest', seed: midwestSeed },
    ];
    const finalTwo = [champion, runnerUp];
    const key = (r, s) => `${(r || '').trim()}_${s}`;
    const games = {};
    for (const { region, seed } of finalFour) {
      const k = key(region, seed);
      if (region === champion.region && seed === champion.seed) games[k] = 6;
      else if (region === runnerUp.region && seed === runnerUp.seed) games[k] = 6;
      else games[k] = 5;
    }
    for (const reg of REGIONS_ORDER) {
      const adv = finalFour.find((f) => f.region === reg);
      const otherSeed = adv.seed === 1 ? 2 : 1;
      games[key(reg, otherSeed)] = 4;
    }
    list.push({
      id: `bracket-${i}`,
      label: `Bracket ${i + 1}`,
      finalFour,
      finalTwo,
      getExpectedGames(region, seed) {
        const s = Number(seed);
        if (Number.isNaN(s) || s < 1) return 1;
        const r = (region || '').trim();
        if (s === 1 || s === 2) {
          const k = key(region, s);
          if (games[k] != null) return games[k];
        }
        if (s === 3 || s === 4) return 3;
        if (s >= 5 && s <= 8) return 2;
        return 1;
      },
    });
  }
  return list;
}

const BRACKET_SCENARIOS = buildBracketScenarios();

function MultiSelectDropdown({ options, selected, onChange, placeholder, ariaLabel, id }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);
  const label = selected.length === 0 ? placeholder : selected.join(', ');
  const toggle = (value) => {
    if (selected.includes(value)) onChange(selected.filter((s) => s !== value));
    else onChange([...selected, value].sort((a, b) => Number(a) - Number(b)));
  };
  return (
    <div className="draft-multiselect-wrap" ref={ref}>
      <button
        type="button"
        id={id}
        className="draft-filter-select draft-multiselect-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
      >
        {label}
      </button>
      {open && (
        <div className="draft-multiselect-panel" role="listbox" aria-multiselectable="true">
          {options.map((opt) => {
            const value = typeof opt === 'string' ? opt : opt.value;
            const labelText = typeof opt === 'string' ? opt : (opt.label || opt.value);
            const checked = selected.includes(value);
            return (
              <label key={value} className="draft-multiselect-option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(value)}
                />
                <span>{labelText || '—'}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getRegionSeedKey(region, seed) {
  return `${(region || '').trim().toLowerCase()}_${seed}`;
}

function formatFinalFour(finalFour, regionSeedToTeam) {
  if (!finalFour?.length) return '—';
  return finalFour.map((f) => regionSeedToTeam?.[getRegionSeedKey(f.region, f.seed)] ?? `${f.region} ${f.seed}`).join(', ');
}

function formatFinalTwo(finalTwo, regionSeedToTeam) {
  if (!finalTwo?.length) return '—';
  return finalTwo.map((f) => regionSeedToTeam?.[getRegionSeedKey(f.region, f.seed)] ?? `${f.region} ${f.seed}`).join(' vs ');
}

function RankingSystemDropdown({ value, onChange, id, ariaLabel, regionSeedToTeam }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);
  const defaultOption = { id: 'default', label: 'Rank: Default', finalFour: REGIONS_ORDER.map((r) => ({ region: r, seed: 1 })), finalTwo: [{ region: 'East', seed: 1 }, { region: 'West', seed: 1 }] };
  const options = [defaultOption, ...BRACKET_SCENARIOS];
  const current = options.find((o) => o.id === value) || defaultOption;
  return (
    <div className="draft-ranking-dropdown-wrap" ref={ref}>
      <button
        type="button"
        id={id}
        className="draft-filter-select draft-ranking-dropdown-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
      >
        {current.label}
      </button>
      {open && (
        <div className="draft-ranking-panel" role="listbox">
          {options.map((opt) => (
            <div
              key={opt.id}
              role="option"
              aria-selected={value === opt.id}
              className="draft-ranking-option"
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
            >
              <span className="draft-ranking-option-title">{opt.label}</span>
              <span className="draft-ranking-option-meta">Final 4: {formatFinalFour(opt.finalFour, regionSeedToTeam)}</span>
              <span className="draft-ranking-option-meta">Final 2: {formatFinalTwo(opt.finalTwo, regionSeedToTeam)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DRAFT_COLUMN_DEFS = [
  {
    field: 'name',
    headerName: 'Name',
    sortable: true,
    minWidth: 165,
    cellRenderer: (params) => {
      const d = params.data;
      if (!d) return null;
      return (
        <span className="draft-player-name-inline">
          <span>{d.name}</span>
          <InjuryBadge injury={d.injury} />
        </span>
      );
    },
  },
  {
    field: 'team',
    headerName: 'Team',
    sortable: true,
    cellRenderer: (params) => {
      const d = params.data;
      if (!d) return null;
      return <TeamLabel logoUrl={d.team_logo_url} text={d.team} />;
    },
  },
  { field: 'position', headerName: 'Pos', sortable: true, ...centerAlign },
  {
    field: 'region',
    headerName: 'Region',
    sortable: true,
    cellRenderer: (params) => <RegionPill region={params.value} />,
  },
  {
    field: 'seed',
    headerName: 'Seed',
    sortable: true,
    comparator: seedComparator,
    valueGetter: (params) => {
      const v = params.data?.seed;
      if (v == null || v === '' || v === '—') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    },
    valueFormatter: (params) => params.value != null ? String(params.value) : '—',
    ...centerAlign,
  },
  { field: 'ppg', headerName: 'PPG', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'rank', headerName: 'Rank', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'gs', headerName: 'G', sortable: true, ...rightAlign },
  { field: 'mpg', headerName: 'Min', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
];

const DRAFT_COLUMN_DEFS_MOBILE = [
  {
    field: 'name',
    headerName: 'Player',
    sortable: true,
    minWidth: 120,
    flex: 1,
    cellRenderer: (params) => {
      const d = params.data;
      if (!d) return null;
      return (
        <div className="draft-player-cell">
          <span className="draft-player-name">
            <span>{d.name}</span>
            <InjuryBadge injury={d.injury} />
          </span>
          <span className="draft-player-meta">
            <TeamLogo url={d.team_logo_url} title={d.team} />
            {d.team} · {d.position}
            {d.region && d.region !== '—' ? (
              <> · <RegionPill region={d.region} /></>
            ) : null}
          </span>
        </div>
      );
    },
  },
  {
    field: 'seed',
    headerName: 'Sd',
    sortable: true,
    comparator: seedComparator,
    valueGetter: (params) => {
      const v = params.data?.seed;
      if (v == null || v === '' || v === '—') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    },
    valueFormatter: (params) => params.value != null ? String(params.value) : '—',
    width: 54,
    minWidth: 54,
    ...centerAlign,
  },
  { field: 'ppg', headerName: 'PPG', sortable: true, width: 68, minWidth: 68, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'rank', headerName: 'Rk', sortable: true, width: 56, minWidth: 56, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'gs', headerName: 'G', sortable: true, width: 44, minWidth: 44, ...rightAlign },
  { field: 'mpg', headerName: 'Min', sortable: true, width: 60, minWidth: 60, valueFormatter: formatOneDecimal, ...rightAlign },
];

const MOBILE_BREAKPOINT_PX = 768;

export default function ContestPage() {
  const { contestId } = useParams();
  const [tab, setTab] = useState(TABS.leaderboard);
  const [selectedLeaderboardManager, setSelectedLeaderboardManager] = useState(null);
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState([]);
  const [playerPool, setPlayerPool] = useState([]);
  const [scores, setScores] = useState({});
  /** Same shape as scores; true = that round's points are from an in-progress game. */
  const [scoresLive, setScoresLive] = useState({});
  const [teamEliminatedAfterRound, setTeamEliminatedAfterRound] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX);
  /** False when not on Leaderboard tab; used to detect switching onto Leaderboard so we auto-pick the points leader. */
  const leaderboardTabActiveRef = useRef(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    handler();
    return () => mql.removeEventListener('change', handler);
  }, []);

  const load = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, d, p, scoresRes] = await Promise.all([
        contestApi.getConfig(contestId),
        contestApi.getDraft(contestId),
        contestApi.getPlayerPool(contestId),
        contestApi
          .getScores(contestId)
          .catch(() => ({ scores: {}, scoresLive: {}, teamEliminatedAfterRound: {} })),
      ]);
      setConfig(c);
      setDraft(Array.isArray(d) ? d : []);
      setPlayerPool(Array.isArray(p) ? p : []);
      setScores(scoresRes?.scores ?? {});
      setScoresLive(scoresRes?.scoresLive ?? {});
      setTeamEliminatedAfterRound(scoresRes?.teamEliminatedAfterRound ?? {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== TABS.draft && tab !== TABS.teams) return;
    const numTeams = (config?.draftOrder?.length || config?.manager_names?.length || config?.managerNames?.length) || 8;
    const picksCount = (draft ?? []).length;
    if (picksCount >= numTeams * 8) return; // draft complete: no auto-refresh
    const interval = setInterval(load, 10 * 1000);
    return () => clearInterval(interval);
  }, [tab, load, config?.draftOrder?.length, config?.manager_names?.length, config?.managerNames?.length, (draft ?? []).length]);

  useEffect(() => {
    if (tab !== TABS.leaderboard && tab !== TABS.players && tab !== TABS.teams) return;
    const interval = setInterval(load, LEADERBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [tab, load]);

  const [filterTeam, setFilterTeam] = useState('');
  const [filterRegion, setFilterRegion] = useState([]);
  const [filterSeed, setFilterSeed] = useState([]);
  const [hideDrafted, setHideDrafted] = useState(true);
  const [hideChumps, setHideChumps] = useState(true);
  const [rankingSystem, setRankingSystem] = useState('default');

  const draftedPlayerIds = new Set((draft || []).map((x) => x.playerId));
  const poolWithDrafted = (playerPool || []).map((pl) => ({
    ...pl,
    drafted: draftedPlayerIds.has(pl.id),
    pickedBy: (draft || []).find((p) => p.playerId === pl.id)?.managerIndex,
  }));

  const managers = (config?.draftOrder && config.draftOrder.length > 0) ? config.draftOrder : (config?.manager_names || config?.managerNames || []);

  const draftBoardRows = useMemo(() => {
    const withPpg = poolWithDrafted.filter((pl) => pl.pts_per_game != null);
    const filtered = withPpg.filter((pl) => {
      const injury = getPlayerInjury(pl);
      if (hideDrafted && pl.drafted) return false;
      if (hideChumps && injury?.status === 'O') return false;
      if (hideChumps && pl.pts_per_game != null && Number(pl.pts_per_game) < 7) return false;
      if (filterTeam && (pl.team_abbreviation || pl.team_name) !== filterTeam) return false;
      if (filterRegion.length > 0 && !filterRegion.includes(pl.region ?? '')) return false;
      if (filterSeed.length > 0 && !filterSeed.includes(String(pl.seed ?? ''))) return false;
      return true;
    });
    const seedNum = (v) => { const n = Number(v); return Number.isNaN(n) ? 99 : n; };
    const sorted = [...filtered].sort((a, b) => seedNum(a.seed) - seedNum(b.seed) || (b.pts_per_game ?? 0) - (a.pts_per_game ?? 0));
    return sorted.map((pl) => {
      const region = pl.region ?? '—';
      const seed = pl.seed ?? '—';
      const scenario = rankingSystem.startsWith('bracket-') ? BRACKET_SCENARIOS.find((s) => s.id === rankingSystem) : null;
      const expectedGames = scenario ? scenario.getExpectedGames(pl.region, pl.seed) : getDefaultExpectedGames(pl.region, pl.seed);
      const ppg = pl.pts_per_game ?? 0;
      const rank = expectedGames * ppg;
      return {
        id: pl.id,
        name: pl.name,
        injury: getPlayerInjury(pl),
        team: pl.team_abbreviation || pl.team_name || '—',
        team_logo_url: pl.team_logo_url,
        position: pl.position || '—',
        region,
        seed,
        regionSeed: `${region} ${seed}`.trim() || '—',
        ppg: pl.pts_per_game,
        rank: Math.round(rank * 10) / 10,
        gs: pl.games_started ?? pl.games_played ?? '—',
        mpg: pl.min_per_game ?? '—',
        _drafted: pl.drafted,
      };
    });
  }, [poolWithDrafted, managers, filterTeam, filterRegion, filterSeed, hideDrafted, hideChumps, rankingSystem]);

  const filterOptions = useMemo(() => {
    const withPpg = poolWithDrafted.filter((pl) => pl.pts_per_game != null);
    const teams = [...new Set(withPpg.map((pl) => pl.team_abbreviation || pl.team_name || '').filter(Boolean))].sort();
    const regions = [...new Set(withPpg.map((pl) => pl.region ?? '').filter((r) => r !== ''))].sort();
    const seeds = [...new Set(withPpg.map((pl) => String(pl.seed ?? '')).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    return { teams, regions, seeds };
  }, [poolWithDrafted]);

  const regionSeedToTeam = useMemo(() => {
    const map = {};
    for (const pl of poolWithDrafted || []) {
      const r = pl.region ?? '';
      const s = pl.seed ?? '';
      const team = pl.team_abbreviation || pl.team_name || '';
      if (!team) continue;
      const key = `${(r + '').trim().toLowerCase()}_${s}`;
      if (!map[key]) map[key] = team;
    }
    return map;
  }, [poolWithDrafted]);
  const picksByManager = (draft || []).reduce((acc, p) => {
    const i = p.managerIndex ?? p.manager_index ?? 0;
    if (!acc[i]) acc[i] = [];
    acc[i].push(p);
    return acc;
  }, {});

  const getPlayerById = (id) => playerPool.find((p) => p.id === id);

  const numTeams = managers?.length || 8;
  const nextPickNumber = (draft?.length ?? 0) + 1;
  const nextManagerIndex = getNextManagerIndex(nextPickNumber, numTeams);
  const nextRound = Math.floor((nextPickNumber - 1) / numTeams) + 1;
  const nextPickInRound = (nextPickNumber - 1) % numTeams + 1;
  const currentPickLabel = managers?.length
    ? (nextPickNumber <= numTeams * 8
      ? `Current pick: ${managers[nextManagerIndex] ?? `Manager ${nextManagerIndex + 1}`} (${nextRound}.${nextPickInRound})`
      : 'Draft complete')
    : null;

  const pickHistoryList = useMemo(() => {
    const list = (draft || []).map((pick, i) => {
      const pickNum = i + 1;
      const round = Math.floor((pickNum - 1) / numTeams) + 1;
      const pickInRound = (pickNum - 1) % numTeams + 1;
      const midx = pick.managerIndex ?? pick.manager_index ?? 0;
      const pid = pick.playerId ?? pick.player_id;
      const player = getPlayerById(pid);
      const team = player?.team_abbreviation || player?.team_name || '—';
      const position = player?.position || '—';
      const region = player?.region ?? '—';
      const seed = player?.seed ?? '—';
      const playerMeta = `${team} · ${position}`;
      return {
        key: i,
        label: `${round}.${pickInRound}`,
        managerName: managers[midx] ?? `Manager ${midx}`,
        playerName: player?.name ?? `ID ${pid}`,
        playerMeta,
        region,
        seed,
      };
    });
    return [...list].reverse();
  }, [draft, numTeams, managers, playerPool]);

  const leaderboardRows = useMemo(() => {
    const byManager = (draft || []).reduce((acc, p) => {
      const i = p.managerIndex ?? p.manager_index ?? 0;
      if (!acc[i]) acc[i] = [];
      acc[i].push(p);
      return acc;
    }, {});
    const playerTotal = (playerId) => {
      const byRound = scores[String(playerId)];
      if (!byRound || typeof byRound !== 'object') return 0;
      return [1, 2, 3, 4, 5, 6].reduce((sum, r) => sum + (Number(byRound[String(r)]) || 0), 0);
    };
    const playerHasAnyLiveRound = (playerId) => {
      const live = scoresLive[String(playerId)];
      if (!live || typeof live !== 'object') return false;
      return [1, 2, 3, 4, 5, 6].some((r) => live[String(r)]);
    };
    const getPlayerById = (id) => playerPool.find((p) => p.id === id);
    const rows = (managers || []).map((name, idx) => {
      const picks = byManager[idx] || [];
      const rosterPlayers = picks
        .map((p) => getPlayerById(p.playerId ?? p.player_id))
        .filter(Boolean);
      const activePlayers = rosterPlayers.filter((pl) => isTeamActiveInBracket(pl, teamEliminatedAfterRound));
      const playerCount = activePlayers.length;
      const points = picks.reduce((sum, p) => sum + playerTotal(p.playerId ?? p.player_id), 0);
      const projectedActiveGames = getMaxGamesForRoster(activePlayers);
      const playedActiveGames = countPlayedGamesForPlayers(activePlayers, scores);
      const maxGames = Math.max(0, projectedActiveGames - playedActiveGames);
      const hasLiveScores = picks.some((p) =>
        playerHasAnyLiveRound(p.playerId ?? p.player_id)
      );
      return {
        managerIndex: idx,
        name,
        points,
        players: playerCount,
        maxGames,
        hasLiveScores,
      };
    });
    const sorted = [...rows].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    const leaderPoints = sorted[0]?.points ?? 0;
    return sorted.map((row) => ({
      ...row,
      pointsBehindLeader: Math.max(0, leaderPoints - (row.points ?? 0)),
    }));
  }, [managers, draft, scores, scoresLive, playerPool, teamEliminatedAfterRound]);

  /** All drafted players in one list, sorted by fantasy points (desc). */
  const playersGridRows = useMemo(() => {
    const rows = [];
    for (const pick of draft || []) {
      const midx = pick.managerIndex ?? pick.manager_index ?? 0;
      const pid = pick.playerId ?? pick.player_id;
      const pl = playerPool.find((p) => p.id === pid);
      if (!pl) continue;
      const byRound = scores[String(pl.id)] || {};
      const total = [1, 2, 3, 4, 5, 6].reduce((s, r) => s + (Number(byRound[String(r)]) || 0), 0);
      rows.push({
        pl,
        managerIndex: midx,
        managerName: managers[midx] ?? `Manager ${midx + 1}`,
        total,
      });
    }
    return rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  }, [draft, playerPool, scores, managers]);

  useEffect(() => {
    if (tab !== TABS.leaderboard) {
      leaderboardTabActiveRef.current = false;
      return;
    }
    if (!managers?.length || !leaderboardRows.length) return;
    const leaderIdx = leaderboardRows[0].managerIndex;
    const invalid =
      selectedLeaderboardManager == null ||
      selectedLeaderboardManager >= managers.length;
    const enteredLeaderboard = !leaderboardTabActiveRef.current;
    leaderboardTabActiveRef.current = true;
    if (invalid || enteredLeaderboard) {
      setSelectedLeaderboardManager(leaderIdx);
    }
  }, [tab, managers, leaderboardRows, selectedLeaderboardManager]);

  const selectedRosterPlayers = useMemo(() => {
    if (selectedLeaderboardManager == null) return [];
    const picks = picksByManager[selectedLeaderboardManager] || [];
    return picks
      .map((p) => getPlayerById(p.playerId ?? p.player_id))
      .filter(Boolean);
  }, [selectedLeaderboardManager, picksByManager, playerPool]);

  const trophyCaseRows = useMemo(() => buildPlayerPoolTrophyCase(), []);

  if (loading && !config) {
    return (
      <div className="contests-page">
        <div className="contests-loading">Loading…</div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="contests-page">
        <header className="contests-header">
          <Link to="/contests" className="contests-back">← Contests</Link>
        </header>
        <div className="contests-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="contests-page">
      <header className="contests-header">
        <Link to="/contests" className="contests-back">← Contests</Link>
        <h1>{contestId.replace(/-.*$/, '')} March Madness Player Pool</h1>
      </header>

      {error && <div className="contests-error">{error}</div>}

      <nav className="contests-tabs">
        <button
          type="button"
          className={tab === TABS.draft ? 'active' : ''}
          onClick={() => setTab(TABS.draft)}
        >
          Draft Board
        </button>
        <button
          type="button"
          className={tab === TABS.teams ? 'active' : ''}
          onClick={() => setTab(TABS.teams)}
        >
          Teams
        </button>
        <button
          type="button"
          className={tab === TABS.leaderboard ? 'active' : ''}
          onClick={() => setTab(TABS.leaderboard)}
        >
          Leaderboard
        </button>
        <button
          type="button"
          className={tab === TABS.players ? 'active' : ''}
          onClick={() => setTab(TABS.players)}
        >
          Players
        </button>
        <button
          type="button"
          className={tab === TABS.pastResults ? 'active' : ''}
          onClick={() => setTab(TABS.pastResults)}
        >
          Past Results
        </button>
      </nav>

      {tab === TABS.draft && (
        <div className="draft-board-wrap">
          {playerPool.length === 0 ? (
            <p className="contests-loading">No players yet. Run “Import players from BallDontLie” to load the pool.</p>
          ) : (
            <>
              {currentPickLabel && (
                <div className="draft-current-pick-alert" role="status">
                  {currentPickLabel}
                </div>
              )}
              <div className="draft-board-filters">
                <RankingSystemDropdown
                  id="draft-ranking-system"
                  value={rankingSystem}
                  onChange={setRankingSystem}
                  ariaLabel="Ranking system"
                  regionSeedToTeam={regionSeedToTeam}
                />
                <select
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                  className="draft-filter-select"
                  aria-label="Filter by team"
                >
                  <option value="">All Teams</option>
                  {filterOptions.teams.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <MultiSelectDropdown
                  id="draft-filter-region"
                  options={filterOptions.regions}
                  selected={filterRegion}
                  onChange={setFilterRegion}
                  placeholder="All Regions"
                  ariaLabel="Filter by region (multi-select)"
                />
                <MultiSelectDropdown
                  id="draft-filter-seed"
                  options={filterOptions.seeds}
                  selected={filterSeed}
                  onChange={setFilterSeed}
                  placeholder="All Seeds"
                  ariaLabel="Filter by seed (multi-select)"
                />
                <label className="draft-filter-toggle-label">
                  <input
                    type="checkbox"
                    className="draft-filter-toggle"
                    checked={hideDrafted}
                    onChange={(e) => setHideDrafted(e.target.checked)}
                  />
                  <span className="draft-filter-toggle-slider" />
                  Hide Drafted
                </label>
                <label className="draft-filter-toggle-label">
                  <input
                    type="checkbox"
                    className="draft-filter-toggle"
                    checked={hideChumps}
                    onChange={(e) => setHideChumps(e.target.checked)}
                  />
                  <span className="draft-filter-toggle-slider" />
                  Hide Chumps + Out
                </label>
              </div>
              <div className="draft-board-layout">
                <div className="draft-board-grid-col">
                  <AgGridProvider modules={[AllCommunityModule]}>
                    <div className="ag-theme-quartz-dark draft-board-grid" style={{ height: DRAFT_GRID_HEIGHT, width: '100%' }}>
                      <AgGridReact
                        key={isMobile ? 'mobile' : 'desktop'}
                        rowData={draftBoardRows}
                        columnDefs={isMobile ? DRAFT_COLUMN_DEFS_MOBILE : DRAFT_COLUMN_DEFS}
                        defaultColDef={{ sortable: true }}
                        rowHeight={isMobile ? 52 : 42}
                        headerHeight={42}
                        initialState={{ sort: { sortModel: [{ colId: 'rank', sort: 'desc' }] } }}
                        getRowId={(params) => String(params.data.id)}
                        getRowClass={(params) => (params.data?._drafted ? 'draft-row-drafted' : '')}
                        suppressColumnMenu
                        onGridReady={(e) => { if (!isMobile) e.api.sizeColumnsToFit(); }}
                        onFirstDataRendered={(e) => { if (!isMobile) e.api.sizeColumnsToFit(); }}
                      />
                    </div>
                  </AgGridProvider>
                </div>
                <div className="draft-board-pick-history-col">
                  <div className="admin-pick-history">
                <div className="admin-pick-history-header">
                  <h3>Players drafted</h3>
                </div>
                <ul className="admin-pick-history-list">
                  {pickHistoryList.length === 0 ? (
                    <li className="admin-pick-history-empty">No picks yet</li>
                  ) : (
                    pickHistoryList.map((item) => (
                      <li key={item.key} className="admin-pick-history-item admin-pick-history-item-with-meta">
                        <span className="admin-pick-history-pick">{item.label}</span>
                        <span className="admin-pick-history-manager">{item.managerName}</span>
                        <span className="admin-pick-history-player">
                          <span className="admin-pick-history-player-name">{item.playerName}</span>
                          <span className="admin-pick-history-player-meta">
                            {item.region && item.region !== '—' ? (
                              <span className={`draft-region-pill draft-region-pill--${regionSlug(item.region)}`}>
                                {item.region}{item.seed && item.seed !== '—' ? ` (${item.seed})` : ''}
                              </span>
                            ) : null}
                            {item.region && item.region !== '—' ? ' ' : null}{item.playerMeta}
                          </span>
                        </span>
                      </li>
                    ))
                  )}
                </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === TABS.teams && (
        <div className="teams-grid">
          {managers.map((name, idx) => {
            const picks = picksByManager[idx] || [];
            const players = picks
              .map((p) => getPlayerById(p.playerId))
              .filter(Boolean);
            const regionCounts = { East: 0, South: 0, West: 0, Midwest: 0 };
            const normRegion = (s) => (s || '').trim().toLowerCase();
            players.forEach((pl) => {
              const r = normRegion(pl.region);
              if (r === 'east') regionCounts.East++;
              else if (r === 'south') regionCounts.South++;
              else if (r === 'west') regionCounts.West++;
              else if (r === 'midwest') regionCounts.Midwest++;
            });
            return (
              <div key={idx} className="team-card">
                <h3 className="team-card-title">{name}</h3>
                <div className="team-card-inner">
                  <div className="team-card-roster">
                    <ul>
                      {players.length === 0 ? (
                        <li className="player-meta">No picks yet</li>
                      ) : (
                        players.map((pl) => {
                          const byRound = scores[String(pl.id)] || {};
                          const elimR = getTeamElimRound(pl, teamEliminatedAfterRound);
                          const rowTotal = [1, 2, 3, 4, 5, 6].reduce(
                            (s, r) => s + (Number(byRound[String(r)]) || 0),
                            0
                          );
                          const totalIsLive = [1, 2, 3, 4, 5, 6].some(
                            (r) => !!(scoresLive[String(pl.id)] || {})[String(r)]
                          );
                          const teamEliminated = elimR != null;
                          return (
                            <li key={pl.id}>
                              <span className="team-card-player-line">
                                <TeamLogo url={pl.team_logo_url} title={pl.team_abbreviation || pl.team_name} />
                                <span className="player-name">{pl.name}</span>
                              </span>
                              <span className="player-meta">
                                {pl.position || '—'} · {pl.team_abbreviation || pl.team_name || '—'}
                                {pl.region && pl.region !== '—' ? (
                                  <>
                                    {' '}
                                    <span className={`draft-region-pill draft-region-pill--${regionSlug(pl.region)}`}>
                                      {pl.region}{pl.seed != null && pl.seed !== '—' ? ` (${pl.seed})` : ''}
                                    </span>
                                  </>
                                ) : null}
                              </span>
                              <div className="team-card-player-scores" aria-label="Points by tournament round">
                                {[1, 2, 3, 4, 5, 6].map((r) => {
                                  const raw = byRound[String(r)];
                                  const pts = Number(raw);
                                  const hasVal = raw != null && raw !== '' && !Number.isNaN(pts);
                                  const showX = elimR != null && r > elimR;
                                  const isLive =
                                    !showX &&
                                    hasVal &&
                                    !!(scoresLive[String(pl.id)] || {})[String(r)];
                                  const cellCls = [
                                    'team-card-score-cell',
                                    'leaderboard-round-num',
                                    showX ? 'leaderboard-round-out' : '',
                                    isLive ? 'leaderboard-round-live' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ');
                                  return (
                                    <span
                                      key={r}
                                      className={cellCls}
                                      title={showX ? 'Eliminated — no further games' : `Round ${r}`}
                                    >
                                      {showX ? '×' : (hasVal ? pts : '')}
                                    </span>
                                  );
                                })}
                                <span
                                  className={[
                                    'team-card-score-cell',
                                    'team-card-score-total',
                                    'leaderboard-total-col',
                                    teamEliminated ? 'leaderboard-round-out' : (totalIsLive ? 'leaderboard-round-live' : ''),
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {rowTotal}
                                </span>
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                  <div className="team-card-bracket-wrap">
                  <div className="team-card-bracket">
                    <div className="team-bracket-graphic">
                      <div className="team-bracket-left">
                        <div className={`team-bracket-quadrant team-bracket-quadrant--east`}>
                          <span className="team-bracket-label">East</span>
                          <span className="team-bracket-count">{regionCounts.East}</span>
                        </div>
                        <div className={`team-bracket-quadrant team-bracket-quadrant--south`}>
                          <span className="team-bracket-label">South</span>
                          <span className="team-bracket-count">{regionCounts.South}</span>
                        </div>
                      </div>
                      <div className="team-bracket-right">
                        <div className={`team-bracket-quadrant team-bracket-quadrant--west`}>
                          <span className="team-bracket-label">West</span>
                          <span className="team-bracket-count">{regionCounts.West}</span>
                        </div>
                        <div className={`team-bracket-quadrant team-bracket-quadrant--midwest`}>
                          <span className="team-bracket-label">Midwest</span>
                          <span className="team-bracket-count">{regionCounts.Midwest}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === TABS.leaderboard && (
        <div className="leaderboard-wrap">
          <div className="leaderboard-table-col">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Manager</th>
                  <th className="leaderboard-num">Pts</th>
                  <th className="leaderboard-num" title="Points Behind Leader">PBL</th>
                  <th className="leaderboard-num" title="Players Remaining">PR</th>
                  <th className="leaderboard-num" title="Max Games Remaining">MGR</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row, rankIdx) => (
                  <tr
                    key={row.managerIndex}
                    className={selectedLeaderboardManager === row.managerIndex ? 'selected' : ''}
                    onClick={() => setSelectedLeaderboardManager(row.managerIndex)}
                  >
                    <td>
                      <span className="leaderboard-manager-name">
                        {rankIdx === 0 ? <span className="leaderboard-trophy leaderboard-trophy--gold" title="1st place ($300)">🏆</span> : null}
                        {rankIdx === 1 ? <span className="leaderboard-trophy leaderboard-trophy--silver" title="2nd place ($100)">🏆</span> : null}
                        {row.name}
                      </span>
                    </td>
                    <td
                      className={[
                        'leaderboard-num',
                        row.hasLiveScores ? 'leaderboard-round-live' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {row.points}
                    </td>
                    <td className="leaderboard-num">
                      {row.pointsBehindLeader > 0 ? `-${row.pointsBehindLeader}` : ''}
                    </td>
                    <td className="leaderboard-num">{row.players}</td>
                    <td className="leaderboard-num">{row.maxGames}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="leaderboard-roster-col">
            {selectedLeaderboardManager == null ? (
              <p className="leaderboard-prompt">Select a manager to view roster</p>
            ) : (
              <div className="leaderboard-roster-card">
                <h3 className="leaderboard-roster-title">
                  {managers[selectedLeaderboardManager]} — Roster
                </h3>
                <table className="leaderboard-scoring-grid leaderboard-roster-scoring-grid">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="leaderboard-roster-logo-col" aria-label="Team logo" />
                      {[1, 2, 3, 4, 5, 6].map((r) => (
                        <th key={r} className="leaderboard-round-num">{r}</th>
                      ))}
                      <th className="leaderboard-total-col" title="Total">{isMobile ? 'T' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRosterPlayers.length === 0 ? (
                      <tr>
                        <td colSpan={NUM_ROUNDS + 3} className="leaderboard-empty">No players yet</td>
                      </tr>
                    ) : (
                      selectedRosterPlayers.map((pl) => {
                        const byRound = scores[String(pl.id)] || {};
                        const elimR = getTeamElimRound(pl, teamEliminatedAfterRound);
                        const total = [1, 2, 3, 4, 5, 6].reduce((s, r) => s + (Number(byRound[String(r)]) || 0), 0);
                        const totalIsLive = [1, 2, 3, 4, 5, 6].some(
                          (r) => !!(scoresLive[String(pl.id)] || {})[String(r)]
                        );
                        const teamEliminated = elimR != null;
                        return (
                          <tr key={pl.id}>
                            <td className="leaderboard-player-name">
                              {pl.name}
                              <span className="leaderboard-player-meta">
                                {pl.team_abbreviation || pl.team_name || '—'} · {pl.position || '—'}
                                {pl.region && pl.region !== '—' ? (
                                  <>
                                    {' '}
                                    <span className={`draft-region-pill draft-region-pill--${regionSlug(pl.region)}`}>
                                      {pl.region}{pl.seed != null && pl.seed !== '—' ? ` (${pl.seed})` : ''}
                                    </span>
                                  </>
                                ) : null}
                              </span>
                            </td>
                            <td className="leaderboard-roster-logo-col">
                              <TeamLogo url={pl.team_logo_url} title={pl.team_abbreviation || pl.team_name} />
                            </td>
                            {[1, 2, 3, 4, 5, 6].map((r) => {
                              const raw = byRound[String(r)];
                              const pts = Number(raw);
                              const hasVal = raw != null && raw !== '' && !Number.isNaN(pts);
                              const showX = elimR != null && r > elimR;
                              const isLive =
                                !showX &&
                                hasVal &&
                                !!(scoresLive[String(pl.id)] || {})[String(r)];
                              const cellCls = [
                                'leaderboard-round-num',
                                showX ? 'leaderboard-round-out' : '',
                                isLive ? 'leaderboard-round-live' : '',
                              ]
                                .filter(Boolean)
                                .join(' ');
                              return (
                                <td
                                  key={r}
                                  className={cellCls}
                                  title={showX ? 'Eliminated — no further games' : undefined}
                                >
                                  {showX ? '×' : (hasVal ? pts : '')}
                                </td>
                              );
                            })}
                            <td
                              className={[
                                'leaderboard-total-col',
                                teamEliminated ? 'leaderboard-round-out' : (totalIsLive ? 'leaderboard-round-live' : ''),
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {total}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {selectedRosterPlayers.length > 0 && (() => {
                      const roundSums = [1, 2, 3, 4, 5, 6].map((r) =>
                        selectedRosterPlayers.reduce((s, pl) => s + (Number((scores[String(pl.id)] || {})[String(r)]) || 0), 0)
                      );
                      const roundHasLive = [1, 2, 3, 4, 5, 6].map((r) =>
                        selectedRosterPlayers.some((pl) => !!(scoresLive[String(pl.id)] || {})[String(r)])
                      );
                      const rosterTotal = roundSums.reduce((a, b) => a + b, 0);
                      const totalHasLive = roundHasLive.some(Boolean);
                      return (
                        <tr className="leaderboard-totals-row">
                          <td>Total</td>
                          <td className="leaderboard-roster-logo-col" />
                          {roundSums.map((n, i) => (
                            <td
                              key={i}
                              className={[
                                'leaderboard-round-num',
                                roundHasLive[i] ? 'leaderboard-round-live' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {n}
                            </td>
                          ))}
                          <td
                            className={[
                              'leaderboard-total-col',
                              totalHasLive ? 'leaderboard-round-live' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {rosterTotal}
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === TABS.players && (
        <div className="players-grid-wrap">
          <table className="leaderboard-scoring-grid players-grid-table">
            <thead>
              <tr>
                <th className="players-grid-col-player">Player</th>
                <th className="players-grid-col-team">Team</th>
                <th className="players-grid-col-pos">Pos</th>
                <th className="players-grid-col-region">Region</th>
                <th className="players-grid-col-seed leaderboard-num">Seed</th>
                <th className="players-grid-col-manager">Manager</th>
                {[1, 2, 3, 4, 5, 6].map((r) => (
                  <th key={r} className="leaderboard-round-num">{r}</th>
                ))}
                <th className="leaderboard-total-col" title="Total">{isMobile ? 'T' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {playersGridRows.length === 0 ? (
                <tr>
                  <td colSpan={6 + NUM_ROUNDS + 1} className="leaderboard-empty">
                    No drafted players yet
                  </td>
                </tr>
              ) : (
                <>
                  {playersGridRows.map(({ pl, managerName }) => {
                    const byRound = scores[String(pl.id)] || {};
                    const elimR = getTeamElimRound(pl, teamEliminatedAfterRound);
                    const rowTotal = [1, 2, 3, 4, 5, 6].reduce(
                      (s, r) => s + (Number(byRound[String(r)]) || 0),
                      0
                    );
                    const totalIsLive = [1, 2, 3, 4, 5, 6].some(
                      (r) => !!(scoresLive[String(pl.id)] || {})[String(r)]
                    );
                    const teamEliminated = elimR != null;
                    return (
                      <tr key={pl.id} className="players-grid-data-row">
                        <td className="leaderboard-player-name players-grid-col-player">{pl.name}</td>
                        <td className="players-grid-col-team">
                          <TeamLabel
                            logoUrl={pl.team_logo_url}
                            text={pl.team_abbreviation || pl.team_name || '—'}
                          />
                        </td>
                        <td className="players-grid-col-pos">{pl.position || '—'}</td>
                        <td className="players-grid-col-region">
                          {pl.region && pl.region !== '—' ? (
                            <span className={`draft-region-pill draft-region-pill--${regionSlug(pl.region)}`}>
                              {pl.region}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="leaderboard-num players-grid-col-seed">
                          {pl.seed != null && pl.seed !== '' && pl.seed !== '—' ? pl.seed : '—'}
                        </td>
                        <td className="players-grid-col-manager">{managerName}</td>
                        {[1, 2, 3, 4, 5, 6].map((r) => {
                          const raw = byRound[String(r)];
                          const pts = Number(raw);
                          const hasVal = raw != null && raw !== '' && !Number.isNaN(pts);
                          const showX = elimR != null && r > elimR;
                          const isLive =
                            !showX &&
                            hasVal &&
                            !!(scoresLive[String(pl.id)] || {})[String(r)];
                          const cellCls = [
                            'leaderboard-round-num',
                            showX ? 'leaderboard-round-out' : '',
                            isLive ? 'leaderboard-round-live' : '',
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return (
                            <td
                              key={r}
                              className={cellCls}
                              title={showX ? 'Eliminated — no further games' : undefined}
                            >
                              {showX ? '×' : (hasVal ? pts : '')}
                            </td>
                          );
                        })}
                        <td
                          className={[
                            'leaderboard-total-col',
                            teamEliminated ? 'leaderboard-round-out' : (totalIsLive ? 'leaderboard-round-live' : ''),
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {rowTotal}
                        </td>
                      </tr>
                    );
                  })}
                  {(() => {
                    const roster = playersGridRows.map((x) => x.pl);
                    const roundSums = [1, 2, 3, 4, 5, 6].map((r) =>
                      roster.reduce((s, pl) => s + (Number((scores[String(pl.id)] || {})[String(r)]) || 0), 0)
                    );
                    const roundHasLive = [1, 2, 3, 4, 5, 6].map((r) =>
                      roster.some((pl) => !!(scoresLive[String(pl.id)] || {})[String(r)])
                    );
                    const grandTotal = roundSums.reduce((a, b) => a + b, 0);
                    const totalHasLive = roundHasLive.some(Boolean);
                    return (
                      <tr className="leaderboard-totals-row">
                        <td colSpan={6}>Total</td>
                        {roundSums.map((n, i) => (
                          <td
                            key={i}
                            className={[
                              'leaderboard-round-num',
                              roundHasLive[i] ? 'leaderboard-round-live' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            >
                            {n}
                          </td>
                        ))}
                        <td
                          className={[
                            'leaderboard-total-col',
                            totalHasLive ? 'leaderboard-round-live' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {grandTotal}
                        </td>
                      </tr>
                    );
                  })()}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === TABS.pastResults && (
        <div className="past-results-wrap">
          <div className="past-results-columns">
            <div className="past-results-col past-results-col--history">
              <div className="past-results-table-wrap">
                <table className="past-results-table leaderboard-table">
                  <thead>
                    <tr>
                      <th colSpan={3} className="past-results-table-title" scope="colgroup">
                        Finishes by year
                      </th>
                    </tr>
                    <tr>
                      <th scope="col">Year</th>
                      <th scope="col">1st</th>
                      <th scope="col">2nd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLAYER_POOL_PAST_RESULTS.map((row) => (
                      <tr key={row.year}>
                        <td>{row.year}</td>
                        {row.note ? (
                          <td colSpan={2} className="past-results-note">
                            {row.note}
                          </td>
                        ) : (
                          <>
                            <td>{row.first}</td>
                            <td>{row.second}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="past-results-col past-results-col--trophy">
              <div className="past-results-table-wrap">
                <table className="past-results-table past-results-table--trophy leaderboard-table">
                  <thead>
                    <tr>
                      <th colSpan={4} className="past-results-table-title" scope="colgroup">
                        Trophy case
                      </th>
                    </tr>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col" className="past-results-col-trophies">Wins</th>
                      <th scope="col" className="past-results-col-trophies">2nds</th>
                      <th scope="col" className="past-results-col-money">Winnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trophyCaseRows.map((r) => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td className="past-results-trophy-cell">
                          {r.wins > 0
                            ? Array.from({ length: r.wins }, (_, i) => (
                              <span
                                key={i}
                                className="leaderboard-trophy leaderboard-trophy--gold"
                                title={`1st place ($${PLAYER_POOL_FIRST_PRIZE_USD})`}
                              >
                                🏆
                              </span>
                            ))
                            : '—'}
                        </td>
                        <td className="past-results-trophy-cell">
                          {r.seconds > 0
                            ? Array.from({ length: r.seconds }, (_, i) => (
                              <span
                                key={i}
                                className="leaderboard-trophy leaderboard-trophy--silver"
                                title={`2nd place ($${PLAYER_POOL_SECOND_PRIZE_USD})`}
                              >
                                🏆
                              </span>
                            ))
                            : '—'}
                        </td>
                        <td className="past-results-col-money">{pastResultsMoney.format(r.winnings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
