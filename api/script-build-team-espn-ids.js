/**
 * Regenerates team-espn-ids.json from ESPN's public teams feed + bracket-regions aliases.
 * Run from repo root: node api/script-build-team-espn-ids.js
 */
const fs = require('fs');
const path = require('path');

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000';
const OUT = path.join(__dirname, 'team-espn-ids.json');
/** CRA bundle copy for client-side logo lookup (Block Pool, etc.). */
const OUT_SRC = path.join(__dirname, '..', 'src', 'data', 'team-espn-ids.json');
const REGIONS_FILE = path.join(__dirname, 'bracket-regions.json');

/**
 * Bracket-regions / BallDontLie labels that do not match ESPN strings.
 * Value is either an ESPN numeric id or a hint string that matches an ESPN team field.
 */
const BRACKET_LABEL_TO_ESPN = {
  'Ohio St': 'Ohio State',
  'N. Iowa': 'Northern Iowa',
  'Cal Baptist': 'California Baptist',
  Connecticut: 'UConn',
  'Utah St': 'Utah State',
  'University of Hawaii': 'Hawaii',
  'University of Hawaii at Manoa': 'Hawaii',
  UH: 'Hawaii',
  'Brigham Young': 'BYU',
  'Miami (FL)': 'Miami',
  'North Carolina State': 'NC State',
  Queens: '2511',
  'Queens NC': '2511',
  'Queens Royal': '2511',
  'Queens University': '2511',
  'Queens University of Charlotte': '2511',
  'Queens (NC)': '2511',
  'McNeese State': 'McNeese',
  'N. Carolina': 'North Carolina',
  'Virginia Commonwealth': 'VCU',
  "St Mary's": "Saint Mary's",
  'Texas AM': 'Texas A&M',
  PVAMU: 'Prairie View A&M',
  'Miami (Ohio)': 'Miami OH',
  'Miami (OH)': 'Miami OH',
  'Southern Methodist': 'SMU',
  'Iowa St': 'Iowa State',
};

function addKey(map, key, id, collisions) {
  if (key == null) return;
  const t = String(key).trim();
  if (!t) return;
  const prev = map[t];
  if (prev != null && String(prev) !== String(id)) {
    collisions.push({ key: t, existingId: prev, newId: id });
    return;
  }
  map[t] = String(id);
}

function normLoose(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '');
}

/** St / Saint, AM / A&M style helpers */
function aliasStrings(s) {
  const t = String(s || '').trim();
  if (!t) return [];
  const out = new Set([t]);
  const lower = t.toLowerCase();
  if (lower.includes('saint ')) out.add(t.replace(/Saint /i, 'St. '));
  if (lower.includes('st. ')) out.add(t.replace(/St\.\s+/i, 'Saint '));
  if (lower.includes('st ')) out.add(t.replace(/^St\s+/i, 'St. '));
  return [...out];
}

function teamMatchesBracketKey(team, key) {
  const k = String(key || '').trim();
  if (!k) return false;
  const kl = k.toLowerCase();
  const abbr = (team.abbreviation || '').toUpperCase();
  if (abbr && abbr === k.toUpperCase()) return true;
  const shortNm = (team.shortDisplayName || '').trim();
  if (shortNm && shortNm.toLowerCase() === kl) return true;
  const loc = (team.location || '').trim();
  if (loc && loc.toLowerCase() === kl) return true;
  const nick = (team.nickname || '').trim();
  if (nick && nick.toLowerCase() === kl) return true;
  const disp = (team.displayName || '').trim();
  const dl = disp.toLowerCase();
  if (dl === kl) return true;
  if (dl.startsWith(`${kl} `)) return true;
  const looseK = normLoose(k);
  if (looseK && normLoose(shortNm) === looseK) return true;
  if (looseK && normLoose(loc) === looseK) return true;
  if (looseK && normLoose(disp).startsWith(`${looseK} `)) return true;
  return false;
}

async function main() {
  const res = await fetch(ESPN_URL);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const j = await res.json();
  const list = j.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = list.map((x) => x.team).filter(Boolean);

  const keyToId = {};
  const collisions = [];

  for (const t of teams) {
    const id = t.id;
    const regs = new Set([
      t.abbreviation,
      t.displayName,
      t.shortDisplayName,
      t.location,
      t.nickname,
      t.slug ? t.slug.replace(/-/g, ' ') : null,
    ].filter(Boolean));

    for (const raw of regs) {
      for (const s of aliasStrings(raw)) {
        addKey(keyToId, s, id, collisions);
        if (t.abbreviation && raw === t.abbreviation) {
          addKey(keyToId, s.toUpperCase(), id, collisions);
          addKey(keyToId, s.toLowerCase(), id, collisions);
        }
      }
    }
  }

  let regionKeys = [];
  try {
    const reg = JSON.parse(fs.readFileSync(REGIONS_FILE, 'utf8'));
    regionKeys = Object.keys(reg.teamToRegion || {});
  } catch (_) {
    /* optional */
  }

  function resolveEspnIdForHint(hint) {
    const h = String(hint || '').trim();
    if (!h) return null;
    if (/^\d+$/.test(h)) return h;
    if (keyToId[h]) return keyToId[h];
    const found = teams.find((t) => teamMatchesBracketKey(t, h));
    return found ? String(found.id) : null;
  }

  for (const [label, hint] of Object.entries(BRACKET_LABEL_TO_ESPN)) {
    const id = resolveEspnIdForHint(hint);
    if (id) addKey(keyToId, label, id, collisions);
  }

  const unresolved = [];
  for (const key of regionKeys) {
    if (keyToId[key]) continue;
    const found = teams.find((t) => teamMatchesBracketKey(t, key));
    if (found) {
      addKey(keyToId, key, found.id, collisions);
      for (const alt of aliasStrings(key)) {
        if (alt !== key) addKey(keyToId, alt, found.id, collisions);
      }
    } else {
      unresolved.push(key);
    }
  }

  const payload = {
    comment:
      'String key (team abbreviation or school name as BallDontLie/bracket-regions use) -> ESPN team id. Regenerate: node api/script-build-team-espn-ids.js',
    source: ESPN_URL,
    generatedAt: new Date().toISOString(),
    teamCount: teams.length,
    keyCount: Object.keys(keyToId).length,
    unresolvedBracketKeys: unresolved.length ? unresolved : undefined,
    collisions: collisions.length ? collisions : undefined,
    keyToEspnId: keyToId,
  };

  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(OUT, json, 'utf8');
  fs.mkdirSync(path.dirname(OUT_SRC), { recursive: true });
  fs.writeFileSync(OUT_SRC, json, 'utf8');
  console.log('Wrote', OUT, '&', OUT_SRC, 'keys:', payload.keyCount, 'unresolved:', unresolved.length, 'collisions:', collisions.length);
  if (unresolved.length) console.warn('Unresolved:', unresolved.join(', '));
  if (collisions.length) console.warn('Sample collision:', collisions[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
