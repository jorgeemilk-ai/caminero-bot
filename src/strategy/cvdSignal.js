/**
 * cvdSignal.js — Sprint 5
 * Detecta divergencias entre precio y CVD acumulado.
 *
 * Divergencia LONG (alcista):
 *   precio hace mínimo más bajo (lower low)
 *   CVD acumulado hace mínimo más alto (higher low)
 *   → alguien está absorbiendo la venta → posible reversión al alza
 *
 * Divergencia SHORT (bajista):
 *   precio hace máximo más alto (higher high)
 *   CVD acumulado hace máximo más bajo (lower high)
 *   → la compra agresiva se agota → posible reversión a la baja
 *
 * Ventana de búsqueda: últimas 20 velas 1H (CONFIG.cvd.divergenceRange)
 */

const { calcularCVD }              = require('../data/cvdData')
const { findLocalMinima,
        findLocalMaxima }          = require('../utils/math')
const CONFIG                       = require('../config')

// ── Detectar divergencia en un set de datos CVD ──────────────

function detectarDivergencia(candles, cvdAcc, sesgo, ventana) {
  const n       = candles.length
  const inicio  = Math.max(0, n - ventana)

  // Slices de la ventana
  const candlesVentana = candles.slice(inicio)
  const cvdVentana     = cvdAcc.slice(inicio)

  if (sesgo === 'LONG') {
    // Buscar: precio lower low + CVD higher low
    const precioMinimos = candlesVentana.map(c => c.low)
    const cvdMinimos    = cvdVentana

    const pMins = findLocalMinima(precioMinimos, 2)
    const cMins = findLocalMinima(cvdMinimos,    2)

    if (pMins.length < 2 || cMins.length < 2) {
      return {
        confirmed: false,
        reason: 'Insuficientes minimos locales para comparar',
      }
    }

    const pMin1 = pMins[pMins.length - 2].value   // penultimo minimo de precio
    const pMin2 = pMins[pMins.length - 1].value   // ultimo minimo de precio
    const cMin1 = cMins[cMins.length - 2].value   // penultimo minimo de CVD
    const cMin2 = cMins[cMins.length - 1].value   // ultimo minimo de CVD

    const precioLowerLow = pMin2 < pMin1   // precio hizo lower low
    const cvdHigherLow   = cMin2 > cMin1   // CVD hizo higher low

    if (precioLowerLow && cvdHigherLow) {
      return {
        confirmed: true,
        tipo:      'DIVERGENCIA_ALCISTA',
        reason:    `Precio lower low (${pMin1.toFixed(1)} → ${pMin2.toFixed(1)}) + CVD higher low (${cMin1.toFixed(0)} → ${cMin2.toFixed(0)})`,
        precioMin1: pMin1,
        precioMin2: pMin2,
        cvdMin1:    cMin1,
        cvdMin2:    cMin2,
      }
    }

    return {
      confirmed: false,
      reason: precioLowerLow
        ? `CVD no confirma: hizo lower low tambien (${cMin1.toFixed(0)} → ${cMin2.toFixed(0)})`
        : `Precio no hizo lower low (${pMin1.toFixed(1)} → ${pMin2.toFixed(1)})`,
    }
  }

  if (sesgo === 'SHORT') {
    // Buscar: precio higher high + CVD lower high
    const precioMaximos = candlesVentana.map(c => c.high)
    const cvdMaximos    = cvdVentana

    const pMaxs = findLocalMaxima(precioMaximos, 2)
    const cMaxs = findLocalMaxima(cvdMaximos,    2)

    if (pMaxs.length < 2 || cMaxs.length < 2) {
      return {
        confirmed: false,
        reason: 'Insuficientes maximos locales para comparar',
      }
    }

    const pMax1 = pMaxs[pMaxs.length - 2].value
    const pMax2 = pMaxs[pMaxs.length - 1].value
    const cMax1 = cMaxs[cMaxs.length - 2].value
    const cMax2 = cMaxs[cMaxs.length - 1].value

    const precioHigherHigh = pMax2 > pMax1
    const cvdLowerHigh     = cMax2 < cMax1

    if (precioHigherHigh && cvdLowerHigh) {
      return {
        confirmed: true,
        tipo:      'DIVERGENCIA_BAJISTA',
        reason:    `Precio higher high (${pMax1.toFixed(1)} → ${pMax2.toFixed(1)}) + CVD lower high (${cMax1.toFixed(0)} → ${cMax2.toFixed(0)})`,
        precioMax1: pMax1,
        precioMax2: pMax2,
        cvdMax1:    cMax1,
        cvdMax2:    cMax2,
      }
    }

    return {
      confirmed: false,
      reason: precioHigherHigh
        ? `CVD no confirma: hizo higher high tambien (${cMax1.toFixed(0)} → ${cMax2.toFixed(0)})`
        : `Precio no hizo higher high (${pMax1.toFixed(1)} → ${pMax2.toFixed(1)})`,
    }
  }

  return { confirmed: false, reason: 'Sesgo invalido' }
}

// ── Función principal ────────────────────────────────────────

async function analizarCVD(symbol, sesgo) {
  const datos = await calcularCVD(symbol, '1h', CONFIG.cvd.window)

  const resultado = detectarDivergencia(
    datos.candles,
    datos.cvdAcc,
    sesgo,
    CONFIG.cvd.divergenceRange
  )

  return {
    symbol,
    sesgo,
    cvdActual:  parseFloat(datos.cvdActual.toFixed(2)),
    ...resultado,
  }
}

module.exports = { analizarCVD, detectarDivergencia }
