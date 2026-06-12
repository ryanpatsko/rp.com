const BASE =
  process.env.REACT_APP_HEALTH_API_URL ||
  process.env.REACT_APP_CONTEST_API_URL ||
  'https://xj8k273vj7.execute-api.us-east-1.amazonaws.com';

const TOKEN_KEY = 'health_dashboard_token';

function stripTrailingSlash(url) {
  return url.replace(/\/$/, '');
}

const apiBase = stripTrailingSlash(BASE);

function authHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function healthLogin(password) {
  const res = await fetch(`${apiBase}/health/auth-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Login failed');
  }
  return res.json();
}

export async function healthVerify(token) {
  const res = await fetch(`${apiBase}/health/auth-verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function getProfile() {
  const res = await fetch(`${apiBase}/health/profile`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to load profile');
  }
  return res.json();
}

export async function putProfile(profile) {
  const res = await fetch(`${apiBase}/health/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to save profile');
  }
  return res.json();
}

export async function getStatus() {
  const res = await fetch(`${apiBase}/health/status`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to load status');
  }
  return res.json();
}

async function parseJsonError(res, fallback) {
  const err = await res.json().catch(() => ({ error: res.statusText }));
  throw new Error(err.error || fallback);
}

async function postScrape(path, label) {
  const res = await fetch(`${apiBase}/health/${path}`, { method: 'POST', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      body.error ||
      body.message ||
      (res.status === 500 || res.status === 502
        ? `${label} failed (Lambda error — check CloudWatch logs, Lambda timeout ≥30s, TRAINING_SHEET_CSV_URL)`
        : `${label} failed (${res.status})`);
    throw new Error(msg);
  }
  if (body.ok === false) throw new Error(body.error || `${label} failed`);
  return body;
}

export async function scrapeTraining() {
  return postScrape('scrape-training', 'Training sync');
}

export async function scrapeGarmin() {
  return postScrape('scrape-garmin', 'Garmin sync');
}

export async function scrapeBloodwork() {
  const res = await fetch(`${apiBase}/health/scrape-bloodwork`, { method: 'POST', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Blood work sync failed');
  if (body.ok === false) throw new Error(body.error || 'Blood work sync failed');
  return body;
}

export async function scrapeAll() {
  const res = await fetch(`${apiBase}/health/scrape-all`, { method: 'POST', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Sync failed');
  return body;
}

export async function getDataGarmin() {
  const res = await fetch(`${apiBase}/health/data-garmin`, { headers: authHeaders() });
  if (!res.ok) await parseJsonError(res, 'Failed to load Garmin data');
  return res.json();
}

export async function getDataTraining() {
  const res = await fetch(`${apiBase}/health/data-training`, { headers: authHeaders() });
  if (!res.ok) await parseJsonError(res, 'Failed to load training data');
  return res.json();
}

export async function getDataBloodwork() {
  const res = await fetch(`${apiBase}/health/data-bloodwork`, { headers: authHeaders() });
  if (!res.ok) await parseJsonError(res, 'Failed to load blood work');
  return res.json();
}
