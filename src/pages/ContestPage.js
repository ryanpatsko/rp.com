import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule } from 'ag-grid-community';
import { AgGridProvider } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import * as contestApi from '../contestApi';
import './Contests.css';

const TABS = { draft: 'draft', teams: 'teams', leaderboard: 'leaderboard' };
const NUM_ROUNDS = 6;

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

const seedComparator = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na)) return Number.isNaN(nb) ? 0 : 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb;
};

const DRAFT_COLUMN_DEFS = [
  { field: 'name', headerName: 'Name', sortable: true, minWidth: 165 },
  { field: 'team', headerName: 'Team', sortable: true },
  { field: 'position', headerName: 'Pos', sortable: true },
  { field: 'region', headerName: 'Region', sortable: true },
  { field: 'seed', headerName: 'Seed', sortable: true, comparator: seedComparator },
  { field: 'ppg', headerName: 'PPG', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'gs', headerName: 'GS', sortable: true, ...rightAlign },
  { field: 'mpg', headerName: 'MPG', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
];

const DRAFT_COLUMN_DEFS_MOBILE = [
  {
    field: 'name',
    headerName: 'Player',
    sortable: true,
    minWidth: 127,
    flex: 1,
    cellRenderer: (params) => {
      const d = params.data;
      if (!d) return null;
      return (
        <div className="draft-player-cell">
          <span className="draft-player-name">{d.name}</span>
          <span className="draft-player-meta">
            {d.team} · {d.position} · {d.region} · {d.seed}
          </span>
        </div>
      );
    },
  },
  { field: 'ppg', headerName: 'PPG', sortable: true, width: 84, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'gs', headerName: 'GS', sortable: true, width: 54, ...rightAlign },
  { field: 'mpg', headerName: 'MPG', sortable: true, width: 80, minWidth: 80, valueFormatter: formatOneDecimal, ...rightAlign },
];

const MOBILE_BREAKPOINT_PX = 768;

export default function ContestPage() {
  const { contestId } = useParams();
  const [tab, setTab] = useState(TABS.draft);
  const [selectedLeaderboardManager, setSelectedLeaderboardManager] = useState(null);
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState([]);
  const [playerPool, setPlayerPool] = useState([]);
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX);

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
        contestApi.getScores(contestId).catch(() => ({ scores: {} })),
      ]);
      setConfig(c);
      setDraft(Array.isArray(d) ? d : []);
      setPlayerPool(Array.isArray(p) ? p : []);
      setScores(scoresRes?.scores ?? {});
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
    if (tab !== TABS.draft) return;
    const numTeams = (config?.draftOrder?.length || config?.manager_names?.length || config?.managerNames?.length) || 8;
    const picksCount = (draft ?? []).length;
    if (picksCount >= numTeams * 8) return; // draft complete: no auto-refresh
    const interval = setInterval(load, 10 * 1000);
    return () => clearInterval(interval);
  }, [tab, load, config?.draftOrder?.length, config?.manager_names?.length, config?.managerNames?.length, (draft ?? []).length]);

  const [filterTeam, setFilterTeam] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterSeed, setFilterSeed] = useState('');
  const [hideDrafted, setHideDrafted] = useState(true);

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
      if (hideDrafted && pl.drafted) return false;
      if (filterTeam && (pl.team_abbreviation || pl.team_name) !== filterTeam) return false;
      if (filterRegion && (pl.region ?? '') !== filterRegion) return false;
      if (filterSeed && String(pl.seed ?? '') !== filterSeed) return false;
      return true;
    });
    const seedNum = (v) => { const n = Number(v); return Number.isNaN(n) ? 99 : n; };
    const sorted = [...filtered].sort((a, b) => seedNum(a.seed) - seedNum(b.seed) || (b.pts_per_game ?? 0) - (a.pts_per_game ?? 0));
    return sorted.map((pl) => {
      const region = pl.region ?? '—';
      const seed = pl.seed ?? '—';
      return {
        id: pl.id,
        name: pl.name,
        team: pl.team_abbreviation || pl.team_name || '—',
        position: pl.position || '—',
        region,
        seed,
        regionSeed: `${region} ${seed}`.trim() || '—',
        ppg: pl.pts_per_game,
        gs: pl.games_started ?? pl.games_played ?? '—',
        mpg: pl.min_per_game ?? '—',
        _drafted: pl.drafted,
      };
    });
  }, [poolWithDrafted, managers, filterTeam, filterRegion, filterSeed, hideDrafted]);

  const filterOptions = useMemo(() => {
    const withPpg = poolWithDrafted.filter((pl) => pl.pts_per_game != null);
    const teams = [...new Set(withPpg.map((pl) => pl.team_abbreviation || pl.team_name || '').filter(Boolean))].sort();
    const regions = [...new Set(withPpg.map((pl) => pl.region ?? '').filter((r) => r !== ''))].sort();
    const seeds = [...new Set(withPpg.map((pl) => String(pl.seed ?? '')).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    return { teams, regions, seeds };
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
      const playerMeta = `${team} · ${position} · ${region} · ${seed}`;
      return {
        key: i,
        label: `${round}.${pickInRound}`,
        managerName: managers[midx] ?? `Manager ${midx}`,
        playerName: player?.name ?? `ID ${pid}`,
        playerMeta,
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
    const rows = (managers || []).map((name, idx) => {
      const picks = byManager[idx] || [];
      const playerCount = picks.length;
      const points = picks.reduce((sum, p) => sum + playerTotal(p.playerId ?? p.player_id), 0);
      const maxGames = playerCount * NUM_ROUNDS;
      return {
        managerIndex: idx,
        name,
        points,
        players: playerCount,
        maxGames,
      };
    });
    return [...rows].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  }, [managers, draft, scores]);

  useEffect(() => {
    if (tab === TABS.leaderboard && managers?.length > 0) {
      if (selectedLeaderboardManager == null || selectedLeaderboardManager >= managers.length) {
        setSelectedLeaderboardManager(0);
      }
    }
  }, [tab, managers, selectedLeaderboardManager]);

  const selectedRosterPlayers = useMemo(() => {
    if (selectedLeaderboardManager == null) return [];
    const picks = picksByManager[selectedLeaderboardManager] || [];
    return picks
      .map((p) => getPlayerById(p.playerId ?? p.player_id))
      .filter(Boolean);
  }, [selectedLeaderboardManager, picksByManager, playerPool]);

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
                <select
                  value={filterRegion}
                  onChange={(e) => setFilterRegion(e.target.value)}
                  className="draft-filter-select"
                  aria-label="Filter by region"
                >
                  <option value="">All Regions</option>
                  {filterOptions.regions.map((r) => (
                    <option key={r} value={r}>{r || '—'}</option>
                  ))}
                </select>
                <select
                  value={filterSeed}
                  onChange={(e) => setFilterSeed(e.target.value)}
                  className="draft-filter-select"
                  aria-label="Filter by seed"
                >
                  <option value="">All Seeds</option>
                  {filterOptions.seeds.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <label className="draft-filter-toggle-label">
                  <input
                    type="checkbox"
                    className="draft-filter-toggle"
                    checked={hideDrafted}
                    onChange={(e) => setHideDrafted(e.target.checked)}
                  />
                  <span className="draft-filter-toggle-slider" />
                  Hide drafted players
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
                        initialState={{ sort: { sortModel: [{ colId: 'seed', sort: 'asc' }, { colId: 'ppg', sort: 'desc' }] } }}
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
                          {item.playerMeta && (
                            <span className="admin-pick-history-player-meta">{item.playerMeta}</span>
                          )}
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
            return (
              <div key={idx} className="team-card">
                <h3>{name}</h3>
                <ul>
                  {players.length === 0 ? (
                    <li className="player-meta">No picks yet</li>
                  ) : (
                    players.map((pl) => (
                      <li key={pl.id}>
                        <span className="player-name">{pl.name}</span>
                        <span className="player-meta">
                          {pl.position || '—'} — {pl.team_abbreviation || pl.team_name} ({pl.seed ?? '—'})
                        </span>
                      </li>
                    ))
                  )}
                </ul>
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
                  <th className="leaderboard-num">Points</th>
                  <th className="leaderboard-num">Players</th>
                  <th className="leaderboard-num">Max Games</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row) => (
                  <tr
                    key={row.managerIndex}
                    className={selectedLeaderboardManager === row.managerIndex ? 'selected' : ''}
                    onClick={() => setSelectedLeaderboardManager(row.managerIndex)}
                  >
                    <td>{row.name}</td>
                    <td className="leaderboard-num">{row.points}</td>
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
                <table className="leaderboard-scoring-grid">
                  <thead>
                    <tr>
                      <th>Player</th>
                      {[1, 2, 3, 4, 5, 6].map((r) => (
                        <th key={r} className="leaderboard-round-num">{r}</th>
                      ))}
                      <th className="leaderboard-total-col" title="Total">{isMobile ? 'T' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRosterPlayers.length === 0 ? (
                      <tr>
                        <td colSpan={NUM_ROUNDS + 2} className="leaderboard-empty">No players yet</td>
                      </tr>
                    ) : (
                      selectedRosterPlayers.map((pl) => {
                        const byRound = scores[String(pl.id)] || {};
                        const roundPts = [1, 2, 3, 4, 5, 6].map((r) => Number(byRound[String(r)]) || 0);
                        const total = roundPts.reduce((s, n) => s + n, 0);
                        return (
                          <tr key={pl.id}>
                            <td className="leaderboard-player-name">
                              {pl.name}
                              <span className="leaderboard-player-meta">
                                {pl.team_abbreviation || pl.team_name} · {pl.position || '—'}
                              </span>
                            </td>
                            {roundPts.map((pts, i) => (
                              <td key={i} className="leaderboard-round-num">{pts || ''}</td>
                            ))}
                            <td className="leaderboard-total-col">{total || ''}</td>
                          </tr>
                        );
                      })
                    )}
                    {selectedRosterPlayers.length > 0 && (() => {
                      const roundSums = [1, 2, 3, 4, 5, 6].map((r) =>
                        selectedRosterPlayers.reduce((s, pl) => s + (Number((scores[String(pl.id)] || {})[String(r)]) || 0), 0)
                      );
                      const rosterTotal = roundSums.reduce((a, b) => a + b, 0);
                      return (
                        <tr className="leaderboard-totals-row">
                          <td>Total</td>
                          {roundSums.map((n, i) => (
                            <td key={i} className="leaderboard-round-num">{n || ''}</td>
                          ))}
                          <td className="leaderboard-total-col">{rosterTotal || ''}</td>
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
    </div>
  );
}
