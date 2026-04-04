import teamEspnPayload from './data/team-espn-ids.json';

const teamToEspnId = teamEspnPayload.keyToEspnId || {};

function espnTeamIdFromLookup(name, abbr) {
  if (abbr && teamToEspnId[abbr]) return teamToEspnId[abbr];
  if (name && teamToEspnId[name]) return teamToEspnId[name];
  if (!name) return null;
  const trimmed = String(name).trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  for (let i = parts.length; i >= 1; i--) {
    const cand = parts.slice(0, i).join(' ');
    if (teamToEspnId[cand]) return teamToEspnId[cand];
  }
  let best = null;
  let bestLen = 0;
  for (const k of Object.keys(teamToEspnId)) {
    if (trimmed === k || trimmed.startsWith(`${k} `)) {
      if (k.length > bestLen) {
        bestLen = k.length;
        best = teamToEspnId[k];
      }
    }
  }
  return best;
}

/** ESPN CDN logo URL for a school name (and optional abbrev.) or null. */
export function espnTeamLogoUrlForSchoolName(name, abbr = null) {
  const id = espnTeamIdFromLookup(name, abbr);
  if (!id) return null;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/${id}.png&h=36&w=36`;
}
