// In production (Vercel), point at your local server via VITE_API_URL.
// Leave unset when running locally — falls back to same-origin /api.
const ORIGIN = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''
const BASE = `${ORIGIN}/api`

async function _json(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); msg = j.error || msg } catch { /* */ }
    throw new Error(msg)
  }
  return res.json()
}

async function _text(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); msg = j.error || msg } catch { /* */ }
    throw new Error(msg)
  }
  return res.text()
}

export const fetchBots    = () => fetch(`${BASE}/bots`).then(_json)
export const fetchProfiles = () => fetch(`${BASE}/profiles`).then(_json)

export const startBot = (name) =>
  fetch(`${BASE}/bots/${name}/start`, { method: 'POST' }).then(_json)

export const stopBot = (name) =>
  fetch(`${BASE}/bots/${name}/stop`, { method: 'POST' }).then(_json)

export const fetchGains = (name, params = {}) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()
  return fetch(`${BASE}/bots/${name}/gains${qs ? `?${qs}` : ''}`).then(_json)
}

export const fetchBalance = (name, params = {}) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()
  return fetch(`${BASE}/bots/${name}/balance${qs ? `?${qs}` : ''}`).then(_json)
}

export const fetchLogs = (name, lines = 300) =>
  fetch(`${BASE}/bots/${name}/logs?lines=${lines}`).then(_json)

export const queryOrders = (name, opts = {}) =>
  fetch(`${BASE}/bots/${name}/query-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  }).then(_json)

export const fetchProfile = (name) =>
  fetch(`${BASE}/profiles/${name}`).then(_text)

export const saveProfile = (name, source) =>
  fetch(`${BASE}/profiles/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  }).then(_json)

export const fetchSessionEvents = (name, params = {}) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()
  return fetch(`${BASE}/bots/${name}/session-events${qs ? `?${qs}` : ''}`).then(_json)
}
