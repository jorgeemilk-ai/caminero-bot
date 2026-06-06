/**
 * altcoinConfirmation.js — Sprint 6
 * Verifica que mínimo 2 de 5 altcoins acompañan el sesgo de BTC.
 *
 * Ventana: 8 velas de 15m = 2 horas
 * Umbral:  ±0.35% de cambio en esa ventana
 *
 * LONG:  altcoin subió >= +0.35% en 2H
 * SHORT: altcoin bajó  <= -0.35% en 2H
 */

const { getKlines }        = require('../data/binanceClient')
const { parseCandles }     = require('../utils/candles')
const { pctChange }        = require('../utils/math')
const CONFIG               = require('../config')

async function verificarAltcoin(symbol, sesgo) {
  // 8 velas de 15m = 2 horas + 1 extra para tener base
  const raw     = await getKlines(symbol, '15m', CONFIG.altcoinConfirmation.window + 1)
  const candles = parseCandles(raw)

  const precioHace2H  = candles[0].close               // precio de hace 2 horas
  const precioActual  = candles[candles.length - 1].close

  const cambio = pctChange(precioHace2H, precioActual)

  let acompana = false

  if (sesgo === 'LONG'  && cambio >= CONFIG.altcoinConfirmation.threshold)  acompana = true
  if (sesgo === 'SHORT' && cambio <= -CONFIG.altcoinConfirmation.threshold) acompana = true

  return {
    symbol,
    precioHace2H: parseFloat(precioHace2H.toFixed(6)),
    precioActual: parseFloat(precioActual.toFixed(6)),
    cambio:       parseFloat(cambio.toFixed(6)),
    cambioPct:    parseFloat((cambio * 100).toFixed(3)),
    acompana,
  }
}

async function confirmarAltcoins(sesgo) {
  const resultados = []

  for (const symbol of CONFIG.altcoins) {
    try {
      const r = await verificarAltcoin(symbol, sesgo)
      resultados.push(r)
    } catch (err) {
      resultados.push({
        symbol,
        error:    err.message,
        acompana: false,
      })
    }
  }

  const confirmadas = resultados.filter(r => r.acompana)
  const valido      = confirmadas.length >= CONFIG.altcoinConfirmation.minCount

  return {
    valido,
    sesgo,
    total:       CONFIG.altcoins.length,
    confirmadas: confirmadas.length,
    minRequerido: CONFIG.altcoinConfirmation.minCount,
    detalle:     resultados,
    simbolos:    confirmadas.map(r => r.symbol),
  }
}

module.exports = { confirmarAltcoins, verificarAltcoin }
