/**
 * Training log abbreviations (100 Miler plan).
 * Longest keys first so HTI matches before HT.
 */
const ABBREVIATIONS = {
  HTI: 'Hill Training Intervals',
  xCardio: 'alternative cardio',
  HT: 'Hill Training',
  UB: 'Upper Body lift',
  LB: 'Lower Body lift',
  RR: 'Road Run',
  C: 'Core workout',
};

/** Ordered longest-first for safe replacement */
const ABBREV_ENTRIES = Object.entries(ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expand known abbreviations in a workout cell (e.g. "LB + C" → "Lower Body lift + Core workout").
 * Leaves mileage notes like "(2)" and unknown tokens unchanged.
 */
function expandWorkoutText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const [abbr, full] of ABBREV_ENTRIES) {
    const re = new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'gi');
    out = out.replace(re, full);
  }
  return out;
}

module.exports = {
  ABBREVIATIONS,
  expandWorkoutText,
};
