/**
 * 2026 March Madness Block Pool — static data (view-only).
 * Block 1 = top-left; 10 = top-right; 100 = bottom-right.
 * Winning digits = last digit of winning team score; losing = last digit of losing score.
 * Rounds 1–6 only (First Four / round 0 excluded).
 */

export const BLOCK_POOL_YEAR = 2026;

/** Same S3 contest as the Player Pool (`/contests/pp/2026-1`); shares `scores.json` / bracket refresh. */
export const BLOCK_POOL_CONTEST_ID = '2026-1';

/** Per round, 10 digits 0–9 for columns (winning team axis), left→right. */
export const WINNING_DIGITS_BY_ROUND = {
  1: [4, 5, 8, 3, 2, 6, 1, 0, 9, 7],
  2: [8, 5, 2, 3, 9, 7, 6, 4, 0, 1],
  3: [4, 3, 9, 7, 0, 5, 6, 1, 8, 2],
  4: [9, 1, 3, 2, 0, 5, 4, 7, 8, 6],
  5: [1, 7, 2, 9, 3, 5, 6, 0, 4, 8],
  6: [2, 9, 8, 4, 5, 3, 7, 0, 1, 6],
};

/** Per round, 10 digits for rows (losing team axis), top→bottom. */
export const LOSING_DIGITS_BY_ROUND = {
  1: [8, 3, 0, 6, 4, 5, 1, 9, 2, 7],
  2: [2, 0, 7, 8, 6, 4, 1, 3, 5, 9],
  3: [1, 0, 9, 8, 2, 4, 6, 7, 3, 5],
  4: [9, 5, 2, 6, 0, 4, 8, 1, 3, 7],
  5: [4, 6, 7, 2, 8, 9, 5, 0, 1, 3],
  6: [5, 3, 0, 2, 1, 4, 6, 7, 9, 8],
};

/**
 * Pool payout lines per round (matches pool spreadsheet).
 * main = ones digit of winner on winning axis, ones of loser on losing axis.
 * rev = same with digits swapped across axes (e.g. main 1–5 → rev 5–1).
 * half / halfRev = same using tens digit of each final score.
 */
export const ROUND_PAYOUT_LINES = {
  1: [{ kind: 'main', label: 'Main', amount: 50 }],
  2: [{ kind: 'main', label: 'Main', amount: 100 }],
  3: [{ kind: 'main', label: 'Main', amount: 200 }],
  4: [
    { kind: 'main', label: 'Main', amount: 300 },
    { kind: 'rev', label: 'Reverse', amount: 100 },
  ],
  5: [
    { kind: 'main', label: 'Main', amount: 600 },
    { kind: 'rev', label: 'Reverse', amount: 200 },
  ],
  6: [
    { kind: 'main', label: 'Main', amount: 1200 },
    { kind: 'rev', label: 'Reverse', amount: 400 },
    { kind: 'half', label: 'Half', amount: 300 },
    { kind: 'halfRev', label: 'Half rev', amount: 100 },
  ],
};

function onesDigit(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.abs(Math.trunc(Number(n))) % 10;
}

function tensDigit(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const t = Math.abs(Math.trunc(Number(n)));
  return Math.floor(t / 10) % 10;
}

/**
 * @param {1|2|3|4|5|6} round
 * @param {'main'|'rev'|'half'|'halfRev'} kind
 * @returns {{ blockNum: number, blockName: string } | { blockNum: null, blockName: null, unmatched?: boolean }}
 */
export function resolveBlockForScoreKind(round, winnerScore, loserScore, kind) {
  const winArr = WINNING_DIGITS_BY_ROUND[round];
  const loseArr = LOSING_DIGITS_BY_ROUND[round];
  if (!winArr || !loseArr) return { blockNum: null, blockName: null };

  const useTens = kind === 'half' || kind === 'halfRev';
  const wDig = useTens ? tensDigit(winnerScore) : onesDigit(winnerScore);
  const lDig = useTens ? tensDigit(loserScore) : onesDigit(loserScore);
  if (wDig == null || lDig == null) return { blockNum: null, blockName: null };

  const swapAxes = kind === 'rev' || kind === 'halfRev';
  const colDigit = swapAxes ? lDig : wDig;
  const rowDigit = swapAxes ? wDig : lDig;

  const colIdx = winArr.indexOf(colDigit);
  const rowIdx = loseArr.indexOf(rowDigit);
  if (colIdx < 0 || rowIdx < 0) return { blockNum: null, blockName: null, unmatched: true };

  const blockNum = rowIdx * 10 + colIdx + 1;
  return {
    blockNum,
    blockName: BLOCK_ENTRIES[blockNum] ?? '—',
  };
}

/** All payout lines with resolved block for one finalized game. */
export function getBlockPayoutLinesForGame(round, winnerScore, loserScore) {
  const defs = ROUND_PAYOUT_LINES[round];
  if (!defs) return [];
  return defs.map((d) => {
    const res = resolveBlockForScoreKind(round, winnerScore, loserScore, d.kind);
    return {
      kind: d.kind,
      label: d.label,
      amount: d.amount,
      blockNum: res.blockNum,
      blockName: res.blockName,
      unmatched: res.unmatched === true,
    };
  });
}

/** Games per NCAA round (1–6); First Four excluded (standard 67-game bracket from round of 64). */
export const BRACKET_GAMES_PER_ROUND = {
  1: 32,
  2: 16,
  3: 8,
  4: 4,
  5: 2,
  6: 1,
};

function payoutScheduleRoundLabel(round, kind) {
  if (kind === 'main') return String(round);
  if (kind === 'rev') return `${round} (rev)`;
  if (kind === 'half') return `${round} (half)`;
  if (kind === 'halfRev') return `${round} (half rev)`;
  return String(round);
}

/**
 * Rows for the payout schedule table (per-game amount × games in that round).
 * @returns {{ rows: Array<{ roundLabel: string, perGame: number, payouts: number, total: number }>, totalPayouts: number, totalDollars: number }}
 */
export function getBlockPoolPayoutSchedule() {
  const rows = [];
  for (let round = 1; round <= 6; round += 1) {
    const games = BRACKET_GAMES_PER_ROUND[round];
    const lines = ROUND_PAYOUT_LINES[round];
    if (!lines) continue;
    for (const line of lines) {
      rows.push({
        roundLabel: payoutScheduleRoundLabel(round, line.kind),
        perGame: line.amount,
        payouts: games,
        total: line.amount * games,
      });
    }
  }
  const totalPayouts = rows.reduce((s, r) => s + r.payouts, 0);
  const totalDollars = rows.reduce((s, r) => s + r.total, 0);
  return { rows, totalPayouts, totalDollars };
}

/** Main payout line for the R1–R6 diagonal; asterisk when the round also has rev / half lines. */
export function getRoundMainPayoutDisplay(round) {
  const lines = ROUND_PAYOUT_LINES[round];
  if (!lines?.length) return null;
  const mainLine = lines.find((l) => l.kind === 'main');
  const main = mainLine ?? lines[0];
  return {
    amount: main.amount,
    showAsterisk: lines.length > 1,
  };
}

/** Block number (1–100) → entry name */
export const BLOCK_ENTRIES = {
  1: 'Adam Sondej',
  2: 'Renae Gaghan',
  3: 'Brian Bennett',
  4: 'Jon Grubbs',
  5: 'Allie Franz',
  6: 'Jeff Baughman',
  7: 'Mike Fugh',
  8: 'Blair Eiler',
  9: 'Ashley Phillips',
  10: 'Bill Patterson',
  11: 'George Trusik',
  12: 'Joe Johnston',
  13: 'Steve Piotrowski',
  14: 'Brad Flock',
  15: 'Jeff Aiken',
  16: 'Zach Mattock',
  17: 'Gerry Beglinger',
  18: 'Joe Saxinger',
  19: 'Bill Semler',
  20: 'Sheridan',
  21: 'Tina Schmidt',
  22: 'Mark Huber',
  23: 'Seth Baughman',
  24: 'Erv Sullivan',
  25: 'Harry WIlson',
  26: 'Derek Dengel',
  27: 'Anthony Ciafre',
  28: 'Michelle Goodworth',
  29: 'Scott Shankel',
  30: 'Jim Scherer',
  31: 'Clay Hellman',
  32: 'Jim Shankel',
  33: 'Bill States',
  34: 'Bill Leja',
  35: 'Greg Mays',
  36: 'Bob Bartley',
  37: 'Eric Cooper',
  38: 'Justin Gray',
  39: 'Patty Ranalli',
  40: 'Alexis Ciafre',
  41: 'Craig Rechichar',
  42: 'Mike Brooks',
  43: 'Brian Mcnutt',
  44: 'Dom Ciafre',
  45: 'Brad Mellor',
  46: 'Colin Agster',
  47: 'Matt Pettigrew',
  48: "Matt O'Rouke",
  49: 'Josh Grubbs',
  50: 'Dan Hartman',
  51: 'Ryan Patsko',
  52: 'Emery Bezak',
  53: 'Cherie Sharp',
  54: 'Mick Pappas',
  55: 'Justin Lapiska',
  56: 'Chelsie Wonchek',
  57: 'Dave Rock',
  58: 'Bill Ross',
  59: 'Evan Lapiska',
  60: 'Leigh Ann Shankel',
  61: 'C.E.S.',
  62: 'Ryan Mageras',
  63: 'Jason Seal',
  64: 'Hawk',
  65: 'Joel Brooks',
  66: 'Bill Jacobs',
  67: 'Dino Ciafre',
  68: 'John Hough',
  69: 'Jim Defilippo',
  70: 'Denny Notareschi',
  71: 'Scott McCandless',
  72: 'Tony Ranalli',
  73: 'Steve McDonald',
  74: 'Dave Moran',
  75: 'Brian Rosswog',
  76: 'Danielle Saxinger',
  77: 'Scott Gilbert',
  78: 'John DeFilippo',
  79: "Ryan O'Connell",
  80: 'Kevin Dwyer',
  81: 'Al & Maureen',
  82: 'Mike Sullivan',
  83: 'Travis Airey',
  84: 'Lynn Bennett',
  85: 'Rick Bralich',
  86: 'TJ Ranalli',
  87: 'Steve Rinaman',
  88: 'Mike Ross',
  89: 'Craig Pelat',
  90: 'Brian Rinaman',
  91: 'John Pepmeyer',
  92: 'Jon Klein',
  93: 'Eric Peterson',
  94: 'Tony Salvucci',
  95: 'Bill Pettigrew',
  96: 'Marco',
  97: 'Scott Vargo',
  98: 'Steve Bezak',
  99: 'Tom McGaughey',
  100: 'Dave Grubbs',
};
