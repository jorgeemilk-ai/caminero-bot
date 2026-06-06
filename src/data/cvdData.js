/**
 * cvdData.js — Sprint 5
 * Calcula CVD acumulado desde datos públicos de Binance Futures.
 *
 * CVD = Cumulative Volume Delta
 * delta por vela = takerBuyVolume - takerSellVolume
 * CVD acumulado  = suma corrida de todos los deltas
 *
 * Binance entrega takerBuyBaseAssetVolume en el campo [9] de klines.
 * takerSellVolume = totalVolume - takerBuyVolume
 */

const { getKlines }          = require('../data/binanceClient')
const { parseCandles }       = require('../utils/candles')
const { cumulativeSum }      = require('../utils/math')
const CONFIG                 = require('../config')

async function calcularCVD(symbol, interval = '1h', limit = 50) {
  const raw     = await getKlines(symbol, interval, limit)
  const candles = parseCandles(raw)

  // Delta por vela y CVD acumulado
  const deltas = candles.map(c => c.cvdDelta)
  const cvdAcc = cumulativeSum(deltas)

  return {
    symbol,
    interval,
    candles,
    deltas,
    cvdAcc,
    // Ultimo valor del CVD
    cvdActual: cvdAcc[cvdAcc.length - 1],
  }
}

module.exports = { calcularCVD }
