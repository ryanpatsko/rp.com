/** Matches health-api/scrapers/training-abbreviations.js — keep in sync when adding terms. */
export const TRAINING_ABBREVIATIONS = {
  HTI: 'Hill Training Intervals',
  xCardio: 'alternative cardio',
  HT: 'Hill Training',
  UB: 'Upper Body lift',
  LB: 'Lower Body lift',
  RR: 'Road Run',
  C: 'Core workout',
};

const ENTRIES = Object.entries(TRAINING_ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function expandWorkoutText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const [abbr, full] of ENTRIES) {
    const re = new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'gi');
    out = out.replace(re, full);
  }
  return out;
}

export function displayWorkout(entry) {
  return entry?.workoutExpanded || expandWorkoutText(entry?.workout) || entry?.workout || '—';
}
