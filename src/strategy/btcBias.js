/**
 * btcBias.js — Sprint 2
 * Calcula la posición de BTC en el rango de 5 días
 * y determina el sesgo direccional del mercado.
 *
 * Retorna: { sesgo, position, high5d, low5d, price, zone }
 * sesgo: 'LONG' | 'SHORT' | 'NO_OPERAR'
 */

const { getKlines }                    = require('../data/binanceClient')
const { parseCandles, getHigh, getLow, getLatest } = require('../utils/candles')
const CONFIG                           = require('../config')

async function analizarBTC() {
  // 120 velas 1H = 5 días exactos
  const raw     = await getKlines(CONFIG.patron, '1h', CONFIG.intervals.lookback1h)
  const candles = parseCandles(raw)

  const high5d  = getHigh(candles)
  const low5d   = getLow(candles)
  const price   = getLatest(candles).close
  const rango   = high5d - low5d

  if (rango === 0) {
    return { sesgo: 'NO_OPERAR', reason: 'Rango cero', position: 0.5, high5d, low5d, price }
  }

  const position = (price - low5d) / rango

  // FIX: bordes estrictos < y > (sin solapamiento)
  let sesgo, zone, reason

  if (position < CONFIG.btcBias.longZona) {
    sesgo  = 'LONG'
    zone   = 'BAJA'
    reason = `BTC en zona baja (${(position * 100).toFixed(1)}% del rango)`
  } else if (position > CONFIG.btcBias.shortZona) {
    sesgo  = 'SHORT'
    zone   = 'ALTA'
    reason = `BTC en zona alta (${(position * 100).toFixed(1)}% del rango)`
  } else {
    sesgo  = 'NO_OPERAR'
    zone   = 'MEDIA'
    reason = `BTC en zona media (${(position * 100).toFixed(1)}% del rango) — no operar`
  }

  return { sesgo, zone, reason, position, high5d, low5d, price, rango }
}

module.exports = { analizarBTC }
