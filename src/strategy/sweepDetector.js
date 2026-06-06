/**
 * sweepDetector.js — V2
 * Cambios aplicados según revisión estratégica:
 *
 * sweepLookbackCandles = 8   (antes 5 — ventana 2H)
 * minWickPct           = 0.30 (antes 0.40 — más flexible)
 * maxDistanceFromSweep = 0.008 (nuevo — precio no puede estar > 0.8% lejos)
 *
 * Lógica:
 * 8 velas + 30% mecha + volumen + precio aún cerca de la zona = entrada válida
 */

const { getKlines }                             = require('../data/binanceClient')
const { parseCandles, getLatest,
        getMechaInferior, getMechaSuperior,
        getAverageVolume }                      = require('../utils/candles')
const { distancePct }                           = require('../utils/math')
const CONFIG                                    = require('../config')

const SWEEP_LOOKBACK          = 8      // velas de 15m = 2 horas
const MIN_WICK                = 0.30   // mecha mínima 30%
const MAX_DISTANCE_FROM_SWEEP = 0.008  // precio actual max 0.8% lejos de la zona barrida

// ── Evaluar vela LONG ────────────────────────────────────────

function evaluarVelaLong(candle, zonaLevel, avgVolumen, precioActual) {
  const { low, close, volume } = candle

  // 1. Low rompe zona al menos 0.2%
  const ruptura = (zonaLevel - low) / zonaLevel
  if (ruptura < CONFIG.sweep.breakMin) {
    return { valid: false, reason: `Ruptura insuficiente: ${(ruptura*100).toFixed(3)}% < 0.2%` }
  }

  // 2. Cierre vuelve encima de la zona
  if (close <= zonaLevel) {
    return { valid: false, reason: `Cierre no recuperó zona: ${close.toFixed(1)} <= ${zonaLevel.toFixed(1)}` }
  }

  // 3. Mecha inferior >= 30%
  const mecha = getMechaInferior(candle)
  if (mecha < MIN_WICK) {
    return { valid: false, reason: `Mecha inferior insuficiente: ${(mecha*100).toFixed(1)}% < 30%` }
  }

  // 4. Volumen >= 1.5x promedio
  const volRatio = avgVolumen > 0 ? volume / avgVolumen : 0
  if (volRatio < CONFIG.sweep.volumeMultiplier) {
    return { valid: false, reason: `Volumen bajo: ${volRatio.toFixed(2)}x < 1.5x` }
  }

  // 5. NUEVO: precio actual sigue cerca de la zona barrida (max 0.8% arriba)
  const distDesdeZona = (precioActual - zonaLevel) / zonaLevel
  if (distDesdeZona > MAX_DISTANCE_FROM_SWEEP) {
    return {
      valid: false,
      reason: `Precio se alejó demasiado: ${(distDesdeZona*100).toFixed(2)}% > 0.8% de la zona`
    }
  }

  return {
    valid:    true,
    reason:   'Barrida LONG confirmada',
    ruptura:  parseFloat(ruptura.toFixed(4)),
    mecha:    parseFloat(mecha.toFixed(4)),
    volRatio: parseFloat(volRatio.toFixed(3)),
    distDesdeZona: parseFloat(distDesdeZona.toFixed(4)),
    sweepLow: low,
    zonaLevel,
  }
}

// ── Evaluar vela SHORT ───────────────────────────────────────

function evaluarVelaShort(candle, zonaLevel, avgVolumen, precioActual) {
  const { high, close, volume } = candle

  // 1. High rompe zona al menos 0.2%
  const ruptura = (high - zonaLevel) / zonaLevel
  if (ruptura < CONFIG.sweep.breakMin) {
    return { valid: false, reason: `Ruptura insuficiente: ${(ruptura*100).toFixed(3)}% < 0.2%` }
  }

  // 2. Cierre vuelve debajo de la zona
  if (close >= zonaLevel) {
    return { valid: false, reason: `Cierre no perdió zona: ${close.toFixed(1)} >= ${zonaLevel.toFixed(1)}` }
  }

  // 3. Mecha superior >= 30%
  const mecha = getMechaSuperior(candle)
  if (mecha < MIN_WICK) {
    return { valid: false, reason: `Mecha superior insuficiente: ${(mecha*100).toFixed(1)}% < 30%` }
  }

  // 4. Volumen >= 1.5x promedio
  const volRatio = avgVolumen > 0 ? volume / avgVolumen : 0
  if (volRatio < CONFIG.sweep.volumeMultiplier) {
    return { valid: false, reason: `Volumen bajo: ${volRatio.toFixed(2)}x < 1.5x` }
  }

  // 5. NUEVO: precio actual sigue cerca de la zona barrida (max 0.8% abajo)
  const distDesdeZona = (zonaLevel - precioActual) / zonaLevel
  if (distDesdeZona > MAX_DISTANCE_FROM_SWEEP) {
    return {
      valid: false,
      reason: `Precio se alejó demasiado: ${(distDesdeZona*100).toFixed(2)}% > 0.8% de la zona`
    }
  }

  return {
    valid:     true,
    reason:    'Barrida SHORT confirmada',
    ruptura:   parseFloat(ruptura.toFixed(4)),
    mecha:     parseFloat(mecha.toFixed(4)),
    volRatio:  parseFloat(volRatio.toFixed(3)),
    distDesdeZona: parseFloat(distDesdeZona.toFixed(4)),
    sweepHigh: high,
    zonaLevel,
  }
}

// ── Función principal ────────────────────────────────────────

async function detectarBarrida(sesgo, zonaLevel, symbol = CONFIG.patron) {
  // 8 velas de 15m + 20 base para promedio de volumen
  const raw     = await getKlines(symbol, '15m', 28)
  const candles = parseCandles(raw)

  // Promedio de volumen sobre las 20 velas base
  const candlesBase = candles.slice(0, -SWEEP_LOOKBACK)
  const avgVolumen  = getAverageVolume(candlesBase, 20)

  // Precio actual
  const precioActual = candles[candles.length - 1].close

  // Buscar barrida en las últimas 8 velas (últimas 2 horas)
  const recientes = candles.slice(-SWEEP_LOOKBACK)

  for (let i = recientes.length - 1; i >= 0; i--) {
    const candle      = recientes[i]
    const minutosAtras = (recientes.length - 1 - i) * 15

    let resultado

    if (sesgo === 'LONG') {
      resultado = evaluarVelaLong(candle, zonaLevel, avgVolumen, precioActual)
    } else if (sesgo === 'SHORT') {
      resultado = evaluarVelaShort(candle, zonaLevel, avgVolumen, precioActual)
    } else {
      return { valid: false, reason: 'Sesgo inválido' }
    }

    if (resultado.valid) {
      return {
        ...resultado,
        candleTime:  new Date(candle.openTime).toISOString(),
        minutosAtras,
        avgVolumen:  parseFloat(avgVolumen.toFixed(2)),
        precioActual,
      }
    }
  }

  // Registrar la razón más reciente del fallo para debug
  const ultimaVela  = recientes[recientes.length - 1]
  let ultimaRazon   = ''

  if (sesgo === 'LONG') {
    const r = evaluarVelaLong(ultimaVela, zonaLevel, avgVolumen, precioActual)
    ultimaRazon = r.reason
  } else {
    const r = evaluarVelaShort(ultimaVela, zonaLevel, avgVolumen, precioActual)
    ultimaRazon = r.reason
  }

  return {
    valid:       false,
    reason:      `Sin barrida ${sesgo} en 8 velas 15m | Última vela: ${ultimaRazon}`,
    zonaLevel,
    avgVolumen:  parseFloat(avgVolumen.toFixed(2)),
    precioActual,
  }
}

module.exports = { detectarBarrida }
