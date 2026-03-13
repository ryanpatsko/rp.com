#!/usr/bin/env node
/**
 * Fetches the player pool from the contest API and prints distinct bracket_location values.
 * Usage: node script-bracket-locations.js [contestId]
 * Requires CONTEST_API_URL env or uses default (see contestApi in src).
 */
const BASE = process.env.CONTEST_API_URL || process.env.REACT_APP_CONTEST_API_URL || 'https://xj8k273vj7.execute-api.us-east-1.amazonaws.com';
const contestId = process.argv[2] || '2026-1';

async function main() {
  const url = `${BASE.replace(/\/$/, '')}/contests/${contestId}/player-pool`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const pool = await res.json();
  const locations = [...new Set(pool.map((p) => p.bracket_location).filter((v) => v != null))];
  locations.sort((a, b) => Number(a) - Number(b));
  console.log('Contest:', contestId);
  console.log('Players in pool:', pool.length);
  console.log('Distinct bracket_location values:', locations);
  console.log('Count per bracket_location:');
  const counts = {};
  for (const p of pool) {
    const loc = p.bracket_location != null ? p.bracket_location : 'null';
    counts[loc] = (counts[loc] || 0) + 1;
  }
  Object.keys(counts)
    .sort((a, b) => (a === 'null' ? 1 : b === 'null' ? -1 : Number(a) - Number(b)))
    .forEach((loc) => console.log('  ', loc, ':', counts[loc]));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
