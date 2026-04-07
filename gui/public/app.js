'use strict'

// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  instances:   [],   // saved instance objects
  stateMap:    {},   // id → { state, attempt, uptime }
  connectedAt: {},   // id → timestamp when bot logged in (for live uptime)
  profiles:    [],   // ['sentinel', 'trader', 'debug']
  editId:      null, // id being edited (null = add mode)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function formatUptime(ms) {
  if (ms == null || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const STATE_INFO = {
  idle:         { label: 'Idle',         icon: '○', cls: 's-idle'         },
  connecting:   { label: 'Connecting',   icon: '◑', cls: 's-connecting'   },
  connected:    { label: 'Connected',    icon: '●', cls: 's-connected'     },
  disconnected: { label: 'Disconnected', icon: '◔', cls: 's-disconnected'  },
  reconnecting: { label: 'Reconnecting', icon: '↻', cls: 's-reconnecting'  },
  stopped:      { label: 'Stopped',      icon: '■', cls: 's-stopped'       },
  failed:       { label: 'Failed',       icon: '✕', cls: 's-failed'        },
}
const si = (state) => STATE_INFO[state] || STATE_INFO.idle

// ─── Socket.io ────────────────────────────────────────────────────────────────

const socket = io()

socket.on('connect', () => {
  document.getElementById('srv-badge').textContent = '● Connected'
  document.getElementById('srv-badge').className   = 'badge badge-success'
})
socket.on('disconnect', () => {
  document.getElementById('srv-badge').textContent = '● Disconnected'
  document.getElementById('srv-badge').className   = 'badge badge-error'
})

socket.on('init', ({ instances, states, logs }) => {
  S.instances = instances
  S.stateMap  = {}

  for (const snap of states) {
    S.stateMap[snap.profile] = snap
    if (snap.state === 'connected' && snap.uptime != null) {
      S.connectedAt[snap.profile] = Date.now() - snap.uptime
    }
  }

  renderGrid()
  for (const entry of logs) appendLog(entry)
})

socket.on('stateChange', (snap) => {
  S.stateMap[snap.profile] = snap
  if (snap.state === 'connected') {
    S.connectedAt[snap.profile] = snap.uptime != null
      ? Date.now() - snap.uptime
      : Date.now()
  } else {
    delete S.connectedAt[snap.profile]
  }
  updateCard(snap.profile)
})

socket.on('botError', ({ id }) => {
  const card = document.getElementById(`c-${id}`)
  if (card) {
    card.classList.add('flash')
    card.addEventListener('animationend', () => card.classList.remove('flash'), { once: true })
  }
})

socket.on('instanceCreated', (inst) => {
  S.instances.push(inst)
  renderGrid()
})

socket.on('instanceUpdated', (inst) => {
  const idx = S.instances.findIndex(i => i.id === inst.id)
  if (idx !== -1) S.instances[idx] = inst
  updateCard(inst.id)
})

socket.on('instanceRemoved', (id) => {
  S.instances = S.instances.filter(i => i.id !== id)
  delete S.stateMap[id]
  delete S.connectedAt[id]
  renderGrid()
})

socket.on('log', appendLog)

// ─── API ──────────────────────────────────────────────────────────────────────

async function api(method, url, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res  = await fetch(url, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

// ─── Card rendering ───────────────────────────────────────────────────────────

function renderCard(inst) {
  const snap      = S.stateMap[inst.id] || { state: 'idle', attempt: 0, uptime: null }
  const info      = si(snap.state)
  const isRunning = ['connecting', 'connected', 'reconnecting'].includes(snap.state)
  const canStart  = !isRunning
  const canStop   = isRunning
  const upMs      = S.connectedAt[inst.id] ? Date.now() - S.connectedAt[inst.id] : null
  const showViewer = inst.viewerEnabled && snap.state === 'connected'

  return `
    <div class="card ${info.cls}" id="c-${esc(inst.id)}">
      <div class="card-top">
        <span class="card-name" title="${esc(inst.label)}">${esc(inst.label)}</span>
        <span class="badge badge-${info.cls}">${info.icon} ${info.label}</span>
      </div>
      <div class="card-body">
        <div class="card-field"><span class="fi">👤</span>${esc(inst.username || '—')}</div>
        <div class="card-field"><span class="fi">🌐</span>${esc(inst.host)}:${inst.port}</div>
        <div class="card-field"><span class="fi">🎮</span>Template: <code>${esc(inst.profile)}</code></div>
        <div class="card-field uptime-row" data-id="${esc(inst.id)}">
          <span class="fi">⏱</span>Uptime: <span class="uptime-val">${formatUptime(upMs)}</span>
        </div>
        ${snap.attempt > 0 ? `<div class="card-field warn">⚠ Retry attempt ${snap.attempt}</div>` : ''}
      </div>
      <div class="card-actions">
        ${showViewer
          ? `<a href="http://localhost:${inst.viewerPort}" target="_blank" class="btn btn-ghost btn-sm">👁 :${inst.viewerPort}</a>`
          : `<span></span>`}
        <div class="card-btns">
          ${canStart ? `<button class="btn btn-success btn-sm" data-action="start" data-id="${esc(inst.id)}">▶ Connect</button>` : ''}
          ${canStop  ? `<button class="btn btn-warning btn-sm" data-action="stop"  data-id="${esc(inst.id)}">■ Stop</button>`    : ''}
          <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(inst.id)}" title="Edit">✎</button>
        </div>
      </div>
    </div>`
}

function renderGrid() {
  const grid  = document.getElementById('grid')
  const empty = document.getElementById('empty')
  if (S.instances.length === 0) {
    grid.innerHTML  = ''
    empty.classList.remove('hidden')
  } else {
    empty.classList.add('hidden')
    grid.innerHTML = S.instances.map(renderCard).join('')
  }
}

function updateCard(id) {
  const existing = document.getElementById(`c-${id}`)
  const inst = S.instances.find(i => i.id === id)
  if (!inst) return renderGrid()
  const tmp = document.createElement('div')
  tmp.innerHTML = renderCard(inst)
  if (existing) existing.replaceWith(tmp.firstElementChild)
  else renderGrid()
}

// Grid event delegation — handles Connect / Stop / Edit clicks
document.getElementById('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  const { action, id } = btn.dataset
  if (action === 'start') doStart(id)
  if (action === 'stop')  doStop(id)
  if (action === 'edit')  openEditModal(id)
})

// ─── Bot controls ─────────────────────────────────────────────────────────────

async function doStart(id) {
  try { await api('POST', `/api/instances/${id}/start`) }
  catch (err) { alert(`Could not connect: ${err.message}`) }
}

async function doStop(id) {
  try { await api('POST', `/api/instances/${id}/stop`) }
  catch (err) { alert(`Could not stop: ${err.message}`) }
}

// ─── Uptime ticker (every second) ─────────────────────────────────────────────

setInterval(() => {
  document.querySelectorAll('.uptime-row').forEach(row => {
    const id  = row.dataset.id
    const val = row.querySelector('.uptime-val')
    if (!val) return
    const ms = S.connectedAt[id] ? Date.now() - S.connectedAt[id] : null
    val.textContent = formatUptime(ms)
  })
}, 1000)

// ─── Log panel ────────────────────────────────────────────────────────────────

const logEl = document.getElementById('log')

function appendLog(entry) {
  const ts   = new Date(entry.ts || Date.now())
  const time = ts.toTimeString().slice(0, 8)
  const div  = document.createElement('div')
  div.className = 'log-entry'
  div.innerHTML = `<span class="log-time">${esc(time)}</span> <span class="log-msg ${entry.level || 'info'}">${esc(entry.msg)}</span>`
  logEl.appendChild(div)
  if (logEl.scrollHeight - logEl.clientHeight - logEl.scrollTop < 60) {
    logEl.scrollTop = logEl.scrollHeight
  }
  while (logEl.children.length > 150) logEl.removeChild(logEl.firstChild)
}

document.getElementById('btn-clear-log').addEventListener('click', () => { logEl.innerHTML = '' })

// ─── Modal ────────────────────────────────────────────────────────────────────

const overlay    = document.getElementById('overlay')
const modalTitle = document.getElementById('modal-title')
const form       = document.getElementById('form')
const btnSave    = document.getElementById('btn-save')
const btnDelete  = document.getElementById('btn-delete')
const btnCancel  = document.getElementById('btn-cancel')
const btnClose   = document.getElementById('btn-modal-close')
const fProfile   = document.getElementById('f-profile')
const codeEditor = document.getElementById('code-editor')
const codeSel    = document.getElementById('code-sel')
const codeStatus = document.getElementById('code-status')
const mFooter    = document.getElementById('modal-footer')

function showModal()  { overlay.classList.remove('hidden'); document.body.style.overflow = 'hidden' }
function hideModal()  { overlay.classList.add('hidden');    document.body.style.overflow = '' ; S.editId = null }

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab))
})

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name))
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('hidden', p.id !== `pane-${name}`))

  if (name === 'code') {
    mFooter.classList.add('hidden')
    const sel = fProfile.value || S.profiles[0]
    if (sel) { codeSel.value = sel; loadCode(sel) }
  } else {
    mFooter.classList.remove('hidden')
  }
}

// Profile code editor
async function loadCode(name) {
  codeStatus.textContent = ''
  codeEditor.value = 'Loading…'
  try {
    const { code } = await api('GET', `/api/profiles/${name}/code`)
    codeEditor.value = code
  } catch (err) {
    codeEditor.value = `// Error loading profile: ${err.message}`
  }
}

codeSel.addEventListener('change', () => loadCode(codeSel.value))

document.getElementById('btn-save-code').addEventListener('click', async () => {
  const name = codeSel.value
  if (!name) return
  try {
    await api('PUT', `/api/profiles/${name}/code`, { code: codeEditor.value })
    codeStatus.textContent = '✓ Saved'
    codeStatus.style.color = '#3fb950'
    setTimeout(() => { codeStatus.textContent = '' }, 3000)
  } catch (err) {
    codeStatus.textContent = `✕ ${err.message}`
    codeStatus.style.color = '#f85149'
  }
})

// Form helpers
function populateForm(inst) {
  form.elements.label.value         = inst.label        || ''
  form.elements.profile.value       = inst.profile      || (S.profiles[0] ?? '')
  form.elements.username.value      = inst.username     || ''
  form.elements.host.value          = inst.host         || 'donutsmp.net'
  form.elements.port.value          = inst.port         || 25565
  form.elements.auth.value          = inst.auth         || 'microsoft'
  form.elements.viewerEnabled.checked = inst.viewerEnabled ?? true
  form.elements.viewerPort.value    = inst.viewerPort   || 3000
  form.elements.reconnect.checked   = inst.reconnect    ?? false
}

function getFormData() {
  return {
    label:         form.elements.label.value.trim(),
    profile:       form.elements.profile.value,
    username:      form.elements.username.value.trim(),
    host:          form.elements.host.value.trim(),
    port:          Number(form.elements.port.value),
    auth:          form.elements.auth.value,
    viewerEnabled: form.elements.viewerEnabled.checked,
    viewerPort:    Number(form.elements.viewerPort.value),
    reconnect:     form.elements.reconnect.checked,
  }
}

function suggestViewerPort() {
  const used = new Set(S.instances.map(i => Number(i.viewerPort)))
  let p = 3000
  while (used.has(p)) p++
  return p
}

// Open Add modal
function openAddModal() {
  S.editId = null
  modalTitle.textContent = 'New Bot'
  btnDelete.classList.add('hidden')
  form.reset()
  form.elements.host.value          = 'donutsmp.net'
  form.elements.port.value          = '25565'
  form.elements.viewerEnabled.checked = true
  form.elements.viewerPort.value    = suggestViewerPort()
  form.elements.profile.value       = S.profiles[0] ?? ''
  switchTab('settings')
  showModal()
}

// Open Edit modal
function openEditModal(id) {
  const inst = S.instances.find(i => i.id === id)
  if (!inst) return
  S.editId = id
  modalTitle.textContent = `Edit — ${inst.label}`
  btnDelete.classList.remove('hidden')
  populateForm(inst)
  switchTab('settings')
  showModal()
}

// Save handler
btnSave.addEventListener('click', async () => {
  const data = getFormData()
  if (!data.label) return alert('Please enter a display name.')
  if (!data.username && data.auth === 'microsoft') return alert('Username/email is required for Microsoft auth.')
  if (!data.host)  return alert('Please enter a server host.')

  try {
    if (S.editId) {
      await api('PUT', `/api/instances/${S.editId}`, data)
      // socket event 'instanceUpdated' handles UI update
    } else {
      await api('POST', '/api/instances', data)
      // socket event 'instanceCreated' handles UI update
    }
    hideModal()
  } catch (err) {
    alert(`Save failed: ${err.message}`)
  }
})

// Delete handler
btnDelete.addEventListener('click', async () => {
  if (!S.editId) return
  const inst = S.instances.find(i => i.id === S.editId)
  if (!confirm(`Delete "${inst?.label}"? This will also disconnect the bot.`)) return
  try {
    await api('DELETE', `/api/instances/${S.editId}`)
    // socket event 'instanceRemoved' handles UI update
    hideModal()
  } catch (err) {
    alert(`Delete failed: ${err.message}`)
  }
})

// Close / cancel
btnCancel.addEventListener('click', hideModal)
btnClose.addEventListener('click',  hideModal)
overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModal() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideModal() })

// Add buttons
document.getElementById('btn-add').addEventListener('click',       openAddModal)
document.getElementById('btn-add-empty').addEventListener('click', openAddModal)

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    S.profiles = await api('GET', '/api/profiles')

    // Populate all profile <select> elements
    const opts = S.profiles.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')
    fProfile.innerHTML = opts
    codeSel.innerHTML  = opts
  } catch (err) {
    console.error('Init failed:', err)
  }
}

init()
