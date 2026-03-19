const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

let teamToRegion = {};
try {
  const regionsPath = path.join(__dirname, 'bracket-regions.json');
  teamToRegion = JSON.parse(fs.readFileSync(regionsPath, 'utf8')).teamToRegion || {};
} catch (e) {
  console.warn('bracket-regions.json not loaded:', e.message);
}

const s3 = new S3Client({});
const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function signAdminToken(contestId, secret) {
  const payload = JSON.stringify({ contestId, exp: Date.now() + ADMIN_TOKEN_TTL_MS });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyAdminToken(token, contestId, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (sig !== expectedSig) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return false;
  }
  if (payload.contestId !== contestId || payload.exp < Date.now()) return false;
  return true;
}

const BDL_BASE = 'https://api.balldontlie.io/ncaab/v1';
/** Season used for March Madness bracket import. */
const BRACKET_SEASON = 2025;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json',
};

function jsonResponse(body, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function normalizePath(path) {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  return trimmed.replace(/^\/[^/]+(?=\/contests)/, '');
}

function parsePath(path) {
  const normalized = normalizePath(path);
  const match = normalized.match(/^\/contests\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  const resource = match[2] || null;
  return { contestId: match[1], resource, resourceLower: (resource || '').toLowerCase() };
}

async function getS3Json(bucket, key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await res.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'NoSuchKey') return null;
    throw e;
  }
}

async function putS3Json(bucket, key, data) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));
}

async function bdlFetch(apiKey, path, params = {}) {
  const url = new URL(BDL_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k + '[]', x));
    else if (v != null) url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`BallDontLie ${res.status}: ${t}`);
  }
  return res.json();
}

async function fetchActivePlayers(apiKey, options = {}) {
  const { teamIds = null, maxPlayers = null } = options;
  const players = [];
  let cursor = undefined;
  let page = 0;
  do {
    const params = { per_page: 100 };
    if (cursor != null) params.cursor = cursor;
    if (teamIds && teamIds.length) params.team_ids = teamIds;
    const data = await bdlFetch(apiKey, '/players/active', params);
    const list = data.data || [];
    players.push(...list);
    cursor = data.meta?.next_cursor ?? null;
    page++;
    console.log('Fetched active players page', page, 'total so far', players.length);
    if (maxPlayers != null && players.length >= maxPlayers) break;
    if (cursor) await new Promise((r) => setTimeout(r, 150));
  } while (cursor);
  return maxPlayers != null ? players.slice(0, maxPlayers) : players;
}

async function fetchPlayerSeasonStats(apiKey, playerIds, season = 2025) {
  if (!playerIds.length) return [];
  const BATCH = 100;
  const all = [];
  for (let i = 0; i < playerIds.length; i += BATCH) {
    const batch = playerIds.slice(i, i + BATCH);
    try {
      let cursor = undefined;
      let page = 0;
      do {
        const params = { player_ids: batch, season };
        if (cursor != null) params.cursor = cursor;
        const data = await bdlFetch(apiKey, '/player_season_stats', params);
        const list = (data.data && Array.isArray(data.data)) ? data.data : [];
        all.push(...list);
        cursor = data.meta?.next_cursor ?? null;
        page++;
        if (cursor) await new Promise((r) => setTimeout(r, 150));
      } while (cursor);
      if (i + BATCH < playerIds.length) await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      console.warn('player_season_stats batch error:', e.message);
    }
  }
  console.log('Player season stats total:', all.length);
  return all;
}

/**
 * Fetches March Madness bracket for a season (GOAT tier). Returns raw API response.
 * @param {number} [roundId] - If provided (1-6), only games for that round are returned.
 */
async function fetchBracket(apiKey, season = BRACKET_SEASON, roundId = null) {
  const params = { season };
  if (roundId != null && roundId >= 1 && roundId <= 6) params.round_id = roundId;
  const data = await bdlFetch(apiKey, '/bracket', params);
  return data;
}

/**
 * Fetches full bracket (all rounds) with cursor pagination. Use when round_id filter returns partial play-in data.
 */
async function fetchBracketAll(apiKey, season = BRACKET_SEASON) {
  const allGames = [];
  let cursor = undefined;
  let page = 0;
  do {
    const params = { season };
    if (cursor != null) params.cursor = cursor;
    const data = await bdlFetch(apiKey, '/bracket', params);
    const list = data.data ?? data.games ?? [];
    const games = Array.isArray(list) ? list : (list.games && Array.isArray(list.games) ? list.games : []);
    allGames.push(...games);
    cursor = data.meta?.next_cursor ?? null;
    page++;
    console.log('Bracket full page', page, 'games so far:', allGames.length);
    if (cursor) await new Promise((r) => setTimeout(r, 150));
  } while (cursor);
  return allGames;
}

/**
 * Fetches bracket and returns only round 0 (play-in) and round 1 games for import. Fetches full bracket
 * so all four First Four matchups are included (API may only return one when filtering by round_id=0).
 */
async function fetchBracketRound0And1All(apiKey, season = BRACKET_SEASON) {
  const allGames = await fetchBracketAll(apiKey, season);
  const round0And1 = allGames.filter((g) => Number(g.round) === 0 || Number(g.round) === 1);
  console.log('Bracket filtered to round 0+1:', round0And1.length, 'of', allGames.length);
  return { data: round0And1 };
}

/**
 * From bracket API response, parses round 1 games and returns team IDs, team info map,
 * and per-team seed / bracket_location. Uses the documented shape: home_team, away_team
 * (each with id, full_name, college, abbreviation, seed); bracket_location on the game.
 * Includes round === 1 and round === 0 (play-in / First Four). Seed on play-in games is the seed we save.
 */
function parseBracketRound1(bracketResponse) {
  let games = bracketResponse.data ?? bracketResponse.games ?? [];
  if (!Array.isArray(games) && games && typeof games === 'object') {
    if (Array.isArray(games.games)) games = games.games;
    else if (Array.isArray(games[1])) games = games[1];
    else if (Array.isArray(bracketResponse.rounds?.[1])) games = bracketResponse.rounds[1];
  }
  if (!Array.isArray(games)) {
    console.log('Bracket response keys:', bracketResponse ? Object.keys(bracketResponse) : 'null');
    console.log('Bracket response sample:', JSON.stringify(bracketResponse).slice(0, 800));
    games = [];
  }
  const round0And1 = games.filter((g) => Number(g.round) === 0 || Number(g.round) === 1);
  const round0Count = games.filter((g) => Number(g.round) === 0).length;
  if (round0And1.length === 0 && games.length > 0) {
    const first = games[0];
    console.log('First game keys:', first ? Object.keys(first) : 'n/a', 'round:', first?.round);
  }
  console.log('Bracket games total:', games.length, 'round 0 (play-in):', round0Count, 'round 0+1:', round0And1.length);
  const teamMap = {};
  const teamIdToSeed = {};
  const teamIdToBracketLocation = {};
  const teamIds = new Set();

  for (const g of round0And1) {
    const home = g.home_team;
    const away = g.away_team;
    const gameLoc = g.bracket_location;

    if (home?.id != null) {
      teamIds.add(home.id);
      teamMap[home.id] = {
        name: home.full_name ?? home.college ?? '',
        abbreviation: home.abbreviation ?? '',
      };
      if (home.seed != null) teamIdToSeed[home.id] = home.seed;
      if (gameLoc != null) teamIdToBracketLocation[home.id] = gameLoc;
    }
    if (away?.id != null) {
      teamIds.add(away.id);
      teamMap[away.id] = {
        name: away.full_name ?? away.college ?? '',
        abbreviation: away.abbreviation ?? '',
      };
      if (away.seed != null) teamIdToSeed[away.id] = away.seed;
      if (gameLoc != null) teamIdToBracketLocation[away.id] = gameLoc;
    }
  }

  return {
    teamIds: Array.from(teamIds),
    teamMap,
    teamIdToSeed,
    teamIdToBracketLocation,
  };
}

/**
 * Normalizes a single game to { gameId, round } or null. Round must be 1-6.
 * @param {number} [defaultRound] - If game has no round, use this (e.g. when fetching by round_id).
 */
function normalizeBracketGame(g, defaultRound = null) {
  const gameId = g.game_id ?? g.id;
  let round = Number(g.round);
  if (Number.isNaN(round) && defaultRound != null && defaultRound >= 1 && defaultRound <= 6) round = defaultRound;
  if (gameId == null) return null;
  if (Number.isNaN(round) || round < 1 || round > 6) return null;
  return { gameId: Number(gameId), round };
}

/**
 * Parses bracket response into list of games with gameId and round (1-6) for scoring.
 * @param {object} bracketResponse - API response
 * @param {number} [defaultRound] - When we fetched with round_id, use this for games that have no round.
 */
function parseBracketAllGames(bracketResponse, defaultRound = null) {
  const out = [];
  const pushGames = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((g) => {
      const parsed = normalizeBracketGame(g, defaultRound);
      if (parsed) out.push(parsed);
    });
  };

  const data = bracketResponse?.data ?? bracketResponse?.games ?? bracketResponse;
  if (Array.isArray(data)) {
    pushGames(data);
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.games)) pushGames(data.games);
    const rounds = data.rounds ?? data;
    if (rounds && typeof rounds === 'object' && !Array.isArray(rounds)) {
      [1, 2, 3, 4, 5, 6].forEach((r) => {
        const list = rounds[r] ?? rounds[String(r)];
        if (Array.isArray(list)) pushGames(list);
      });
    }
  }

  const byRound = {};
  out.forEach(({ round }) => { byRound[round] = (byRound[round] || 0) + 1; });
  console.log('Bracket games for scoring:', out.length, 'by round:', byRound);
  return out;
}

/**
 * Rich bracket game for elimination (BallDontLie rounds 1–7; 7 = championship).
 * home_team / away_team include winner + score when the game is final.
 */
function parseBracketGameDetail(g, defaultRound = null) {
  const gameId = g.game_id ?? g.id;
  let round = Number(g.round);
  if (Number.isNaN(round) && defaultRound != null && defaultRound >= 1 && defaultRound <= 7) round = defaultRound;
  if (gameId == null) return null;
  if (Number.isNaN(round) || round < 1 || round > 7) return null;
  const home = g.home_team;
  const away = g.away_team;
  const homeId = home?.id != null ? Number(home.id) : null;
  const awayId = away?.id != null ? Number(away.id) : null;
  return {
    gameId: Number(gameId),
    round,
    homeId,
    awayId,
    homeWinner: home?.winner,
    awayWinner: away?.winner,
    homeScore: home?.score != null ? Number(home.score) : (g.home_score != null ? Number(g.home_score) : null),
    awayScore: away?.score != null ? Number(away.score) : (g.away_score != null ? Number(g.away_score) : null),
    status: g.status ?? null,
  };
}

function parseBracketAllGamesDetail(bracketResponse, defaultRound = null) {
  const out = [];
  const pushGames = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((g) => {
      const parsed = parseBracketGameDetail(g, defaultRound);
      if (parsed) out.push(parsed);
    });
  };

  const data = bracketResponse?.data ?? bracketResponse?.games ?? bracketResponse;
  if (Array.isArray(data)) {
    pushGames(data);
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.games)) pushGames(data.games);
    const rounds = data.rounds ?? data;
    if (rounds && typeof rounds === 'object' && !Array.isArray(rounds)) {
      [1, 2, 3, 4, 5, 6, 7].forEach((r) => {
        const list = rounds[r] ?? rounds[String(r)];
        if (Array.isArray(list)) pushGames(list);
      });
    }
  }

  return out;
}

/** teamId (string key) -> eliminated after this bracket round (lost that game). */
function buildTeamEliminationMap(gameDetails) {
  const out = {};
  for (const g of gameDetails) {
    const {
      round, homeId, awayId, homeWinner, awayWinner, homeScore, awayScore, status,
    } = g;
    if (homeId == null || awayId == null) continue;
    let loserId = null;
    if (homeWinner === true && awayWinner === false) loserId = awayId;
    else if (awayWinner === true && homeWinner === false) loserId = homeId;
    else {
      const st = String(status || '').toLowerCase();
      if (st === 'post' || st === 'final' || st === 'completed') {
        if (homeScore != null && awayScore != null && !Number.isNaN(homeScore) && !Number.isNaN(awayScore)) {
          if (homeScore < awayScore) loserId = homeId;
          else if (awayScore < homeScore) loserId = awayId;
        }
      }
    }
    if (loserId == null) continue;
    const lk = String(loserId);
    if (out[lk] == null) out[lk] = round;
  }
  return out;
}

/**
 * Fetches player stats for one game (GOAT tier). Returns array of { player_id, pts }.
 * Uses /player_stats with game_ids (or single game_id) per BallDontLie NCAAB.
 */
async function fetchPlayerStatsForGame(apiKey, gameId) {
  try {
    const data = await bdlFetch(apiKey, '/player_stats', { game_ids: [gameId] });
    const list = data.data ?? [];
    if (!Array.isArray(list)) return [];
    return list.map((row) => {
      const playerId = row.player?.id ?? row.player_id;
      const pts = row.pts != null ? Number(row.pts) : 0;
      return { playerId, pts };
    }).filter((r) => r.playerId != null);
  } catch (e) {
    console.warn('player_stats for game', gameId, e.message);
    return [];
  }
}

/**
 * Builds scores (rounds 1–6 per existing grid) and teamEliminatedAfterRound from bracket winners.
 * Fetches bracket round_id 1–7 for elimination; player stats only for games in rounds 1–6.
 */
async function buildScores(apiKey, season = BRACKET_SEASON) {
  const allGamesDetail = [];
  for (let roundId = 1; roundId <= 7; roundId++) {
    const bracketRes = await fetchBracket(apiKey, season, roundId);
    const games = parseBracketAllGamesDetail(bracketRes, roundId);
    games.forEach((g) => allGamesDetail.push(g));
    await new Promise((r) => setTimeout(r, 120));
  }
  const teamEliminatedAfterRound = buildTeamEliminationMap(allGamesDetail);
  const scores = {};
  const statsDone = new Set();
  for (const g of allGamesDetail) {
    if (g.round > 6) continue;
    if (statsDone.has(g.gameId)) continue;
    statsDone.add(g.gameId);
    const rows = await fetchPlayerStatsForGame(apiKey, g.gameId);
    for (const { playerId, pts } of rows) {
      const key = String(playerId);
      if (!scores[key]) scores[key] = {};
      scores[key][String(g.round)] = pts;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { scores, teamEliminatedAfterRound };
}

async function runImport(bucket, contestId, apiKey) {
  let step = 'bracket';
  let season = BRACKET_SEASON;
  console.log('Import started', { contestId, season });
  try {
    // Fetch round 0 (play-in) and round 1 so we get First Four + 32 games / all teams.
    const bracketRes = await fetchBracketRound0And1All(apiKey, season);
    const { teamIds: bracketTeamIds, teamMap, teamIdToSeed, teamIdToBracketLocation } = parseBracketRound1(bracketRes);
    if (!bracketTeamIds.length) {
      throw new Error('No round 1 teams found in bracket response');
    }
    console.log('Bracket round 1 teams:', bracketTeamIds.length);

    step = 'players';
    const rawPlayers = await fetchActivePlayers(apiKey, {
      teamIds: bracketTeamIds,
    });
    if (!rawPlayers.length) {
      console.warn('No active players returned for bracket teams');
    }
    const playerIds = rawPlayers.map((p) => p.id).filter(Boolean);

    step = 'season_stats';
    const seasonStatsList = await fetchPlayerSeasonStats(apiKey, playerIds, season);
    const statsByPlayerId = {};
    for (const s of seasonStatsList) {
      const id = s.player_id ?? s.player?.id;
      if (id) statsByPlayerId[id] = s;
    }

    step = 'build_pool';
    const pool = rawPlayers.map((p) => {
      const team = p.team || {};
      const teamId = team.id;
      const teamInfo = teamMap[teamId] || {
        name: team.full_name || team.college || '',
        abbreviation: team.abbreviation || '',
      };
      const stats = statsByPlayerId[p.id] || {};
      const gamesPlayed = stats.games_played ?? stats.games_started ?? null;
      const pts = stats.pts ?? stats.points ?? null;
      const min = stats.min ?? null;
      return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        name: [p.first_name, p.last_name].filter(Boolean).join(' '),
        position: p.position || null,
        team_id: teamId,
        team_name: teamInfo.name || team.full_name || '',
        team_abbreviation: teamInfo.abbreviation || team.abbreviation || '',
        region:
          teamToRegion[teamInfo.name] ||
          teamToRegion[teamInfo.abbreviation] ||
          teamToRegion[team?.full_name] ||
          teamToRegion[team?.college] ||
          null,
        seed: teamId != null ? (teamIdToSeed[teamId] ?? null) : null,
        bracket_location: teamId != null ? (teamIdToBracketLocation[teamId] ?? null) : null,
        games_played: gamesPlayed,
        games_started: stats.games_started ?? null,
        pts_per_game:
          pts != null && gamesPlayed ? Math.round((pts / gamesPlayed) * 10) / 10 : (pts ?? null),
        min_per_game: min,
        reb_per_game: stats.reb ?? null,
        ast_per_game: stats.ast ?? null,
        stl_per_game: stats.stl ?? null,
        blk_per_game: stats.blk ?? null,
        fg3m_per_game: stats.fg3m ?? null,
        ftm_per_game: stats.ftm ?? null,
      };
    });

    const finalPool = pool.filter((p) => {
      const ppg = p.pts_per_game;
      if (ppg == null) return true;
      return Number(ppg) !== 0;
    });
    const skipped = pool.length - finalPool.length;
    if (skipped) console.log('Skipped players with PPG 0.0:', skipped);

    step = 's3_put';
    const key = `contests/${contestId}/player-pool.json`;
    await putS3Json(bucket, key, finalPool);
    console.log('Import done', finalPool.length, 'players');
    return { imported: finalPool.length };
  } catch (e) {
    console.error('Import failed at step:', step, e);
    throw new Error(`Import failed at ${step}: ${e.message}`);
  }
}

exports.handler = async (event) => {
  const bucket = process.env.CONTEST_BUCKET;
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!bucket || !apiKey) {
    console.error('Missing env: CONTEST_BUCKET=' + !!bucket + ', BALLDONTLIE_API_KEY=' + !!apiKey);
    return jsonResponse({ error: 'Server configuration error: missing CONTEST_BUCKET or BALLDONTLIE_API_KEY' }, 500);
  }

  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.rawPath || event.path || event.requestContext?.http?.path || '';
  console.log('Request', method, path);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const parsed = parsePath(path);
  if (!parsed || !parsed.contestId) {
    console.log('Parse path failed', { path, normalized: path && path.trim().replace(/^\/[^/]+(?=\/contests)/, '') });
    return jsonResponse({ error: 'Not found', path }, 404);
  }

  const { contestId, resourceLower } = parsed;
  const prefix = `contests/${contestId}`;

  try {
    if (resourceLower === 'config') {
      if (method === 'GET') {
        const data = await getS3Json(bucket, `${prefix}/config.json`);
        if (!data) return jsonResponse({ error: 'Contest not found' }, 404);
        return jsonResponse(data);
      }
    }

    function shuffleArray(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    if (resourceLower === 'init-draft-order') {
      if (method === 'POST') {
        const config = await getS3Json(bucket, `${prefix}/config.json`);
        if (!config) return jsonResponse({ error: 'Contest not found' }, 404);
        const names = config.manager_names || config.managerNames;
        if (!Array.isArray(names) || names.length === 0) return jsonResponse({ error: 'No manager_names in config' }, 400);
        if (config.draftOrder && config.draftOrder.length === names.length) return jsonResponse({ error: 'Draft order already set', config }, 400);
        config.draftOrder = shuffleArray(names);
        await putS3Json(bucket, `${prefix}/config.json`, config);
        return jsonResponse(config);
      }
    }

    if (resourceLower === 'reset-draft') {
      if (method === 'POST') {
        const config = await getS3Json(bucket, `${prefix}/config.json`);
        if (!config) return jsonResponse({ error: 'Contest not found' }, 404);
        await putS3Json(bucket, `${prefix}/draft.json`, []);
        delete config.draftOrder;
        await putS3Json(bucket, `${prefix}/config.json`, config);
        return jsonResponse({ ok: true, config });
      }
    }

    if (resourceLower === 'draft-pick') {
      if (method === 'POST') {
        const body = JSON.parse(event.body || '{}');
        const managerIndex = body.managerIndex;
        const playerId = body.playerId;
        if (managerIndex == null || playerId == null) return jsonResponse({ error: 'managerIndex and playerId required' }, 400);
        const config = await getS3Json(bucket, `${prefix}/config.json`);
        if (!config) return jsonResponse({ error: 'Contest not found' }, 404);
        const numTeams = config.numTeams || 8;
        const playersPerTeam = config.playersPerTeam || 8;
        let draft = await getS3Json(bucket, `${prefix}/draft.json`);
        if (!Array.isArray(draft)) draft = [];
        if (draft.some((p) => (p.playerId ?? p.player_id) === playerId)) return jsonResponse({ error: 'Player already drafted' }, 400);
        const picksForManager = draft.filter((p) => (p.managerIndex ?? p.manager_index) === managerIndex);
        if (picksForManager.length >= playersPerTeam) return jsonResponse({ error: 'Manager already has max picks' }, 400);
        draft.push({ managerIndex: Number(managerIndex), playerId: Number(playerId) });
        await putS3Json(bucket, `${prefix}/draft.json`, draft);
        return jsonResponse({ ok: true, draft });
      }
    }

    if (resourceLower === 'draft') {
      if (method === 'GET') {
        const data = await getS3Json(bucket, `${prefix}/draft.json`);
        return jsonResponse(data ?? []);
      }
      if (method === 'PUT') {
        const body = JSON.parse(event.body || '[]');
        if (!Array.isArray(body)) return jsonResponse({ error: 'draft must be an array' }, 400);
        await putS3Json(bucket, `${prefix}/draft.json`, body);
        return jsonResponse({ ok: true });
      }
    }

    if (resourceLower === 'player-pool') {
      if (method === 'GET') {
        const data = await getS3Json(bucket, `${prefix}/player-pool.json`);
        return jsonResponse(data ?? []);
      }
    }

    if (resourceLower === 'scores') {
      if (method === 'GET') {
        const cacheKey = `${prefix}/scores.json`;
        let data = await getS3Json(bucket, cacheKey);
        if (!data || !data.scores) {
          const built = await buildScores(apiKey);
          data = {
            scores: built.scores,
            teamEliminatedAfterRound: built.teamEliminatedAfterRound,
            updatedAt: new Date().toISOString(),
          };
          await putS3Json(bucket, cacheKey, data);
        }
        return jsonResponse({
          scores: data.scores,
          teamEliminatedAfterRound: data.teamEliminatedAfterRound ?? {},
          updatedAt: data.updatedAt ?? null,
        });
      }
    }

    if (resourceLower === 'refresh-scores') {
      if (method === 'POST') {
        const built = await buildScores(apiKey);
        const data = {
          scores: built.scores,
          teamEliminatedAfterRound: built.teamEliminatedAfterRound,
          updatedAt: new Date().toISOString(),
        };
        await putS3Json(bucket, `${prefix}/scores.json`, data);
        return jsonResponse({ ok: true, updatedAt: data.updatedAt });
      }
      return jsonResponse({ error: 'Method not allowed', hint: 'Use POST (not GET) for refresh-scores' }, 405);
    }

    if (resourceLower === 'import') {
      if (method === 'POST') {
        const result = await runImport(bucket, contestId, apiKey);
        return jsonResponse(result);
      }
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (resourceLower === 'admin-login') {
      if (method === 'POST') {
        if (!adminPassword) return jsonResponse({ error: 'Admin not configured' }, 503);
        const body = JSON.parse(event.body || '{}');
        const password = body.password;
        if (password !== adminPassword) return jsonResponse({ error: 'Invalid password' }, 401);
        const token = signAdminToken(contestId, adminPassword);
        return jsonResponse({ token });
      }
    }
    if (resourceLower === 'admin-verify') {
      if (method === 'GET') {
        try {
          if (!adminPassword) return jsonResponse({ error: 'Admin not configured' }, 503);
          const headers = event.headers || {};
          const auth = (headers.authorization || headers.Authorization || '').toString();
          const token = auth.replace(/^Bearer\s+/i, '').trim();
          if (!verifyAdminToken(token, contestId, adminPassword)) return jsonResponse({ error: 'Unauthorized' }, 401);
          return jsonResponse({ ok: true });
        } catch (err) {
          console.error('admin-verify error', err);
          return jsonResponse({ error: err.message || 'Verify failed' }, 500);
        }
      }
    }

    return jsonResponse({ error: 'Not found', path }, 404);
  } catch (e) {
    console.error('Lambda error', e);
    return jsonResponse({
      error: e.message || 'Internal error',
      code: e.code || undefined,
    }, 500);
  }
};
