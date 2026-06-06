const fs   = require('fs')
const path = require('path')

const STORAGE_DIR   = path.join(__dirname, '../../storage')
const SIGNALS_FILE  = path.join(STORAGE_DIR, 'signals.json')
const JOURNAL_FILE  = path.join(STORAGE_DIR, 'journal.csv')
const ERRORS_FILE   = path.join(STORAGE_DIR, 'errors.log')
const MAX_SIGNALS   = 1000

const CSV_HEADER =
  'timestamp,sesgo,symbol,score,btcZone,btcPosition,' +
  'liquidityLevel,liquidityDistance,sweepConfirmed,' +
  'mechaValue,volumeRatio,' +
  'cvdBTC,cvdAltcoin,' +
  'funding,fundingDaily,spread,' +
  'action,reason,result_simulated\n'

// ── Crear storage si no existe ────────────────────────────────

function ensureStorageExists() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
  }
  if (!fs.existsSync(SIGNALS_FILE)) {
    fs.writeFileSync(SIGNALS_FILE, '[]', 'utf8')
  }
  if (!fs.existsSync(JOURNAL_FILE)) {
    fs.writeFileSync(JOURNAL_FILE, CSV_HEADER, 'utf8')
  }
  if (!fs.existsSync(ERRORS_FILE)) {
    fs.writeFileSync(ERRORS_FILE, '', 'utf8')
  }
}

// ── Registrar señal ────────────────────────────────────────────

function logSignal(signal) {
  ensureStorageExists()

  const entry = {
    timestamp:           new Date().toISOString(),
    sesgo:               '',
    symbol:              '',
    score:               null,
    btcZone:             '',
    btcPosition:         null,
    liquidityLevel:      null,
    liquidityDistance:   null,
    sweepConfirmed:      false,
    mechaValue:          null,
    volumeRatio:         null,
    cvdBTC:              '',
    cvdAltcoin:          '',
    funding:             null,
    fundingDaily:        null,
    spread:              null,
    action:              'UNKNOWN',
    reason:              '',
    result_simulated:    '',
    ...signal,
  }

  // ── Append a signals.json ──────────────────────────────────
  let signals = []
  try {
    const raw = fs.readFileSync(SIGNALS_FILE, 'utf8')
    signals = JSON.parse(raw)
  } catch { signals = [] }

  signals.push(entry)
  if (signals.length > MAX_SIGNALS) signals = signals.slice(-MAX_SIGNALS)
  fs.writeFileSync(SIGNALS_FILE, JSON.stringify(signals, null, 2), 'utf8')

  // ── Append a journal.csv ───────────────────────────────────
  const row = [
    entry.timestamp,
    entry.sesgo,
    entry.symbol,
    entry.score ?? '',
    entry.btcZone,
    entry.btcPosition ?? '',
    entry.liquidityLevel ?? '',
    entry.liquidityDistance ?? '',
    entry.sweepConfirmed,
    entry.mechaValue ?? '',
    entry.volumeRatio ?? '',
    entry.cvdBTC,
    entry.cvdAltcoin,
    entry.funding ?? '',
    entry.fundingDaily ?? '',
    entry.spread ?? '',
    entry.action,
    `"${(entry.reason || '').replace(/"/g, "'")}"`,
    entry.result_simulated,
  ].join(',')

  fs.appendFileSync(JOURNAL_FILE, row + '\n', 'utf8')

  // ── Console output ─────────────────────────────────────────
  const tag = entry.action.startsWith('WOULD') ? '🎯' :
              entry.action.startsWith('NO_TRADE') ? '⏸ ' :
              entry.action === 'ERROR' ? '❌' : '📝'

  console.log(`${tag} [${entry.action}] ${entry.symbol || 'BTC'} | ${entry.reason || ''}`)
}

// ── Registrar error ────────────────────────────────────────────

function logError(context, error) {
  ensureStorageExists()

  const msg = error?.message || String(error)
  const stack = error?.stack ? `\n${error.stack}` : ''
  const line = `[${new Date().toISOString()}] [${context}] ${msg}${stack}\n`

  fs.appendFileSync(ERRORS_FILE, line, 'utf8')
  console.error(`❌ [ERROR:${context}] ${msg}`)

  logSignal({ action: 'ERROR', reason: `${context}: ${msg}` })
}

// ── Utilidad: últimas N señales de un tipo ─────────────────────

function getRecentSignals(action, limit = 50) {
  ensureStorageExists()
  try {
    const signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'))
    return signals
      .filter(s => !action || s.action === action)
      .slice(-limit)
  } catch {
    return []
  }
}

module.exports = {
  ensureStorageExists,
  logSignal,
  logError,
  getRecentSignals,
}
