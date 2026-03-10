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

const DRAFT_GRID_HEIGHT = '60vh';
const formatOneDecimal = (params) => {
  const v = params.value;
  if (v != null && typeof v === 'number' && !Number.isNaN(v)) return v.toFixed(1);
  return v ?? '—';
};

const rightAlign = { cellStyle: { textAlign: 'right' }, headerClass: 'draft-col-right' };

const DRAFT_COLUMN_DEFS = [
  { field: 'name', headerName: 'Name', sortable: true, minWidth: 165 },
  { field: 'team', headerName: 'Team', sortable: true },
  { field: 'position', headerName: 'Pos', sortable: true },
  { field: 'region', headerName: 'Region', sortable: true },
  { field: 'seed', headerName: 'Seed', sortable: true },
  { field: 'ppg', headerName: 'PPG', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'gs', headerName: 'GS', sortable: true, ...rightAlign },
  { field: 'mpg', headerName: 'MPG', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
  { field: 'status', headerName: 'Status', sortable: true },
];

export default function ContestPage() {
  const { contestId } = useParams();
  const [tab, setTab] = useState(TABS.draft);
  const [selectedLeaderboardManager, setSelectedLeaderboardManager] = useState(null);
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState([]);
  const [playerPool, setPlayerPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, d, p] = await Promise.all([
        contestApi.getConfig(contestId),
        contestApi.getDraft(contestId),
        contestApi.getPlayerPool(contestId),
      ]);
      setConfig(c);
      setDraft(Array.isArray(d) ? d : []);
      setPlayerPool(Array.isArray(p) ? p : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    load();
  }, [load]);

  const [filterTeam, setFilterTeam] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterSeed, setFilterSeed] = useState('');

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
      if (filterTeam && (pl.team_abbreviation || pl.team_name) !== filterTeam) return false;
      if (filterRegion && (pl.region ?? '') !== filterRegion) return false;
      if (filterSeed && String(pl.seed ?? '') !== filterSeed) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => (b.pts_per_game ?? 0) - (a.pts_per_game ?? 0));
    return sorted.map((pl) => ({
      id: pl.id,
      name: pl.name,
      team: pl.team_abbreviation || pl.team_name || '—',
      position: pl.position || '—',
      region: pl.region ?? '—',
      seed: pl.seed ?? '—',
      ppg: pl.pts_per_game,
      gs: pl.games_started ?? pl.games_played ?? '—',
      mpg: pl.min_per_game ?? '—',
      status: pl.drafted
        ? (managers[pl.pickedBy] ? `Drafted by ${managers[pl.pickedBy]}` : 'Drafted')
        : 'Available',
      _drafted: pl.drafted,
    }));
  }, [poolWithDrafted, managers, filterTeam, filterRegion, filterSeed]);

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

  const leaderboardRows = useMemo(() => {
    const byManager = (draft || []).reduce((acc, p) => {
      const i = p.managerIndex ?? p.manager_index ?? 0;
      if (!acc[i]) acc[i] = [];
      acc[i].push(p);
      return acc;
    }, {});
    return (managers || []).map((name, idx) => {
      const picks = byManager[idx] || [];
      return {
        managerIndex: idx,
        name,
        points: 0,
        playersRemaining: 8 - picks.length,
      };
    });
  }, [managers, draft]);

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
              <div className="draft-board-filters">
                <label>
                  Team
                  <select
                    value={filterTeam}
                    onChange={(e) => setFilterTeam(e.target.value)}
                    className="draft-filter-select"
                  >
                    <option value="">All</option>
                    {filterOptions.teams.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Region
                  <select
                    value={filterRegion}
                    onChange={(e) => setFilterRegion(e.target.value)}
                    className="draft-filter-select"
                  >
                    <option value="">All</option>
                    {filterOptions.regions.map((r) => (
                      <option key={r} value={r}>{r || '—'}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Seed
                  <select
                    value={filterSeed}
                    onChange={(e) => setFilterSeed(e.target.value)}
                    className="draft-filter-select"
                  >
                    <option value="">All</option>
                    {filterOptions.seeds.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <AgGridProvider modules={[AllCommunityModule]}>
                <div className="ag-theme-quartz-dark draft-board-grid" style={{ height: DRAFT_GRID_HEIGHT, width: '100%' }}>
                  <AgGridReact
                    rowData={draftBoardRows}
                    columnDefs={DRAFT_COLUMN_DEFS}
                    defaultColDef={{ sortable: true }}
                    initialState={{ sort: { sortModel: [{ colId: 'ppg', sort: 'desc' }] } }}
                    getRowId={(params) => String(params.data.id)}
                    getRowClass={(params) => (params.data?._drafted ? 'draft-row-drafted' : '')}
                    suppressColumnMenu
                    onGridReady={(e) => e.api.sizeColumnsToFit()}
                    onFirstDataRendered={(e) => e.api.sizeColumnsToFit()}
                  />
                </div>
              </AgGridProvider>
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
                          {pl.team_abbreviation || pl.team_name} · {pl.position || '—'}
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
                  <th className="leaderboard-num">Players left</th>
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
                    <td className="leaderboard-num">{row.playersRemaining}</td>
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
                      <th className="leaderboard-total-col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRosterPlayers.length === 0 ? (
                      <tr>
                        <td colSpan={NUM_ROUNDS + 2} className="leaderboard-empty">No players yet</td>
                      </tr>
                    ) : (
                      selectedRosterPlayers.map((pl) => (
                        <tr key={pl.id}>
                          <td className="leaderboard-player-name">
                            {pl.name}
                            <span className="leaderboard-player-meta">
                              {pl.team_abbreviation || pl.team_name} · {pl.position || '—'}
                            </span>
                          </td>
                          {[1, 2, 3, 4, 5, 6].map((r) => (
                            <td key={r} className="leaderboard-round-num" />
                          ))}
                          <td className="leaderboard-total-col" />
                        </tr>
                      ))
                    )}
                    {selectedRosterPlayers.length > 0 && (
                      <tr className="leaderboard-totals-row">
                        <td />
                        {[1, 2, 3, 4, 5, 6].map((r) => (
                          <td key={r} className="leaderboard-round-num" />
                        ))}
                        <td className="leaderboard-total-col" />
                      </tr>
                    )}
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
