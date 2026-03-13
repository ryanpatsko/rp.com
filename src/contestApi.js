const BASE = process.env.REACT_APP_CONTEST_API_URL || 'https://xj8k273vj7.execute-api.us-east-1.amazonaws.com';

function stripTrailingSlash(url) {
  return url.replace(/\/$/, '');
}

const apiBase = stripTrailingSlash(BASE);

export async function getConfig(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/config`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getDraft(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/draft`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPlayerPool(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/player-pool`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getScores(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/scores`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function refreshScores(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/refresh-scores`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function putDraft(contestId, draft) {
  const res = await fetch(`${apiBase}/contests/${contestId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runImport(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/import`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function initDraftOrder(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/init-draft-order`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed');
  }
  return res.json();
}

export async function resetDraft(contestId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/reset-draft`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed');
  }
  return res.json();
}

export async function addDraftPick(contestId, managerIndex, playerId) {
  const res = await fetch(`${apiBase}/contests/${contestId}/draft-pick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ managerIndex, playerId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed');
  }
  return res.json();
}

function adminTokenKey(contestId) {
  return `contest_admin_token_${contestId}`;
}

export function getStoredAdminToken(contestId) {
  return localStorage.getItem(adminTokenKey(contestId));
}

export function setStoredAdminToken(contestId, token) {
  const key = adminTokenKey(contestId);
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
}

export async function adminLogin(contestId, password) {
  const res = await fetch(`${apiBase}/contests/${contestId}/admin-login`, {
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

export async function adminVerify(contestId, token) {
  const res = await fetch(`${apiBase}/contests/${contestId}/admin-verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await res.text();
  return res.ok;
}
