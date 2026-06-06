/**
 * sweepDetector.js — Sprint 4
 * Detecta si ocurrió una barrida de liquidez válida
 * en las velas de 15m más recientes.
 *
 * LONG sweep:
 *   - Precio rompe soporte al menos 0.2%
 *   - Cierre 15m vuelve encima del soporte
 *   - Mecha inferior >= 40% del rango high-low
 *   - Volumen >= 1.5x promedio 20 velas
 *
 * SHORT sweep:
 *   - Precio rompe resistencia al menos 0.2%
 *   - Cierre 15m vuelve debajo de la resistencia
 *   - Mecha superior >= 40% del rango high-low
 *   - Volumen >= 1.5x promedio 20 velas
 */

const { getKlines }                             = require('../data/binanceClient')
const { parseCandles, getLatest,
        getMechaInferior, getMechaSuperior,
        getAverageVolume }                      = require('../utils/candles')
const CONFIG                                    = require('../config')

// ── Evaluar una sola vela contra una zona ────────────────────

function evaluarVelaLong(candle, zonaLevel, avgVolumen) {
  const { high, low, close, volume } = candle

  // 1. Low rompe la zona al menos 0.2% hacia abajo
  const ruptura = (zonaLevel - low) / zonaLevel
  if (ruptura < CONFIG.sweep.breakMin) {
    return { valid: false, reason: `Ruptura insuficiente: ${(ruptura * 100).toFixed(3)}% < 0.2%` }
  }

  // 2. Cierre vuelve encima de la zona
  if (close <= zonaLevel) {
    return { valid: false, reason: `Cierre no recupero zona: close ${close} <= nivel ${zonaLevel.toFixed(1)}` }
  }

  // 3. Mecha inferior >= 40%
  const mecha = getMechaInferior(candle)
  if (mecha < CONFIG.sweep.mechaMin) {
    return { valid: false, reason: `Mecha inferior insuficiente: ${(mecha * 100).toFixed(1)}% < 40%` }
  }

  // 4. Volumen >= 1.5x promedio
  const volRatio = avgVolumen > 0 ? volume / avgVolumen : 0
  if (volRatio < CONFIG.sweep.volumeMultiplier) {
    return { valid: false, reason: `Volumen bajo: ${volRatio.toFixed(2)}x < 1.5x` }
  }

  return {
    valid:     true,
    reason:    'Barrida LONG confirmada',
    ruptura:   parseFloat(ruptura.toFixed(4)),
    mecha:     parseFloat(mecha.toFixed(4)),
    volRatio:  parseFloat(volRatio.toFixed(3)),
    sweepLow:  low,
    zonaLevel,
  }
}

function evaluarVelaShort(candle, zonaLevel, avgVolumen) {
  const { high, low, close, volume } = candle

  // 1. High rompe la zona al menos 0.2% hacia arriba
  const ruptura = (high - zonaLevel) / zonaLevel
  if (ruptura < CONFIG.sweep.breakMin) {
    return { valid: false, reason: `Ruptura insuficiente: ${(ruptura * 100).toFixed(3)}% < 0.2%` }
  }

  // 2. Cierre vuelve debajo de la zona
  if (close >= zonaLevel) {
    return { valid: false, reason: `Cierre no perdio zona: close ${close} >= nivel ${zonaLevel.toFixed(1)}` }
  }

  // 3. Mecha superior >= 40%
  const mecha = getMechaSuperior(candle)
  if (mecha < CONFIG.sweep.mechaMin) {
    return { valid: false, reason: `Mecha superior insuficiente: ${(mecha * 100).toFixed(1)}% < 40%` }
  }

  // 4. Volumen >= 1.5x promedio
  const volRatio = avgVolumen > 0 ? volume / avgVolumen : 0
  if (volRatio < CONFIG.sweep.volumeMultiplier) {
    return { valid: false, reason: `Volumen bajo: ${volRatio.toFixed(2)}x < 1.5x` }
  }

  return {
    valid:      true,
    reason:     'Barrida SHORT confirmada',
    ruptura:    parseFloat(ruptura.toFixed(4)),
    mecha:      parseFloat(mecha.toFixed(4)),
    volRatio:   parseFloat(volRatio.toFixed(3)),
    sweepHigh:  high,
    zonaLevel,
  }
}

// ── Función principal ────────────────────────────────────────

async function detectarBarrida(sesgo, zonaLevel, symbol = CONFIG.patron) {
  // Leer últimas 25 velas de 15m
  // (20 para promedio de volumen + 5 recientes para buscar barrida)
  const raw     = await getKlines(symbol, '15m', 25)
  const candles = parseCandles(raw)

  // Promedio de volumen sobre las 20 velas anteriores (excluye las 5 más recientes)
  const candlesBase = candles.slice(0, -5)
  const avgVolumen  = getAverageVolume(candlesBase, 20)

  // Buscar barrida en las últimas 5 velas (últimas 75 minutos)
  const recientes = candles.slice(-5)

  for (let i = recientes.length - 1; i >= 0; i--) {
    const candle   = recientes[i]
    const minutosAtras = (recientes.length - 1 - i) * 15

    let resultado

    if (sesgo === 'LONG') {
      resultado = evaluarVelaLong(candle, zonaLevel, avgVolumen)
    } else if (sesgo === 'SHORT') {
      resultado = evaluarVelaShort(candle, zonaLevel, avgVolumen)
    } else {
      return { valid: false, reason: 'Sesgo invalido' }
    }

    if (resultado.valid) {
      return {
        ...resultado,
        candleTime:   new Date(candle.openTime).toISOString(),
        minutosAtras,
        avgVolumen:   parseFloat(avgVolumen.toFixed(2)),
      }
    }
  }

  // Ninguna vela reciente confirmó barrida
  return {
    valid:       false,
    reason:      `Sin barrida ${sesgo} en ultimas 5 velas de 15m`,
    zonaLevel,
    avgVolumen:  parseFloat(avgVolumen.toFixed(2)),
  }
}

module.exports = { detectarBarrida }
