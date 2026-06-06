/**
 * candles.js
 * Parsing y utilidades para velas de Binance Futures
 *
 * Formato raw Binance kline:
 * [0]  openTime
 * [1]  open
 * [2]  high
 * [3]  low
 * [4]  close
 * [5]  volume
 * [6]  closeTime
 * [7]  quoteAssetVolume
 * [8]  numberOfTrades
 * [9]  takerBuyBaseAssetVolume   ← clave para CVD
 * [10] takerBuyQuoteAssetVolume
 * [11] ignore
 */

function parseCandle(raw) {
  const volume     = parseFloat(raw[5])
  const takerBuy   = parseFloat(raw[9])
  const takerSell  = volume - takerBuy

  return {
    openTime:           raw[0],
    open:               parseFloat(raw[1]),
    high:               parseFloat(raw[2]),
    low:                parseFloat(raw[3]),
    close:              parseFloat(raw[4]),
    volume,
    closeTime:          raw[6],
    quoteVolume:        parseFloat(raw[7]),
    trades:             parseInt(raw[8]),
    takerBuyVolume:     takerBuy,
    takerSellVolume:    takerSell,
    cvdDelta:           takerBuy - takerSell,  // delta por vela para CVD
  }
}

function parseCandles(rawArray) {
  return rawArray.map(parseCandle)
}

// ── Precio ──────────────────────────────────────────────────

function getLatest(candles) {
  return candles[candles.length - 1]
}

function getHigh(candles) {
  return Math.max(...candles.map(c => c.high))
}

function getLow(candles) {
  return Math.min(...candles.map(c => c.low))
}

function getCloses(candles) {
  return candles.map(c => c.close)
}

function getHighs(candles) {
  return candles.map(c => c.high)
}

function getLows(candles) {
  return candles.map(c => c.low)
}

// ── Volumen ──────────────────────────────────────────────────

function getAverageVolume(candles, window = 20) {
  const recent = candles.slice(-window - 1, -1) // excluye la vela actual (puede estar incompleta)
  if (!recent.length) return 0
  return recent.reduce((acc, c) => acc + c.volume, 0) / recent.length
}

function getVolumeRatio(candles, window = 20) {
  const avg = getAverageVolume(candles, window)
  if (avg === 0) return 0
  return getLatest(candles).volume / avg
}

// ── Mechas ───────────────────────────────────────────────────
/**
 * Mecha inferior = (min(open,close) - low) / (high - low)
 * Indica fuerza de rechazo bajista (bull rejection)
 * >= 0.40 = mecha significativa
 */
function getMechaInferior(candle) {
  const range = candle.high - candle.low
  if (range === 0) return 0
  const bodyLow = Math.min(candle.open, candle.close)
  return (bodyLow - candle.low) / range
}

/**
 * Mecha superior = (high - max(open,close)) / (high - low)
 * Indica fuerza de rechazo alcista (bear rejection)
 * >= 0.40 = mecha significativa
 */
function getMechaSuperior(candle) {
  const range = candle.high - candle.low
  if (range === 0) return 0
  const bodyHigh = Math.max(candle.open, candle.close)
  return (candle.high - bodyHigh) / range
}

// ── Swings ───────────────────────────────────────────────────
/**
 * Swing high: vela cuyo high es mayor que N velas a cada lado
 * Retorna array de { index, price, time }
 */
function findSwingHighs(candles, lookback = 3) {
  const swings = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]
    let isSwing = true
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) {
        isSwing = false
        break
      }
    }
    if (isSwing) swings.push({ index: i, price: c.high, time: c.openTime })
  }
  return swings
}

/**
 * Swing low: vela cuyo low es menor que N velas a cada lado
 */
function findSwingLows(candles, lookback = 3) {
  const swings = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]
    let isSwing = true
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) {
        isSwing = false
        break
      }
    }
    if (isSwing) swings.push({ index: i, price: c.low, time: c.openTime })
  }
  return swings
}

// ── CVD delta array ──────────────────────────────────────────

function getCVDDeltas(candles) {
  return candles.map(c => c.cvdDelta)
}

module.exports = {
  parseCandle,
  parseCandles,
  getLatest,
  getHigh,
  getLow,
  getCloses,
  getHighs,
  getLows,
  getAverageVolume,
  getVolumeRatio,
  getMechaInferior,
  getMechaSuperior,
  findSwingHighs,
  findSwingLows,
  getCVDDeltas,
}
