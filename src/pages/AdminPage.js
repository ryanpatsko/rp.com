import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule } from 'ag-grid-community';
import { AgGridProvider } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import * as contestApi from '../contestApi';
import './Contests.css';

const ADMIN_GRID_HEIGHT = '50vh';

function getNextManagerIndex(pickNumber1Based, numTeams = 8) {
  const round = Math.floor((pickNumber1Based - 1) / numTeams);
  const pickInRound = (pickNumber1Based - 1) % numTeams;
  return round % 2 === 0 ? pickInRound : numTeams - 1 - pickInRound;
}

const formatOneDecimal = (params) => {
  const v = params.value;
  if (v != null && typeof v === 'number' && !Number.isNaN(v)) return v.toFixed(1);
  return v ?? '—';
};

const rightAlign = { cellStyle: { textAlign: 'right' }, headerClass: 'draft-col-right' };

export default function AdminPage() {
  const { contestId } = useParams();
  const navigate = useNavigate();
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState([]);
  const [playerPool, setPlayerPool] = useState([]);
  const [selectedManagerIndex, setSelectedManagerIndex] = useState(0);
  const [importing, setImporting] = useState(false);
  const [initializingDraft, setInitializingDraft] = useState(false);
  const [draftingPlayerId, setDraftingPlayerId] = useState(null);
  const [deletingLastPick, setDeletingLastPick] = useState(false);
  const [resettingDraft, setResettingDraft] = useState(false);
  const [error, setError] = useState(null);
  const selectedManagerIndexRef = useRef(0);

  useEffect(() => {
    selectedManagerIndexRef.current = selectedManagerIndex;
  }, [selectedManagerIndex]);

  useEffect(() => {
    let cancelled = false;
    const token = contestApi.getStoredAdminToken(contestId);
    if (!token) {
      navigate('/contests', { replace: true });
      return;
    }
    contestApi.adminVerify(contestId, token).then((ok) => {
      if (cancelled) return;
      setChecking(false);
      if (!ok) {
        contestApi.setStoredAdminToken(contestId, null);
        navigate('/contests', { replace: true });
      } else {
        setVerified(true);
      }
    }).catch(() => {
      if (cancelled) return;
      setChecking(false);
      navigate('/contests', { replace: true });
    });
    return () => { cancelled = true; };
  }, [contestId, navigate]);

  const load = useCallback(async () => {
    if (!contestId || !verified) return;
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
    }
  }, [contestId, verified]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const numTeams = config?.numTeams ?? 8;
    const next = getNextManagerIndex((draft?.length ?? 0) + 1, numTeams);
    setSelectedManagerIndex(next);
  }, [config?.numTeams, draft?.length]);

  const runImport = async () => {
    setError(null);
    setImporting(true);
    try {
      await contestApi.runImport(contestId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const runInitDraftOrder = async () => {
    setError(null);
    setInitializingDraft(true);
    try {
      await contestApi.initDraftOrder(contestId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setInitializingDraft(false);
    }
  };

  const handleDraftPlayer = async (playerId) => {
    const managerIndex = selectedManagerIndexRef.current;
    setError(null);
    setDraftingPlayerId(playerId);
    try {
      const res = await contestApi.addDraftPick(contestId, managerIndex, playerId);
      if (res.draft) setDraft(res.draft);
      else await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDraftingPlayerId(null);
    }
  };

  const deleteLastPick = async () => {
    if (!draft?.length) return;
    setError(null);
    setDeletingLastPick(true);
    try {
      const updated = draft.slice(0, -1);
      await contestApi.putDraft(contestId, updated);
      setDraft(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingLastPick(false);
    }
  };

  const resetDraft = async () => {
    if (!window.confirm('Reset draft? This will clear all picks and remove the draft order. You can run "Initialize draft order" again to start over.')) return;
    setError(null);
    setResettingDraft(true);
    try {
      const res = await contestApi.resetDraft(contestId);
      setConfig(res.config);
      setDraft([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setResettingDraft(false);
    }
  };

  const draftOrder = config?.draftOrder || config?.manager_names || config?.managerNames || [];
  const numTeams = config?.numTeams ?? 8;
  const nextPickNumber = (draft?.length ?? 0) + 1;
  const nextManagerIndex = getNextManagerIndex(nextPickNumber, numTeams);
  const nextRound = Math.floor((nextPickNumber - 1) / numTeams) + 1;
  const nextPickInRound = (nextPickNumber - 1) % numTeams + 1;
  const pickLabel = `Pick ${nextRound}.${nextPickInRound}`;
  const draftedPlayerIds = new Set((draft || []).map((p) => p.playerId ?? p.player_id));

  const playerIdToName = useMemo(() => {
    const map = new Map();
    (playerPool || []).forEach((p) => map.set(p.id, p.name || '—'));
    return map;
  }, [playerPool]);

  const pickHistoryList = useMemo(() => {
    const list = (draft || []).map((pick, i) => {
      const pickNum = i + 1;
      const round = Math.floor((pickNum - 1) / numTeams) + 1;
      const pickInRound = (pickNum - 1) % numTeams + 1;
      const midx = pick.managerIndex ?? pick.manager_index;
      const pid = pick.playerId ?? pick.player_id;
      return {
        key: i,
        label: `${round}.${pickInRound}`,
        managerName: draftOrder[midx] ?? `Manager ${midx}`,
        playerName: playerIdToName.get(pid) ?? `ID ${pid}`,
      };
    });
    return list;
  }, [draft, numTeams, draftOrder, playerIdToName]);

  const adminGridRows = useMemo(() => {
    const withPpg = (playerPool || []).filter((pl) => pl.pts_per_game != null);
    const sorted = [...withPpg].sort((a, b) => (b.pts_per_game ?? 0) - (a.pts_per_game ?? 0));
    return sorted.map((pl) => ({
      id: pl.id,
      name: pl.name,
      team: pl.team_abbreviation || pl.team_name || '—',
      position: pl.position || '—',
      region: pl.region ?? '—',
      seed: pl.seed ?? '—',
      ppg: pl.pts_per_game,
      drafted: draftedPlayerIds.has(pl.id),
    }));
  }, [playerPool, draftedPlayerIds]);

  const adminColumnDefs = useMemo(() => [
    { field: 'name', headerName: 'Name', sortable: true, minWidth: 165 },
    { field: 'team', headerName: 'Team', sortable: true },
    { field: 'position', headerName: 'Pos', sortable: true },
    { field: 'region', headerName: 'Region', sortable: true },
    { field: 'seed', headerName: 'Seed', sortable: true },
    { field: 'ppg', headerName: 'PPG', sortable: true, valueFormatter: formatOneDecimal, ...rightAlign },
    {
      field: 'draft',
      headerName: 'Draft',
      sortable: false,
      cellRenderer: (params) => {
        const drafted = params.data?.drafted;
        const id = params.data?.id;
        if (drafted) return 'Drafted';
        return (
          <button
            type="button"
            className="admin-draft-btn"
            disabled={draftingPlayerId === id}
            onClick={() => handleDraftPlayer(id)}
          >
            {draftingPlayerId === id ? '…' : 'Draft'}
          </button>
        );
      },
    },
  ], [draftingPlayerId]);

  if (checking || !verified) {
    return (
      <div className="contests-page">
        <div className="contests-loading">Checking access…</div>
      </div>
    );
  }

  const year = contestId.replace(/-.*$/, '');
  const hasDraftOrder = config?.draftOrder && config.draftOrder.length >= numTeams;

  return (
    <div className="contests-page">
      <header className="contests-header">
        <Link to="/contests" className="contests-back">← Contests</Link>
        <h1>{year} March Madness Player Pool — Admin</h1>
      </header>

      <div className="import-actions">
        <button type="button" onClick={runImport} disabled={importing}>
          {importing ? 'Importing…' : 'Import players from BallDontLie'}
        </button>
        {!hasDraftOrder && (
          <button type="button" onClick={runInitDraftOrder} disabled={initializingDraft} className="admin-init-draft-btn">
            {initializingDraft ? 'Initializing…' : 'Initialize draft order (random 1–8)'}
          </button>
        )}
      </div>
      {error && <div className="contests-error">{error}</div>}

      {hasDraftOrder && (
        <>
          <div className="admin-draft-controls">
            <label>
              Draft to manager:
              <select
                value={selectedManagerIndex}
                onChange={(e) => setSelectedManagerIndex(Number(e.target.value))}
                className="admin-manager-select"
              >
                {draftOrder.map((name, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {name}{i === nextManagerIndex ? ' (next pick)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <span className="admin-pick-number">{pickLabel}</span>
            <button
              type="button"
              className="admin-reset-draft-btn"
              disabled={resettingDraft}
              onClick={resetDraft}
            >
              {resettingDraft ? 'Resetting…' : 'Reset draft'}
            </button>
          </div>

          <div className="admin-draft-layout">
            <div className="admin-draft-grid-wrap">
              <AgGridProvider modules={[AllCommunityModule]}>
                <div className="ag-theme-quartz-dark admin-draft-grid" style={{ height: ADMIN_GRID_HEIGHT, width: '100%' }}>
                  <AgGridReact
                    key={`admin-grid-${draft?.length ?? 0}`}
                    rowData={adminGridRows}
                    columnDefs={adminColumnDefs}
                    defaultColDef={{ sortable: true }}
                    getRowId={(params) => String(params.data.id)}
                    getRowClass={(params) => (params.data?.drafted ? 'draft-row-drafted' : '')}
                    suppressColumnMenu
                    onGridReady={(e) => e.api.sizeColumnsToFit()}
                    onFirstDataRendered={(e) => e.api.sizeColumnsToFit()}
                  />
                </div>
              </AgGridProvider>
            </div>

            <div className="admin-pick-history">
              <div className="admin-pick-history-header">
                <h3>Pick history</h3>
                <button
                  type="button"
                  className="admin-delete-last-pick-btn"
                  disabled={!draft?.length || deletingLastPick}
                  onClick={deleteLastPick}
                >
                  {deletingLastPick ? '…' : 'Delete last pick'}
                </button>
              </div>
              <ul className="admin-pick-history-list">
                {pickHistoryList.length === 0 ? (
                  <li className="admin-pick-history-empty">No picks yet</li>
                ) : (
                  pickHistoryList.map((item) => (
                    <li key={item.key} className="admin-pick-history-item">
                      <span className="admin-pick-history-pick">{item.label}</span>
                      <span className="admin-pick-history-manager">{item.managerName}</span>
                      <span className="admin-pick-history-player">{item.playerName}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </>
      )}

      <p className="contests-admin-hint">
        <Link to={`/contests/pp/${contestId}`}>View draft board &amp; teams</Link>
      </p>
    </div>
  );
}
