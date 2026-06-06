/**
 * cvdSignal.js — V2
 * Cambio: cuando no hay suficientes mínimos/máximos locales,
 * usar fallback con los valores extremos del período.
 */

const { calcularCVD }              = require('../data/cvdData')
const { findLocalMinima,
        findLocalMaxima }          = require('../utils/math')
const CONFIG                       = require('../config')

function detectarDivergencia(candles, cvdAcc, sesgo, ventana) {
  const n      = candles.length
  const inicio = Math.max(0, n - ventana)

  const candlesVentana = candles.slice(inicio)
  const cvdVentana     = cvdAcc.slice(inicio)

  if (sesgo === 'LONG') {
    const precioMinimos = candlesVentana.map(c => c.low)
    const cvdMinimos    = cvdVentana

    let pMins = findLocalMinima(precioMinimos, 1)
    let cMins = findLocalMinima(cvdMinimos,    1)

    // Fallback: si no hay suficientes mínimos locales,
    // usar los dos valores más bajos del período directamente
    if (pMins.length < 2) {
      const sorted = precioMinimos
        .map((v, i) => ({ index: i, value: v }))
        .sort((a, b) => a.value - b.value)
      if (sorted.length < 2) return { confirmed: false, reason: 'Datos de precio insuficientes' }
      // Ordenar por índice para mantener orden temporal
      pMins = [sorted[1], sorted[0]].sort((a, b) => a.index - b.index)
    }

    if (cMins.length < 2) {
      const sorted = cvdMinimos
        .map((v, i) => ({ index: i, value: v }))
        .sort((a, b) => a.value - b.value)
      if (sorted.length < 2) return { confirmed: false, reason: 'Datos CVD insuficientes' }
      cMins = [sorted[1], sorted[0]].sort((a, b) => a.index - b.index)
    }

    const pMin1 = pMins[pMins.length - 2].value
    const pMin2 = pMins[pMins.length - 1].value
    const cMin1 = cMins[cMins.length - 2].value
    const cMin2 = cMins[cMins.length - 1].value

    const precioLowerLow = pMin2 < pMin1
    const cvdHigherLow   = cMin2 > cMin1

    if (precioLowerLow && cvdHigherLow) {
      return {
        confirmed: true,
        tipo:      'DIVERGENCIA_ALCISTA',
        reason:    `Precio lower low (${pMin1.toFixed(1)} → ${pMin2.toFixed(1)}) + CVD higher low (${cMin1.toFixed(0)} → ${cMin2.toFixed(0)})`,
        precioMin1: pMin1, precioMin2: pMin2,
        cvdMin1: cMin1,    cvdMin2: cMin2,
      }
    }

    return {
      confirmed: false,
      reason: precioLowerLow
        ? `CVD no confirma: también hizo lower low (${cMin1.toFixed(0)} → ${cMin2.toFixed(0)})`
        : `Precio no hizo lower low (${pMin1.toFixed(1)} → ${pMin2.toFixed(1)})`,
    }
  }

  if (sesgo === 'SHORT') {
    const precioMaximos = candlesVentana.map(c => c.high)
    const cvdMaximos    = cvdVentana

    let pMaxs = findLocalMaxima(precioMaximos, 1)
    let cMaxs = findLocalMaxima(cvdMaximos,    1)

    // Fallback para SHORT
    if (pMaxs.length < 2) {
      const sorted = precioMaximos
        .map((v, i) => ({ index: i, value: v }))
        .sort((a, b) => b.value - a.value)
      if (sorted.length < 2) return { confirmed: false, reason: 'Datos de precio insuficientes' }
      pMaxs = [sorted[1], sorted[0]].sort((a, b) => a.index - b.index)
    }

    if (cMaxs.length < 2) {
      const sorted = cvdMaximos
        .map((v, i) => ({ index: i, value: v }))
        .sort((a, b) => b.value - a.value)
      if (sorted.length < 2) return { confirmed: false, reason: 'Datos CVD insuficientes' }
      cMaxs = [sorted[1], sorted[0]].sort((a, b) => a.index - b.index)
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
        precioMax1: pMax1, precioMax2: pMax2,
        cvdMax1: cMax1,    cvdMax2: cMax2,
      }
    }

    return {
      confirmed: false,
      reason: precioHigherHigh
        ? `CVD no confirma: también hizo higher high (${cMax1.toFixed(0)} → ${cMax2.toFixed(0)})`
        : `Precio no hizo higher high (${pMax1.toFixed(1)} → ${pMax2.toFixed(1)})`,
    }
  }

  return { confirmed: false, reason: 'Sesgo inválido' }
}

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
    cvdActual: parseFloat(datos.cvdActual.toFixed(2)),
    ...resultado,
  }
}

module.exports = { analizarCVD, detectarDivergencia }
