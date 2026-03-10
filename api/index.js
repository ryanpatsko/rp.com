const crypto = require('crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

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
const IMPORT_MAX_TEAMS = 10;
const IMPORT_MAX_PLAYERS = 300;
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
  const batch = playerIds.slice(0, 100);
  try {
    const data = await bdlFetch(apiKey, '/player_season_stats', {
      player_ids: batch,
      season,
    });
    return (data.data && Array.isArray(data.data)) ? data.data : [];
  } catch (e) {
    console.warn('player_season_stats not available or error:', e.message);
    return [];
  }
}

async function runImport(bucket, contestId, apiKey) {
  let step = 'teams';
  try {
    const teamsRes = await bdlFetch(apiKey, '/teams');
    const teamsList = (teamsRes.data || []).slice(0, IMPORT_MAX_TEAMS);
    const teamMap = Object.fromEntries(
      teamsList.map((t) => [t.id, { name: t.full_name || t.college, abbreviation: t.abbreviation }])
    );
    const limitedTeamIds = teamsList.map((t) => t.id);
    console.log('Teams loaded:', limitedTeamIds.length, '(max', IMPORT_MAX_TEAMS, 'teams)');

    step = 'players';
    const rawPlayers = await fetchActivePlayers(apiKey, {
      teamIds: limitedTeamIds,
      maxPlayers: IMPORT_MAX_PLAYERS,
    });
    if (!rawPlayers.length) {
      console.warn('No active players returned');
    }
    const playerIds = rawPlayers.map((p) => p.id).filter(Boolean);

    step = 'season_stats';
    const seasonStatsList = await fetchPlayerSeasonStats(apiKey, playerIds, 2025);
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
        region: null,
        seed: null,
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

    step = 's3_put';
    const key = `contests/${contestId}/player-pool.json`;
    await putS3Json(bucket, key, pool);
    console.log('Import done', pool.length, 'players');
    return { imported: pool.length };
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
