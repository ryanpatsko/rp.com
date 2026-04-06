/**
 * March Madness player-pool contest history (manual).
 * Payout assumption for trophy case: $300 per 1st, $100 per 2nd.
 */

export const PLAYER_POOL_FIRST_PRIZE_USD = 300;
export const PLAYER_POOL_SECOND_PRIZE_USD = 100;

/** Year rows: newest first. Use note for years without placings. */
export const PLAYER_POOL_PAST_RESULTS = [
  { year: 2025, first: 'Tsal', second: 'Grew' },
  { year: 2024, first: 'Tsal', second: 'Grew' },
  { year: 2023, first: 'Plako', second: 'Tsal' },
  { year: 2022, first: 'Joe K', second: 'Laypers' },
  { year: 2021, first: 'Adam', second: 'Erv' },
  { year: 2020, note: 'Covid' },
  { year: 2019, first: 'Plako', second: 'Mcnutt' },
  { year: 2018, first: 'Adam', second: 'Plako' },
  { year: 2017, first: 'Plako', second: 'Tsal' },
  { year: 2016, first: 'Laypers', second: 'Tsal' },
  { year: 2015, first: 'Laypers', second: 'Adam' },
  { year: 2014, first: 'Joe K', second: 'Mcnutt' },
  { year: 2013, note: 'Results missing' },
  { year: 2012, note: 'Results missing' },
  { year: 2011, first: 'Grew', second: 'Tsal' },
  { year: 2010, first: 'Joe K', second: 'Grew' },
];

/**
 * @returns {{ name: string, wins: number, seconds: number, winnings: number }[]}
 */
export function buildPlayerPoolTrophyCase() {
  const map = new Map();
  for (const row of PLAYER_POOL_PAST_RESULTS) {
    if (row.first) {
      const e = map.get(row.first) || { name: row.first, wins: 0, seconds: 0 };
      e.wins += 1;
      map.set(row.first, e);
    }
    if (row.second) {
      const e = map.get(row.second) || { name: row.second, wins: 0, seconds: 0 };
      e.seconds += 1;
      map.set(row.second, e);
    }
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      winnings: r.wins * PLAYER_POOL_FIRST_PRIZE_USD + r.seconds * PLAYER_POOL_SECOND_PRIZE_USD,
    }))
    .sort((a, b) => {
      if (b.winnings !== a.winnings) return b.winnings - a.winnings;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
}
