/**
 * finandyWebhook.js
 * Envía señales reales a Finandy via webhook.
 *
 * Hook 327224 — My server
 * URL:    https://hook.finandy.com/BlJpVw2Tp4g29JKrrlUK
 * Secret: desde .env → FINANDY_SECRET
 *
 * Payloads confirmados:
 * Abrir LONG:   { name, secret, symbol, side: "buy" }
 * Abrir SHORT:  { name, secret, symbol, side: "sell" }
 * Cerrar:       { name, secret, symbol, side: "sell"/"buy", positionSide: "flat" }
 */

require('dotenv').config()
const fetch = require('node-fetch')

const WEBHOOK_URL   = process.env.FINANDY_WEBHOOK_URL || ''
const FINANDY_NAME  = process.env.FINANDY_BOT_NAME   || 'Hook 327224'
const SECRET        = process.env.FINANDY_SECRET      || ''
const ALLOW_REAL    = process.env.ALLOW_REAL_TRADING  === 'true'

// ── Enviar señal a Finandy ───────────────────────────────────

async function enviarSenal(payload) {
  if (!ALLOW_REAL) {
    console.log(`  [FINANDY MOCK] ${JSON.stringify(payload)}`)
    return { mock: true, payload }
  }

  if (!WEBHOOK_URL || !SECRET) {
    throw new Error('FINANDY_WEBHOOK_URL o FINANDY_SECRET no configurados en .env')
  }

  const body = JSON.stringify(payload)

  const res = await fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(`Finandy HTTP ${res.status}: ${text}`)
  }

  console.log(`  [FINANDY] Señal enviada: ${payload.side} ${payload.symbol} | resp: ${text}`)
  return { ok: true, status: res.status, response: text }
}

// ── Abrir posición LONG ──────────────────────────────────────

async function abrirLong(symbol) {
  return enviarSenal({
    name:    FINANDY_NAME,
    secret:  SECRET,
    symbol:  symbol.replace('USDT', '') + 'USDT',  // normalizar
    side:    'buy',
  })
}

// ── Abrir posición SHORT ─────────────────────────────────────

async function abrirShort(symbol) {
  return enviarSenal({
    name:    FINANDY_NAME,
    secret:  SECRET,
    symbol:  symbol.replace('USDT', '') + 'USDT',
    side:    'sell',
  })
}

// ── Cerrar posición ──────────────────────────────────────────

async function cerrarPosicion(symbol, sesgo) {
  // Para cerrar LONG enviar side: "sell" + positionSide: "flat"
  // Para cerrar SHORT enviar side: "buy" + positionSide: "flat"
  return enviarSenal({
    name:         FINANDY_NAME,
    secret:       SECRET,
    symbol:       symbol.replace('USDT', '') + 'USDT',
    side:         sesgo === 'LONG' ? 'sell' : 'buy',
    positionSide: 'flat',
  })
}

// ── Test de conectividad ─────────────────────────────────────

async function testConexion() {
  console.log(`  [FINANDY] Testing webhook...`)
  console.log(`  URL:    ${WEBHOOK_URL}`)
  console.log(`  Name:   ${FINANDY_NAME}`)
  console.log(`  Mode:   ${ALLOW_REAL ? 'REAL' : 'MOCK'}`)

  if (!ALLOW_REAL) {
    console.log(`  [FINANDY] Modo MOCK activo — no se envían órdenes reales`)
    return { mock: true }
  }

  // Enviar señal de test (Finandy tiene endpoint de test)
  const res = await fetch(WEBHOOK_URL.replace('/hook/', '/hook/test/'), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: FINANDY_NAME, secret: SECRET }),
  })

  return { status: res.status, ok: res.ok }
}

module.exports = { abrirLong, abrirShort, cerrarPosicion, testConexion, enviarSenal }
