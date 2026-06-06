/**
 * dashboard-server.js — Caminero Bot V8.4
 * http://localhost:3001
 */

require('dotenv').config()
const http = require('http')
const fs   = require('fs')
const path = require('path')
const url  = require('url')

const PORT         = process.env.DASHBOARD_PORT || 3001
const STORAGE_DIR  = path.join(__dirname, 'storage')
const SIGNALS_FILE = path.join(STORAGE_DIR, 'signals.json')
const BASKET_FILE  = path.join(STORAGE_DIR, 'basket-state.json')
const ENV_FILE     = path.join(__dirname, '.env')

function readJSON(filepath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')) }
  catch { return fallback }
}

function readEnv() {
  try {
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n')
    const env = {}
    for (const line of lines) {
      const [key, ...rest] = line.split('=')
      if (key && !key.startsWith('#')) env[key.trim()] = rest.join('=').trim()
    }
    return env
  } catch { return {} }
}

function writeEnvKey(key, value) {
  try {
    let content = fs.readFileSync(ENV_FILE, 'utf8')
    const regex = new RegExp(`^${key}=.*`, 'm')
    if (regex.test(content)) content = content.replace(regex, `${key}=${value}`)
    else content += `\n${key}=${value}`
    fs.writeFileSync(ENV_FILE, content, 'utf8')
    return true
  } catch { return false }
}

function calcularMetricas(signals) {
  if (!signals?.length) return null
  const total   = signals.length
  const noTrade = signals.filter(s => s.action?.startsWith('NO_TRADE')).length
  const opens   = signals.filter(s => s.action?.includes('OPEN') || s.action?.includes('PAPER_OPEN')).length
  const tps     = signals.filter(s => s.action?.includes('CLOSE_TP') || s.action?.includes('TRAILING')).length
  const kills   = signals.filter(s => s.action?.includes('KILL')).length
  const errors  = signals.filter(s => s.action === 'ERROR').length
  const breakdown = {
    NO_SWEEP:      signals.filter(s => s.action === 'NO_TRADE_NO_SWEEP').length,
    NO_LIQUIDITY:  signals.filter(s => s.action === 'NO_TRADE_NO_LIQUIDITY').length,
    CVD_FAIL:      signals.filter(s => s.action === 'NO_TRADE_CVD_BTC_FAIL').length,
    SCORE_LOW:     signals.filter(s => s.action === 'NO_TRADE_SCORE_LOW').length,
    MIDDLE_RANGE:  signals.filter(s => s.action === 'NO_TRADE_BTC_MIDDLE_RANGE').length,
    ALTCOINS_FAIL: signals.filter(s => s.action === 'NO_TRADE_ALTCOINS_NOT_CONFIRMING').length,
  }
  return {
    total, noTrade, opens, tps, kills, errors,
    tpRate:   opens > 0 ? (tps / opens * 100).toFixed(1) : 0,
    killRate: opens > 0 ? (kills / opens * 100).toFixed(1) : 0,
    breakdown,
  }
}

function getLatestAltcoinScores(signals) {
  for (const s of signals) {
    if (s.altcoinScores?.length) return { scores: s.altcoinScores, sesgo: s.sesgo, ts: s.timestamp }
  }
  return null
}

function handleAPI(req, res, pathname, body) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (pathname === '/api/status') {
    const env     = readEnv()
    const signals = readJSON(SIGNALS_FILE, [])
    const last    = signals[signals.length - 1]
    return res.end(JSON.stringify({
      mode: env.BOT_MODE || 'OBSERVER',
      realTrading: env.ALLOW_REAL_TRADING === 'true',
      capital: parseFloat(env.SIMULATED_CAPITAL || 100),
      paperStart: env.PAPER_START_DATE,
      lastSignal: last?.timestamp,
      lastAction: last?.action,
      lastSesgo: last?.sesgo,
      lastBTCZone: last?.btcZone,
      lastBTCPos: last?.btcPosition,
      lastFunding: last?.fundingDaily,
      totalSignals: signals.length,
    }))
  }

  if (pathname === '/api/basket') {
    return res.end(JSON.stringify(readJSON(BASKET_FILE, { active: false, layers: [] })))
  }

  if (pathname === '/api/signals') {
    const signals = readJSON(SIGNALS_FILE, [])
    return res.end(JSON.stringify(signals.slice(-100).reverse()))
  }

  if (pathname === '/api/metrics') {
    const signals = readJSON(SIGNALS_FILE, [])
    return res.end(JSON.stringify(calcularMetricas(signals)))
  }

  if (pathname === '/api/altcoins') {
    const signals = readJSON(SIGNALS_FILE, []).reverse()
    const data    = getLatestAltcoinScores(signals)
    return res.end(JSON.stringify(data))
  }

  if (pathname === '/api/mode' && req.method === 'POST') {
    const { mode } = body
    if (!['OBSERVER', 'PAPER', 'LIVE'].includes(mode)) {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: 'Modo inválido' }))
    }
    writeEnvKey('BOT_MODE', mode)
    writeEnvKey('ALLOW_REAL_TRADING', mode === 'OBSERVER' ? 'false' : 'true')
    return res.end(JSON.stringify({ ok: true, mode }))
  }

  if (pathname === '/api/reset-basket' && req.method === 'POST') {
    const empty = { active: false, sesgo: null, openedAt: null, layers: [],
      peakPnlNet: 0, lastLayerTime: null, killSwitchActive: false }
    fs.writeFileSync(BASKET_FILE, JSON.stringify(empty, null, 2))
    return res.end(JSON.stringify({ ok: true }))
  }

  res.statusCode = 404
  res.end(JSON.stringify({ error: 'Not found' }))
}

// ── HTTP server ───────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true)
  const pathname = parsed.pathname

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.end()
  }

  if (pathname.startsWith('/api/')) {
    let rawBody = ''
    req.on('data', chunk => rawBody += chunk)
    req.on('end', () => {
      let body = {}
      try { body = rawBody ? JSON.parse(rawBody) : {} } catch {}
      handleAPI(req, res, pathname, body)
    })
    return
  }

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html')
    return res.end(getDashboardHTML())
  }

  res.statusCode = 404
  res.end('Not found')
})

// ── Dashboard HTML ────────────────────────────────────────────

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Caminero Bot V8.4</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --bg:#0a0a0f; --surface:#111118; --border:#1e1e2e;
  --accent:#00ff88; --red:#ff4466; --yellow:#ffcc00;
  --blue:#4488ff; --muted:#444466; --text:#e0e0f0; --subtext:#888899;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px;}
header{border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-family:'Syne',sans-serif;font-weight:800;font-size:17px;letter-spacing:-0.5px;}
.logo span{color:var(--accent);}
.badge{padding:3px 10px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:1px;}
.badge-observer{background:rgba(68,68,102,.3);color:var(--subtext);border:1px solid var(--muted);}
.badge-paper{background:rgba(255,204,0,.1);color:var(--yellow);border:1px solid var(--yellow);}
.badge-live{background:rgba(0,255,136,.1);color:var(--accent);border:1px solid var(--accent);}
.top-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--border);border-bottom:1px solid var(--border);}
.stat{background:var(--surface);padding:16px 20px;}
.stat-label{color:var(--subtext);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;}
.stat-value{font-family:'Syne',sans-serif;font-size:22px;font-weight:700;line-height:1;}
.stat-sub{color:var(--subtext);font-size:11px;margin-top:5px;}
.green{color:var(--accent);} .red{color:var(--red);} .yellow{color:var(--yellow);} .blue{color:var(--blue);}
.layout{display:grid;grid-template-columns:1fr 360px;gap:1px;background:var(--border);}
.panel{background:var(--surface);padding:20px;}
.panel-title{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--subtext);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;}
/* Altcoin panel */
.alt-grid{display:flex;flex-direction:column;gap:10px;}
.alt-card{background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:12px;}
.alt-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.alt-name{font-family:'Syne',sans-serif;font-weight:700;font-size:15px;}
.alt-score{font-family:'Syne',sans-serif;font-weight:700;font-size:18px;}
.progress-bar{height:6px;background:var(--border);border-radius:3px;margin-bottom:10px;overflow:hidden;}
.progress-fill{height:100%;border-radius:3px;transition:width .3s;}
.progress-green{background:var(--accent);}
.progress-yellow{background:var(--yellow);}
.progress-red{background:var(--red);}
.alt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
.alt-stat{text-align:center;}
.alt-stat-label{font-size:9px;color:var(--subtext);letter-spacing:1px;text-transform:uppercase;}
.alt-stat-val{font-size:12px;font-weight:600;margin-top:2px;}
.alt-missing{font-size:10px;color:var(--red);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);}
/* Señales */
.signals-table{width:100%;border-collapse:collapse;font-size:11px;}
.signals-table th{text-align:left;color:var(--subtext);font-size:9px;letter-spacing:1px;text-transform:uppercase;padding:0 10px 8px 0;border-bottom:1px solid var(--border);}
.signals-table td{padding:8px 10px 8px 0;border-bottom:1px solid rgba(30,30,46,.5);vertical-align:middle;}
.chip{padding:2px 7px;border-radius:2px;font-size:9px;font-weight:700;white-space:nowrap;}
.chip-open{background:rgba(0,255,136,.1);color:var(--accent);}
.chip-close{background:rgba(68,136,255,.1);color:var(--blue);}
.chip-kill{background:rgba(255,68,102,.1);color:var(--red);}
.chip-notrade{background:rgba(68,68,102,.1);color:var(--muted);}
.chip-paper{background:rgba(255,204,0,.1);color:var(--yellow);}
.chip-scan{background:rgba(68,68,102,.05);color:rgba(136,136,153,.5);font-size:8px;}
/* Sidebar */
.sidebar{display:flex;flex-direction:column;gap:1px;background:var(--border);}
.breakdown-item{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(30,30,46,.4);font-size:11px;}
.breakdown-label{color:var(--subtext);}
.btn{width:100%;padding:9px 14px;border:1px solid var(--border);border-radius:3px;background:transparent;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;cursor:pointer;text-align:left;transition:all .15s;}
.btn:hover{background:var(--border);}
.btn-observer.active,.btn-observer:hover{background:rgba(68,68,102,.2);border-color:var(--muted);color:var(--text);}
.btn-paper{border-color:var(--yellow);color:var(--yellow);}
.btn-paper.active,.btn-paper:hover{background:rgba(255,204,0,.1);}
.btn-live{border-color:var(--accent);color:var(--accent);}
.btn-live.active,.btn-live:hover{background:rgba(0,255,136,.1);}
.btn-danger{border-color:var(--red);color:var(--red);font-size:10px;margin-top:8px;}
.btn-danger:hover{background:rgba(255,68,102,.1);}
.mode-buttons{display:flex;flex-direction:column;gap:6px;}
.pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-right:7px;animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}
.ts{color:var(--subtext);font-size:10px;}
.reason-text{color:var(--subtext);font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.refresh-btn{background:transparent;border:1px solid var(--border);color:var(--subtext);font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 8px;border-radius:2px;cursor:pointer;}
.refresh-btn:hover{border-color:var(--accent);color:var(--accent);}
.toast{position:fixed;bottom:20px;right:20px;background:var(--surface);border:1px solid var(--accent);color:var(--accent);padding:10px 16px;border-radius:3px;font-size:11px;display:none;z-index:999;}
.layer-card{border:1px solid var(--border);border-radius:3px;padding:10px;margin-bottom:8px;}
.layer-kv{font-size:11px;} .layer-kv span{color:var(--subtext);}
.tab-btns{display:flex;gap:1px;background:var(--border);margin-bottom:16px;}
.tab-btn{flex:1;padding:8px;background:var(--bg);border:none;color:var(--subtext);font-family:'JetBrains Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:.5px;}
.tab-btn.active{background:var(--surface);color:var(--text);}
.tab-content{display:none;} .tab-content.active{display:block;}
</style>
</head>
<body>
<header>
  <div class="logo"><span>Caminero</span> Bot V8.4</div>
  <div style="display:flex;align-items:center;gap:10px;">
    <span id="last-cycle" class="ts"></span>
    <button class="refresh-btn" onclick="loadAll()">↻</button>
    <span id="mode-badge" class="badge badge-observer">OBSERVER</span>
  </div>
</header>

<div class="top-grid">
  <div class="stat">
    <div class="stat-label">BTC Precio</div>
    <div class="stat-value green" id="btc-price">—</div>
    <div class="stat-sub" id="btc-zone">—</div>
  </div>
  <div class="stat">
    <div class="stat-label">Sesgo</div>
    <div class="stat-value" id="btc-sesgo">—</div>
    <div class="stat-sub" id="btc-pos">Posición: —</div>
  </div>
  <div class="stat">
    <div class="stat-label">Funding BTC/día</div>
    <div class="stat-value" id="btc-funding">—</div>
    <div class="stat-sub">Diario</div>
  </div>
  <div class="stat">
    <div class="stat-label">Señales</div>
    <div class="stat-value blue" id="total-signals">—</div>
    <div class="stat-sub" id="opens-count">Aperturas: —</div>
  </div>
  <div class="stat">
    <div class="stat-label">Capital</div>
    <div class="stat-value yellow" id="capital">—</div>
    <div class="stat-sub" id="canasta-info">Canasta: —</div>
  </div>
</div>

<div class="layout">
  <!-- Panel izquierdo: tabs -->
  <div class="panel">
    <div class="tab-btns">
      <button class="tab-btn active" onclick="showTab('signals')">Señales</button>
      <button class="tab-btn" onclick="showTab('altcoins')">Altcoins</button>
    </div>

    <!-- Tab Señales -->
    <div id="tab-signals" class="tab-content active">
      <div class="panel-title">
        <span><span class="pulse"></span>Historial</span>
        <span id="signals-count" class="ts"></span>
      </div>
      <div style="overflow-x:auto;">
        <table class="signals-table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Acción</th>
              <th>Symbol</th>
              <th>Sesgo</th>
              <th>Zona</th>
              <th>Score</th>
              <th>Razón</th>
            </tr>
          </thead>
          <tbody id="signals-tbody">
            <tr><td colspan="7" style="color:var(--subtext);padding:16px 0;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab Altcoins -->
    <div id="tab-altcoins" class="tab-content">
      <div class="panel-title">
        <span>Evaluación de Altcoins</span>
        <span id="alt-scan-time" class="ts"></span>
      </div>
      <div style="margin-bottom:12px;font-size:11px;color:var(--subtext);">
        Score mínimo para operar: <span style="color:var(--accent);font-weight:700;">75/100</span>
        &nbsp;|&nbsp; Sesgo actual: <span id="alt-sesgo" style="font-weight:700;">—</span>
      </div>
      <div class="alt-grid" id="altcoin-grid">
        <div style="color:var(--subtext);text-align:center;padding:20px;">Sin datos de scan aún. Espera el próximo ciclo.</div>
      </div>
    </div>
  </div>

  <!-- Sidebar -->
  <div class="sidebar">

    <!-- Canasta -->
    <div class="panel">
      <div class="panel-title">Canasta Activa</div>
      <div id="basket-content">
        <div style="color:var(--subtext);text-align:center;padding:16px 0;font-size:12px;">Sin posiciones abiertas</div>
      </div>
    </div>

    <!-- Métricas -->
    <div class="panel">
      <div class="panel-title">Métricas</div>
      <div id="metrics-content">
        <div style="color:var(--subtext);text-align:center;padding:12px 0;font-size:12px;">Sin datos</div>
      </div>
    </div>

    <!-- Controles -->
    <div class="panel">
      <div class="panel-title">Controles</div>
      <div class="mode-buttons">
        <button class="btn btn-observer" id="btn-observer" onclick="setMode('OBSERVER')">◎ OBSERVER</button>
        <button class="btn btn-paper"    id="btn-paper"    onclick="setMode('PAPER')">◈ PAPER — Finandy real</button>
        <button class="btn btn-live"     id="btn-live"     onclick="setMode('LIVE')">◉ LIVE</button>
        <button class="btn btn-danger"   onclick="resetBasket()">⚠ Reset canasta</button>
      </div>
      <p style="color:var(--subtext);font-size:10px;margin-top:10px;line-height:1.5;">
        Cambiar modo requiere reiniciar el bot.
      </p>
    </div>

  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = 'http://localhost:3001/api'

function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tab-' + name).classList.add('active')
  event.target.classList.add('active')
}

function showToast(msg, ok = true) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.borderColor = ok ? 'var(--accent)' : 'var(--red)'
  t.style.color = ok ? 'var(--accent)' : 'var(--red)'
  t.style.display = 'block'
  setTimeout(() => t.style.display = 'none', 3000)
}

function chipClass(action) {
  if (!action) return 'chip-notrade'
  if (action === 'MARKET_SCAN') return 'chip-scan'
  if (action.includes('OPEN') && action.includes('PAPER')) return 'chip-paper'
  if (action.includes('OPEN') || action.includes('LAYER')) return 'chip-open'
  if (action.includes('CLOSE') || action.includes('TP') || action.includes('TRAILING')) return 'chip-close'
  if (action.includes('KILL')) return 'chip-kill'
  return 'chip-notrade'
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleTimeString('es-DO', {hour:'2-digit',minute:'2-digit',second:'2-digit'})
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('es-DO',{month:'short',day:'numeric'}) + ' ' + fmtTime(ts)
}

function progressColor(score, min = 75) {
  const pct = score / 100
  if (score >= min)  return 'progress-green'
  if (score >= min * 0.85) return 'progress-yellow'
  return 'progress-red'
}

function scoreColor(score, min = 75) {
  if (score >= min)       return 'green'
  if (score >= min * 0.85) return 'yellow'
  return 'red'
}

function getMissing(s) {
  const issues = []
  const d = s.detalle || {}
  if (d.corrVal !== null && d.corrVal < 0.60) issues.push('Correlación baja (' + (d.corrVal||0).toFixed(2) + ')')
  if (d.corrVal !== null && d.corrVal >= 0.60 && d.corrVal < 0.80) issues.push('Correlación media')
  if (s.descartado && s.razonDesc) issues.push(s.razonDesc)
  const faltam = 75 - (s.subtotal || 0)
  if (faltam > 0 && !s.descartado) issues.push('Faltan ' + faltam + ' pts para el mínimo')
  return issues
}

async function loadStatus() {
  try {
    const r = await fetch(API + '/status')
    const d = await r.json()
    const mode = d.mode || 'OBSERVER'
    const badge = document.getElementById('mode-badge')
    badge.textContent = mode
    badge.className = 'badge badge-' + mode.toLowerCase()

    document.getElementById('btc-zone').textContent = d.lastBTCZone ? 'Zona: ' + d.lastBTCZone : '—'
    document.getElementById('btc-pos').textContent  = d.lastBTCPos  ? 'Pos: ' + (d.lastBTCPos*100).toFixed(1)+'%' : '—'
    document.getElementById('capital').textContent  = '$' + d.capital + ' USDT'
    document.getElementById('total-signals').textContent = d.totalSignals || 0
    document.getElementById('canasta-info').textContent  = 'Canasta: $' + (d.capital * 0.4).toFixed(2)
    document.getElementById('last-cycle').textContent    = d.lastSignal ? fmtTime(d.lastSignal) : ''

    if (d.lastFunding !== null && d.lastFunding !== undefined) {
      const f = parseFloat(d.lastFunding)
      const el = document.getElementById('btc-funding')
      el.textContent = (f >= 0 ? '+' : '') + (f*100).toFixed(4) + '%'
      el.className   = 'stat-value ' + (f > 0 ? 'red' : f < 0 ? 'green' : '')
    }

    ;['observer','paper','live'].forEach(m => {
      const btn = document.getElementById('btn-' + m)
      if (btn) btn.classList.toggle('active', mode.toLowerCase() === m)
    })
  } catch(e) { console.error('status', e) }
}

async function loadSignals() {
  try {
    const r = await fetch(API + '/signals')
    const signals = await r.json()
    document.getElementById('signals-count').textContent = signals.length + ' señales'

    const last = signals[0]
    if (last) {
      document.getElementById('btc-sesgo').textContent = last.sesgo || '—'
      document.getElementById('btc-sesgo').className =
        'stat-value ' + (last.sesgo === 'LONG' ? 'green' : last.sesgo === 'SHORT' ? 'red' : '')
    }

    const opens = signals.filter(s => s.action?.includes('OPEN')).length
    document.getElementById('opens-count').textContent = 'Aperturas: ' + opens

    const tbody = document.getElementById('signals-tbody')
    tbody.innerHTML = signals.slice(0, 60).map(s => \`
      <tr>
        <td class="ts">\${fmtDateTime(s.timestamp)}</td>
        <td><span class="chip \${chipClass(s.action)}">\${s.action || '—'}</span></td>
        <td>\${s.symbol?.replace('USDT','') || '—'}</td>
        <td class="\${s.sesgo==='LONG'?'green':s.sesgo==='SHORT'?'red':''}">\${s.sesgo || '—'}</td>
        <td>\${s.btcZone || '—'}</td>
        <td>\${s.score || '—'}</td>
        <td class="reason-text" title="\${s.reason||''}">\${s.reason || '—'}</td>
      </tr>
    \`).join('')
  } catch(e) { console.error('signals', e) }
}

async function loadAltcoins() {
  try {
    const r = await fetch(API + '/altcoins')
    const data = await r.json()
    const grid = document.getElementById('altcoin-grid')

    if (!data?.scores?.length) {
      grid.innerHTML = '<div style="color:var(--subtext);text-align:center;padding:20px;">Sin datos de scan aún.</div>'
      return
    }

    document.getElementById('alt-scan-time').textContent = 'Última scan: ' + fmtTime(data.ts)
    document.getElementById('alt-sesgo').textContent     = data.sesgo || '—'
    document.getElementById('alt-sesgo').className       =
      data.sesgo === 'LONG' ? 'green' : data.sesgo === 'SHORT' ? 'red' : ''

    const MIN = 75
    const sorted = [...data.scores].sort((a,b) => (b.subtotal||0) - (a.subtotal||0))

    grid.innerHTML = sorted.map((s, i) => {
      const score   = s.subtotal || 0
      const pct     = Math.min(100, (score / 100) * 100)
      const barCls  = progressColor(score, MIN)
      const scoreCls = scoreColor(score, MIN)
      const missing = getMissing(s)
      const d = s.detalle || {}
      const rank = s.fuerza ? '#' + (i+1) : '—'

      return \`
        <div class="alt-card">
          <div class="alt-header">
            <div class="alt-name">\${s.symbol.replace('USDT','')}</div>
            <div class="alt-score \${scoreCls}">\${score}<span style="font-size:12px;color:var(--subtext);">/100</span></div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill \${barCls}" style="width:\${pct}%;"></div>
          </div>
          <div class="alt-stats">
            <div class="alt-stat">
              <div class="alt-stat-label">Rank</div>
              <div class="alt-stat-val \${i===0?'green':''}">\${rank}</div>
            </div>
            <div class="alt-stat">
              <div class="alt-stat-label">Corr</div>
              <div class="alt-stat-val \${d.corrVal>=0.8?'green':d.corrVal>=0.6?'yellow':'red'}">\${d.corrVal!=null?(d.corrVal).toFixed(2):'—'}</div>
            </div>
            <div class="alt-stat">
              <div class="alt-stat-label">Liq</div>
              <div class="alt-stat-val">\${d.liquidez!=null?d.liquidez+'pt':'—'}</div>
            </div>
            <div class="alt-stat">
              <div class="alt-stat-label">Fund</div>
              <div class="alt-stat-val">\${d.funding!=null?d.funding+'pt':'—'}</div>
            </div>
          </div>
          \${missing.length ? \`<div class="alt-missing">⚠ \${missing[0]}</div>\` : \`<div style="font-size:10px;color:var(--accent);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">✓ Cumple requisitos</div>\`}
        </div>
      \`
    }).join('')
  } catch(e) { console.error('altcoins', e) }
}

async function loadBasket() {
  try {
    const r = await fetch(API + '/basket')
    const basket = await r.json()
    const el = document.getElementById('basket-content')

    if (!basket.active || !basket.layers?.length) {
      el.innerHTML = '<div style="color:var(--subtext);text-align:center;padding:12px 0;font-size:11px;">Sin posiciones abiertas</div>'
      return
    }

    el.innerHTML = basket.layers.map(l => \`
      <div class="layer-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-family:'Syne',sans-serif;font-weight:700;">\${l.symbol?.replace('USDT','')}</span>
          <span class="badge \${l.sesgo==='LONG'?'badge-paper':'badge-observer'}">\${l.sesgo} C\${l.capa}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <div class="layer-kv"><span>Entrada: </span>$\${parseFloat(l.entryPrice||0).toFixed(4)}</div>
          <div class="layer-kv"><span>Capital: </span>$\${parseFloat(l.capital||0).toFixed(2)}</div>
          <div class="layer-kv"><span>Funding: </span>\${((l.fundingPaid||0)*100).toFixed(4)}%</div>
          <div class="layer-kv"><span>Apertura: </span>\${fmtTime(l.openedAt)}</div>
        </div>
      </div>
    \`).join('')
  } catch(e) { console.error('basket', e) }
}

async function loadMetrics() {
  try {
    const r = await fetch(API + '/metrics')
    const m = await r.json()
    const el = document.getElementById('metrics-content')
    if (!m) { el.innerHTML = '<div style="color:var(--subtext);font-size:11px;">Sin datos suficientes</div>'; return }
    const bk = m.breakdown || {}
    el.innerHTML = \`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div><div class="stat-label">Tasa TP</div><div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;color:var(--accent);">\${m.tpRate}%</div></div>
        <div><div class="stat-label">Tasa Kill</div><div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;color:var(--red);">\${m.killRate}%</div></div>
      </div>
      <div class="breakdown-item"><span class="breakdown-label">Total</span><span>\${m.total}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Sin operar</span><span>\${m.noTrade}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Aperturas</span><span class="green">\${m.opens}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">TP cerrados</span><span class="blue">\${m.tps}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Kill switch</span><span class="red">\${m.kills}</span></div>
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--subtext);margin-bottom:8px;">POR QUÉ NO OPERÓ</div>
      <div class="breakdown-item"><span class="breakdown-label">Sin barrida</span><span>\${bk.NO_SWEEP||0}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Rango medio</span><span>\${bk.MIDDLE_RANGE||0}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Sin liquidez</span><span>\${bk.NO_LIQUIDITY||0}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">CVD fallido</span><span>\${bk.CVD_FAIL||0}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Score bajo</span><span>\${bk.SCORE_LOW||0}</span></div>
      <div class="breakdown-item"><span class="breakdown-label">Altcoins</span><span>\${bk.ALTCOINS_FAIL||0}</span></div>
    \`
  } catch(e) { console.error('metrics', e) }
}

async function setMode(mode) {
  if (!confirm('¿Cambiar a modo ' + mode + '?\\nRecuerda reiniciar el bot.')) return
  try {
    const r = await fetch(API + '/mode', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({mode})
    })
    const d = await r.json()
    if (d.ok) { showToast('Modo → ' + mode + '. Reinicia el bot.'); loadStatus() }
  } catch(e) { showToast('Error: ' + e.message, false) }
}

async function resetBasket() {
  if (!confirm('¿Resetear la canasta?')) return
  try {
    await fetch(API + '/reset-basket', {method:'POST'})
    showToast('Canasta reseteada')
    loadBasket()
  } catch(e) { showToast('Error', false) }
}

async function loadAll() {
  await Promise.all([loadStatus(), loadSignals(), loadAltcoins(), loadBasket(), loadMetrics()])
}

loadAll()
setInterval(loadAll, 30000)
</script>
</body>
</html>`
}

server.listen(PORT, () => {
  console.log(`\n  Caminero Bot V8.4 — Dashboard`)
  console.log(`  → http://localhost:${PORT}`)
  console.log(`  Ctrl+C para detener\n`)
})
