/**
 * Format a dollar amount as a compact string.
 * e.g.  1234567 → "$1.23M"
 *        1234   → "$1.23K"
 *          12   → "$12"
 */
export function formatMoney(amount) {
  if (amount == null || isNaN(amount)) return '$0'
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`
  if (amount >= 1_000)     return `$${(amount / 1_000).toFixed(2)}K`
  return `$${amount.toFixed(0)}`
}

/**
 * Format item count with K/M suffixes.
 * e.g. 50000 → "50K"
 */
export function formatCount(n) {
  if (n == null || isNaN(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

/**
 * Format milliseconds as a human-readable uptime string.
 * e.g. 3723000 → "1h 2m 3s"
 */
export function formatUptime(ms) {
  if (!ms || ms < 0) return '–'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

/**
 * Format a Unix timestamp for chart axis labels.
 * granularity: 'hour' | 'day' | 'auto'
 */
export function formatTs(ts, granularity = 'auto') {
  const d = new Date(ts)
  if (granularity === 'hour' || granularity === 'auto') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/**
 * Format a Unix timestamp as "Apr 22 08:39".
 */
export function formatDatetime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Compute rolling $/min rate from cumulative gain events.
 * windowMs default = 5 minutes
 */
export function computeRollingRate(events, windowMs = 5 * 60_000) {
  return events.map((e, i) => {
    const windowStart = e.ts - windowMs
    let windowAmount = 0
    for (let j = i; j >= 0; j--) {
      if (events[j].ts < windowStart) break
      windowAmount += events[j].amount
    }
    const rate = windowAmount / (windowMs / 60_000)
    return { ts: e.ts, rate: parseFloat(rate.toFixed(2)) }
  })
}

/**
 * Convert a time-range key to [fromTs, toTs].
 */
export function rangeToTimestamps(range) {
  const now = Date.now()
  switch (range) {
    case 'live':  return { from: now - 60 * 60_000,       to: now }
    case 'today': {
      const sod = new Date(); sod.setHours(0, 0, 0, 0)
      return { from: sod.getTime(), to: now }
    }
    case '7d':   return { from: now - 7  * 86_400_000, to: now }
    case '30d':  return { from: now - 30 * 86_400_000, to: now }
    case 'all':  return { from: 0,                      to: now }
    default:     return { from: now - 86_400_000,       to: now }
  }
}

/**
 * Color coding for bot state strings.
 */
export const STATE_COLORS = {
  connected   : 'text-green-400',
  connecting  : 'text-yellow-400',
  reconnecting: 'text-yellow-500',
  disconnected: 'text-slate-400',
  stopped     : 'text-slate-500',
  failed      : 'text-red-500',
  idle        : 'text-slate-400',
}

export const STATE_BG = {
  connected   : 'bg-green-500/20 text-green-400 border-green-500/30',
  connecting  : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  reconnecting: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  disconnected: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  stopped     : 'bg-slate-700/20 text-slate-500 border-slate-700/30',
  failed      : 'bg-red-500/20 text-red-400 border-red-500/30',
  idle        : 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}
