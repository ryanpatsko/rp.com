const crypto = require('crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { fetchTrainingSheet } = require('./scrapers/training');

const s3 = new S3Client({});
const lambda = new LambdaClient({});
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_KEY = 'health/profile.json';

const DATA_KEYS = {
  bloodwork: 'health/bloodwork/latest.json',
  garmin: 'health/garmin/latest.json',
  training: 'health/training/latest.json',
};

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

function signToken(secret) {
  const payload = JSON.stringify({ sub: 'health', exp: Date.now() + TOKEN_TTL_MS });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyToken(token, secret) {
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
  if (payload.sub !== 'health' || payload.exp < Date.now()) return false;
  return true;
}

function normalizePath(path) {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  return trimmed.replace(/^\/[^/]+(?=\/health)/, '');
}

function parseHealthPath(path) {
  const normalized = normalizePath(path);
  const match = normalized.match(/^\/health\/([^/]+)\/?$/);
  if (!match) return null;
  return { resource: match[1], resourceLower: match[1].toLowerCase() };
}

async function getS3Json(bucket, key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await res.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function putS3Json(bucket, key, data) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    })
  );
}

function requireAuth(event, password) {
  const headers = event.headers || {};
  const auth = (headers.authorization || headers.Authorization || '').toString();
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!verifyToken(token, password)) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) };
  }
  return { ok: true };
}

function profileComplete(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const { gender, age, heightIn, weightLb, activityLevel } = profile;
  return (
    gender != null &&
    String(gender).trim() !== '' &&
    age != null &&
    Number.isFinite(Number(age)) &&
    heightIn != null &&
    Number.isFinite(Number(heightIn)) &&
    weightLb != null &&
    Number.isFinite(Number(weightLb)) &&
    activityLevel != null &&
    String(activityLevel).trim() !== ''
  );
}

function normalizeProfile(body) {
  const now = new Date().toISOString();
  return {
    gender: String(body.gender || '').trim(),
    age: Number(body.age),
    heightIn: Number(body.heightIn),
    weightLb: Number(body.weightLb),
    activityLevel: String(body.activityLevel || '').trim(),
    updatedAt: now,
  };
}

async function invokeWorker(functionName, payload) {
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );
  if (res.FunctionError) {
    const errPayload = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString()) : {};
    throw new Error(errPayload.errorMessage || res.FunctionError);
  }
  const text = res.Payload ? Buffer.from(res.Payload).toString() : '{}';
  return JSON.parse(text || '{}');
}

async function scrapeTraining(bucket) {
  const csvUrl = process.env.TRAINING_SHEET_CSV_URL;
  if (!csvUrl) {
    return {
      ok: false,
      error: 'TRAINING_SHEET_CSV_URL not configured on health-api Lambda',
    };
  }
  try {
    const data = await fetchTrainingSheet(csvUrl);
    await putS3Json(bucket, DATA_KEYS.training, data);
    return { ok: true, syncedAt: data.syncedAt, entryCount: data.entryCount };
  } catch (e) {
    console.error('training scrape', e);
    return {
      ok: false,
      error: e.message || 'Training sync failed',
      code: e.code || undefined,
    };
  }
}

async function scrapeGarmin(bucket) {
  const fn = process.env.HEALTH_GARMIN_FUNCTION;
  if (!fn) {
    return { ok: false, error: 'HEALTH_GARMIN_FUNCTION not configured. Deploy health-garmin Lambda first.' };
  }
  try {
    const result = await invokeWorker(fn, { bucket });
    return result;
  } catch (e) {
    console.error('garmin invoke', e);
    return { ok: false, error: e.message || 'Garmin sync failed' };
  }
}

async function scrapeBloodwork() {
  const fn = process.env.HEALTH_BLOODWORK_FUNCTION;
  if (!fn) {
    return {
      ok: false,
      error: 'Blood work scraper not deployed yet. See health-bloodwork/README.md (Playwright Lambda).',
    };
  }
  try {
    return await invokeWorker(fn, {});
  } catch (e) {
    console.error('bloodwork invoke', e);
    return { ok: false, error: e.message || 'Blood work sync failed' };
  }
}

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const path = event.rawPath || event.path || '';
  const parsed = parseHealthPath(path);
  if (!parsed) {
    return jsonResponse({ error: 'Not found', path }, 404);
  }

  const bucket = process.env.HEALTH_BUCKET;
  const password = process.env.HEALTH_PASSWORD;
  const { resourceLower } = parsed;

  try {
    if (resourceLower === 'auth-login') {
      if (method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
      if (!password) return jsonResponse({ error: 'Health API not configured' }, 503);
      const body = JSON.parse(event.body || '{}');
      if (body.password !== password) return jsonResponse({ error: 'Invalid password' }, 401);
      return jsonResponse({ token: signToken(password) });
    }

    if (resourceLower === 'auth-verify') {
      if (method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
      if (!password) return jsonResponse({ error: 'Health API not configured' }, 503);
      const auth = requireAuth(event, password);
      if (!auth.ok) return auth.response;
      return jsonResponse({ ok: true });
    }

    if (!bucket) return jsonResponse({ error: 'HEALTH_BUCKET not configured' }, 503);
    if (!password) return jsonResponse({ error: 'Health API not configured' }, 503);

    const auth = requireAuth(event, password);
    if (!auth.ok) return auth.response;

    if (resourceLower === 'profile') {
      if (method === 'GET') {
        const profile = await getS3Json(bucket, PROFILE_KEY);
        return jsonResponse({
          profile: profile || null,
          complete: profileComplete(profile),
        });
      }
      if (method === 'PUT') {
        const body = JSON.parse(event.body || '{}');
        const profile = normalizeProfile(body);
        if (!profileComplete(profile)) {
          return jsonResponse(
            { error: 'Profile incomplete', required: ['gender', 'age', 'heightIn', 'weightLb', 'activityLevel'] },
            400
          );
        }
        await putS3Json(bucket, PROFILE_KEY, profile);
        return jsonResponse({ profile, complete: true });
      }
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (resourceLower === 'status') {
      if (method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
      const profile = await getS3Json(bucket, PROFILE_KEY);
      const keys = [
        { id: 'bloodwork', key: DATA_KEYS.bloodwork, label: 'Blood Work' },
        { id: 'garmin', key: DATA_KEYS.garmin, label: 'Fitness & Activity' },
        { id: 'training', key: DATA_KEYS.training, label: 'Training Log' },
        { id: 'nutrition', key: 'health/nutrition.json', label: 'Nutrition' },
        { id: 'supplements', key: 'health/supplements/list.json', label: 'Supplements' },
        { id: 'recovery', key: 'health/recovery.json', label: 'Recovery' },
        { id: 'goals', key: 'health/goals.json', label: 'Goals & Focus Areas' },
        { id: 'analysis', key: 'health/analysis/latest.json', label: 'AI Analysis' },
      ];
      const sections = await Promise.all(
        keys.map(async ({ id, key, label }) => {
          const data = await getS3Json(bucket, key);
          const updatedAt = data?.updatedAt || data?.syncedAt || data?.scrapedAt || null;
          const lastError = data?.lastError || null;
          return { id, label, hasData: data != null && !data?.lastError, updatedAt, lastError };
        })
      );
      return jsonResponse({
        profileComplete: profileComplete(profile),
        profileUpdatedAt: profile?.updatedAt || null,
        sections,
      });
    }

    const dataMatch = resourceLower.match(/^data-(bloodwork|garmin|training)$/);
    if (dataMatch && method === 'GET') {
      const key = DATA_KEYS[dataMatch[1]];
      const data = await getS3Json(bucket, key);
      return jsonResponse({ data });
    }

    if (method === 'POST') {
      if (resourceLower === 'scrape-training') {
        try {
          return jsonResponse(await scrapeTraining(bucket));
        } catch (e) {
          console.error('scrape-training unhandled', e);
          return jsonResponse({ ok: false, error: e.message || 'Training sync failed' });
        }
      }
      if (resourceLower === 'scrape-garmin') {
        try {
          return jsonResponse(await scrapeGarmin(bucket));
        } catch (e) {
          console.error('scrape-garmin unhandled', e);
          return jsonResponse({ ok: false, error: e.message || 'Garmin sync failed' });
        }
      }
      if (resourceLower === 'scrape-bloodwork') {
        try {
          return jsonResponse(await scrapeBloodwork());
        } catch (e) {
          console.error('scrape-bloodwork unhandled', e);
          return jsonResponse({ ok: false, error: e.message || 'Blood work sync failed' });
        }
      }
      if (resourceLower === 'scrape-all') {
        try {
          const [training, garmin, bloodwork] = await Promise.all([
            scrapeTraining(bucket),
            scrapeGarmin(bucket),
            scrapeBloodwork(),
          ]);
          return jsonResponse({ training, garmin, bloodwork });
        } catch (e) {
          console.error('scrape-all unhandled', e);
          return jsonResponse({ ok: false, error: e.message || 'Sync failed' });
        }
      }
    }

    return jsonResponse({ error: 'Not found', resource: resourceLower }, 404);
  } catch (e) {
    console.error('health-api error', e);
    return jsonResponse({ error: e.message || 'Internal error' }, 500);
  }
};
