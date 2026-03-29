import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useParams } from 'react-router-dom';
import * as contestApi from '../contestApi';
import { RegionPill } from '../RegionPill';
import {
  BLOCK_POOL_YEAR,
  BLOCK_POOL_CONTEST_ID,
  WINNING_DIGITS_BY_ROUND,
  LOSING_DIGITS_BY_ROUND,
  BLOCK_ENTRIES,
  getBlockPayoutLinesForGame,
} from '../data/blockPool2026';
import './Contests.css';

const TABS = { blocks: 'blocks', winners: 'winners' };
const WINNERS_SUBVIEWS = { games: 'games', payouts: 'payouts' };

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** R6 → R1: row 0 / col 0 = R6, … row 5 / col 5 = R1 */
const ROUND_ORDER = [6, 5, 4, 3, 2, 1];

/** Top: 1 banner row + 6 rows (diagonal matrix + winning digits) = 7 rows */
const TOP_ROW_COUNT = 7;
/** First grid row for losing digits + names (line after top section) */
const BOTTOM_ROW_START = TOP_ROW_COUNT + 1;

/**
 * Diagonal: R6…R1 on (i,i). Above diagonal (row < col): winning-row gradients (-row).
 * Below diagonal (row > col): losing-column gradients (-col).
 */
function diagonalCellClass(row, col) {
  if (row === col) {
    const round = ROUND_ORDER[row];
    return `block-pool-round-diag-cell block-pool-diag--label block-pool-tone-r${round}-label`;
  }
  const round = row < col ? ROUND_ORDER[row] : ROUND_ORDER[col];
  const stripe = row < col ? `block-pool-tone-r${round}-row` : `block-pool-tone-r${round}-col`;
  return `block-pool-round-diag-cell block-pool-diag--fill ${stripe}`;
}

export default function BlockPoolPage() {
  const { year } = useParams();
  const [tab, setTab] = useState(TABS.blocks);
  /** Hover crosshair on the 10×10 name grid: traces winning (col) + losing (row) digits. */
  const [crosshair, setCrosshair] = useState(null);
  const [bracketFinal, setBracketFinal] = useState([]);
  const [bracketLoading, setBracketLoading] = useState(true);
  const [bracketError, setBracketError] = useState(null);
  const [winnersSubView, setWinnersSubView] = useState(WINNERS_SUBVIEWS.games);
  /** Blocks tab: custom tooltip anchored to the clicked name cell (opens on tap/click only). */
  const [blockTooltip, setBlockTooltip] = useState(null);

  useEffect(() => {
    if (tab !== TABS.blocks) setBlockTooltip(null);
  }, [tab]);

  useEffect(() => {
    if (!blockTooltip) return undefined;
    const onPointerDown = (e) => {
      if (e.target.closest('[data-block-pool-name-cell]')) return;
      setBlockTooltip(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setBlockTooltip(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [blockTooltip]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBracketLoading(true);
      setBracketError(null);
      try {
        const res = await contestApi.getScores(BLOCK_POOL_CONTEST_ID);
        if (cancelled) return;
        setBracketFinal(Array.isArray(res.bracketGamesFinal) ? res.bracketGamesFinal : []);
      } catch (e) {
        if (!cancelled) setBracketError(e.message || 'Could not load tournament results.');
      } finally {
        if (!cancelled) setBracketLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const winnersRowsSorted = useMemo(() => {
    return [...bracketFinal].sort((a, b) => {
      if (a.round !== b.round) return Number(a.round) - Number(b.round);
      const reg = String(a.region ?? '').localeCompare(String(b.region ?? ''), undefined, {
        sensitivity: 'base',
      });
      if (reg !== 0) return reg;
      const win = String(a.winnerName ?? '').localeCompare(String(b.winnerName ?? ''), undefined, {
        sensitivity: 'base',
      });
      if (win !== 0) return win;
      return (Number(a.gameId) || 0) - (Number(b.gameId) || 0);
    });
  }, [bracketFinal]);

  const payoutTotals = useMemo(() => {
    const byBlock = new Map();
    for (const g of bracketFinal) {
      const lines = getBlockPayoutLinesForGame(g.round, g.winnerScore, g.loserScore);
      for (const line of lines) {
        if (line.blockNum == null) continue;
        const prev = byBlock.get(line.blockNum) ?? {
          blockNum: line.blockNum,
          name: line.blockName,
          total: 0,
          wins: 0,
        };
        prev.total += line.amount;
        prev.wins += 1;
        if (line.blockName && line.blockName !== '—') prev.name = line.blockName;
        byBlock.set(line.blockNum, prev);
      }
    }
    return Array.from(byBlock.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, {
        sensitivity: 'base',
      });
    });
  }, [bracketFinal]);

  /**
   * Each resolved payout line per block (API game order). Drives $ icon rounds + block tooltip.
   */
  const blockPayoutHitsByBlock = useMemo(() => {
    const map = new Map();
    for (const g of bracketFinal) {
      const round = Number(g.round);
      if (![1, 2, 3, 4, 5, 6].includes(round)) continue;
      const lines = getBlockPayoutLinesForGame(round, g.winnerScore, g.loserScore);
      for (const line of lines) {
        if (line.blockNum == null) continue;
        if (!map.has(line.blockNum)) map.set(line.blockNum, []);
        map.get(line.blockNum).push({
          round,
          amount: line.amount,
          label: line.label,
          winnerName: g.winnerName,
          loserName: g.loserName,
          winnerScore: g.winnerScore,
          loserScore: g.loserScore,
          region: g.region,
          gameId: g.gameId,
        });
      }
    }
    return map;
  }, [bracketFinal]);

  if (year && String(year) !== String(BLOCK_POOL_YEAR)) {
    return <Navigate to="/contests" replace />;
  }

  return (
    <div className="contests-page">
      <header className="contests-header">
        <Link to="/contests" className="contests-back">← Contests</Link>
        <h1>{BLOCK_POOL_YEAR} March Madness Block Pool</h1>
      </header>

      <nav className="contests-tabs">
        <button
          type="button"
          className={tab === TABS.blocks ? 'active' : ''}
          onClick={() => setTab(TABS.blocks)}
        >
          Blocks
        </button>
        <button
          type="button"
          className={tab === TABS.winners ? 'active' : ''}
          onClick={() => setTab(TABS.winners)}
        >
          Winners
        </button>
      </nav>

      {tab === TABS.blocks && (
        <div className="block-pool-wrap">
          {blockTooltip &&
            createPortal(
              <div
                id="block-pool-tt"
                className="block-pool-block-tooltip-portal"
                style={{
                  position: 'fixed',
                  left: blockTooltip.rect.left + blockTooltip.rect.width / 2,
                  top:
                    blockTooltip.placeBelow
                      ? blockTooltip.rect.bottom + 10
                      : blockTooltip.rect.top - 10,
                  transform: blockTooltip.placeBelow
                    ? 'translate(-50%, 0)'
                    : 'translate(-50%, -100%)',
                  zIndex: 10050,
                  pointerEvents: 'none',
                }}
                role="tooltip"
              >
                <div className="block-pool-block-tooltip">
                  <div className="block-pool-block-tooltip__header">
                    <span className="block-pool-block-tooltip__name">{blockTooltip.name}</span>
                    <span className="block-pool-block-tooltip__block-num">
                      Block
                      {' '}
                      {blockTooltip.blockNum}
                    </span>
                  </div>
                  {blockTooltip.hits.length === 0 ? (
                    <p className="block-pool-block-tooltip__empty">No winners yet</p>
                  ) : (
                    <ul className="block-pool-block-tooltip__hits">
                      {blockTooltip.hits.map((h, i) => (
                        <li
                          key={`${h.gameId}-${h.label}-${i}`}
                          className="block-pool-block-tooltip__hit"
                        >
                          <div className="block-pool-block-tooltip__hit-row">
                            <span
                              className={`block-pool-block-tooltip__rnd block-pool-block-tooltip__rnd--r${h.round}`}
                            >
                              R
                              {h.round}
                            </span>
                            <span className="block-pool-block-tooltip__amt">
                              {usd0.format(h.amount)}
                            </span>
                            {h.label && h.label !== 'Main' ? (
                              <span className="block-pool-block-tooltip__kind">{h.label}</span>
                            ) : null}
                          </div>
                          <div className="block-pool-block-tooltip__game">
                            <span className="block-pool-block-tooltip__matchup">
                              {h.winnerName}
                              {' '}
                              <span className="block-pool-block-tooltip__vs">vs.</span>
                              {' '}
                              {h.loserName}
                            </span>
                            <span className="block-pool-block-tooltip__score">
                              {h.winnerScore}
                              {'–'}
                              {h.loserScore}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>,
              document.body,
            )}
          <div
            className="block-pool-board"
            aria-label="Block pool grid"
            onMouseLeave={() => setCrosshair(null)}
          >
            <div
              className="block-pool-lbl-spacer block-pool-gc"
              style={{ gridColumn: 1, gridRow: `1 / ${BOTTOM_ROW_START}` }}
              aria-hidden
            />
            {Array.from({ length: 6 }, (_, c) => (
              <div
                key={`bpad-${c}`}
                className="block-pool-diag-banner-pad"
                style={{ gridColumn: 2 + c, gridRow: 1 }}
                aria-hidden
              />
            ))}
            <div
              className="block-pool-axis-label block-pool-axis-label--winning block-pool-gc"
              style={{ gridColumn: '8 / 18', gridRow: 1 }}
            >
              Winning team
            </div>

            {ROUND_ORDER.map((round, rowIdx) => (
              <React.Fragment key={`dr-${round}`}>
                {Array.from({ length: 6 }, (_, colIdx) => (
                  <div
                    key={`d-${rowIdx}-${colIdx}`}
                    className={diagonalCellClass(rowIdx, colIdx)}
                    style={{ gridColumn: 2 + colIdx, gridRow: 2 + rowIdx }}
                    title={rowIdx === colIdx ? `Round ${round}` : undefined}
                  >
                    {rowIdx === colIdx ? (
                      <span className="block-pool-round-diag-label-text">
                        R
                        {round}
                      </span>
                    ) : null}
                  </div>
                ))}
                <div
                  className={`block-pool-winning-digit-row block-pool-tone-r${round}-row`}
                  style={{ gridColumn: '8 / 18', gridRow: 2 + rowIdx }}
                >
                  {WINNING_DIGITS_BY_ROUND[round].map((d, di) => (
                    <span
                      key={di}
                      className={
                        crosshair && di === crosshair.colIdx
                          ? 'block-pool-digit block-pool-digit--crosshair'
                          : 'block-pool-digit'
                      }
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </React.Fragment>
            ))}

            <div
              className="block-pool-losing-label-wrap block-pool-gc"
              style={{ gridColumn: 1, gridRow: `${BOTTOM_ROW_START} / ${BOTTOM_ROW_START + 10}` }}
            >
              <span className="block-pool-axis-label block-pool-axis-label--losing">
                Losing team
              </span>
            </div>
            {Array.from({ length: 10 }, (_, rowIdx) =>
              ROUND_ORDER.map((round, colIdx) => (
                <span
                  key={`l-${rowIdx}-${round}`}
                  className={`block-pool-digit block-pool-digit--losing block-pool-tone-r${round}-col${
                    crosshair && rowIdx === crosshair.rowIdx ? ' block-pool-digit--crosshair' : ''
                  }`}
                  style={{ gridColumn: 2 + colIdx, gridRow: BOTTOM_ROW_START + rowIdx }}
                >
                  {LOSING_DIGITS_BY_ROUND[round][rowIdx]}
                </span>
              ))).flat()}
            {Array.from({ length: 10 }, (_, rowIdx) =>
              Array.from({ length: 10 }, (_, colIdx) => {
                const blockNum = rowIdx * 10 + colIdx + 1;
                const name = BLOCK_ENTRIES[blockNum] ?? '—';
                const payoutHits = blockPayoutHitsByBlock.get(blockNum) ?? [];
                const isNameHovered =
                  crosshair && crosshair.rowIdx === rowIdx && crosshair.colIdx === colIdx;
                const tooltipOpen = blockTooltip && blockTooltip.blockNum === blockNum;
                return (
                  <div
                    key={blockNum}
                    role="button"
                    tabIndex={0}
                    data-block-pool-name-cell
                    className={[
                      'block-pool-name-cell',
                      isNameHovered && 'block-pool-name-cell--hovered',
                      tooltipOpen && 'block-pool-name-cell--tooltip-open',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ gridColumn: 8 + colIdx, gridRow: BOTTOM_ROW_START + rowIdx }}
                    aria-describedby={tooltipOpen ? 'block-pool-tt' : undefined}
                    aria-expanded={tooltipOpen}
                    onMouseEnter={() => setCrosshair({ rowIdx, colIdx })}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (blockTooltip?.blockNum === blockNum) {
                        setBlockTooltip(null);
                        return;
                      }
                      const rect = e.currentTarget.getBoundingClientRect();
                      const estH = 260;
                      const margin = 12;
                      const spaceBelow = window.innerHeight - rect.bottom - margin;
                      const spaceAbove = rect.top - margin;
                      const placeBelow =
                        spaceBelow >= estH || spaceBelow >= spaceAbove;
                      setBlockTooltip({
                        blockNum,
                        name,
                        hits: payoutHits,
                        rect,
                        placeBelow,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.currentTarget.click();
                    }}
                  >
                    <span className="block-pool-name-text">{name}</span>
                    {payoutHits.length > 0 ? (
                      <span
                        className="block-pool-win-icons"
                        aria-label={`${payoutHits.length} winning payout line${
                          payoutHits.length === 1 ? '' : 's'
                        }`}
                      >
                        {payoutHits.map((hit, i) => (
                          <span
                            key={`${hit.round}-${hit.gameId}-${hit.label}-${i}`}
                            className={`block-pool-win-icon block-pool-win-icon--r${hit.round}`}
                            aria-hidden
                          >
                            $
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })).flat()}
          </div>
        </div>
      )}

      {tab === TABS.winners && (
        <div className="block-pool-winners">
          {bracketLoading && <p className="block-pool-winners-status">Loading results…</p>}
          {bracketError && <p className="block-pool-winners-error">{bracketError}</p>}
          {!bracketLoading && !bracketError && bracketFinal.length === 0 && (
            <p className="block-pool-winners-empty">No finalized games yet.</p>
          )}
          {!bracketLoading && !bracketError && bracketFinal.length > 0 && (
            <>
              <div
                className="block-pool-winners-subtabs"
                role="tablist"
                aria-label="Winners display"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={winnersSubView === WINNERS_SUBVIEWS.games}
                  className={
                    winnersSubView === WINNERS_SUBVIEWS.games
                      ? 'block-pool-winners-subtabs-btn active'
                      : 'block-pool-winners-subtabs-btn'
                  }
                  onClick={() => setWinnersSubView(WINNERS_SUBVIEWS.games)}
                >
                  Games
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={winnersSubView === WINNERS_SUBVIEWS.payouts}
                  className={
                    winnersSubView === WINNERS_SUBVIEWS.payouts
                      ? 'block-pool-winners-subtabs-btn active'
                      : 'block-pool-winners-subtabs-btn'
                  }
                  onClick={() => setWinnersSubView(WINNERS_SUBVIEWS.payouts)}
                >
                  Payouts
                </button>
              </div>

              {winnersSubView === WINNERS_SUBVIEWS.games && (
                <div className="block-pool-winners-table-wrap">
                  <table className="block-pool-winners-table">
                    <thead>
                      <tr>
                        <th scope="col" className="block-pool-winners-col-round">
                          Round
                        </th>
                        <th scope="col">Region</th>
                        <th scope="col">Winner</th>
                        <th scope="col">Loser</th>
                        <th scope="col" className="block-pool-winners-col-score">
                          Score
                        </th>
                        <th scope="col">Winning Block</th>
                      </tr>
                    </thead>
                    <tbody>
                      {winnersRowsSorted.map((g) => {
                        const payoutLines = getBlockPayoutLinesForGame(
                          g.round,
                          g.winnerScore,
                          g.loserScore,
                        );
                        return (
                          <tr key={g.gameId}>
                            <td className="block-pool-winners-col-round">{g.round}</td>
                            <td>
                              <RegionPill region={g.region} />
                            </td>
                            <td>{g.winnerName}</td>
                            <td>{g.loserName}</td>
                            <td className="block-pool-winners-score">
                              {g.winnerScore}
                              {' '}
                              –
                              {' '}
                              {g.loserScore}
                            </td>
                            <td className="block-pool-winners-payouts">
                              <ul className="block-pool-winners-payout-list">
                                {payoutLines.map((line) => (
                                  <li key={line.kind}>
                                    <span className="block-pool-winners-payout-name">
                                      {line.blockNum != null ? (
                                        line.blockName
                                      ) : (
                                        <span
                                          className="block-pool-winners-payout-miss"
                                          title={line.unmatched ? 'Digit not on R× grid' : undefined}
                                        >
                                          —
                                        </span>
                                      )}
                                    </span>
                                    {' '}
                                    <span className="block-pool-winners-payout-amt">
                                      {usd0.format(line.amount)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {winnersSubView === WINNERS_SUBVIEWS.payouts && (
                <div className="block-pool-winners-table-wrap">
                  <table className="block-pool-winners-table block-pool-winners-table--payouts">
                    <thead>
                      <tr>
                        <th scope="col">Entry</th>
                        <th scope="col" className="block-pool-winners-col-wins">
                          Wins
                        </th>
                        <th scope="col" className="block-pool-winners-col-total">
                          Total won
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payoutTotals.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="block-pool-winners-empty-payouts">
                            No matched blocks yet — totals appear when winning blocks resolve for
                            finalized games.
                          </td>
                        </tr>
                      ) : (
                        payoutTotals.map((row) => (
                          <tr key={row.blockNum}>
                            <td>{row.name}</td>
                            <td className="block-pool-winners-col-wins">{row.wins}</td>
                            <td className="block-pool-winners-col-total block-pool-winners-payout-amt">
                              {usd0.format(row.total)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
