const fetch = require('node-fetch')
require('dotenv').config()

const BASE_URL = process.env.BINANCE_BASE_URL || 'https://fapi.binance.com'

// Retry simple para errores de red transitorios
async function fetchWithRetry(url, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body}`)
      }
      return res.json()
    } catch (err) {
      if (i === retries - 1) throw err
      await new Promise(r => setTimeout(r, delayMs * (i + 1)))
    }
  }
}

/**
 * Klines (velas)
 * interval: '1h', '15m', etc.
 * limit: máx 1500
 * Retorna array raw de Binance:
 * [openTime, open, high, low, close, volume, closeTime, quoteVol,
 *  trades, takerBuyBase, takerBuyQuote, ignore]
 */
async function getKlines(symbol, interval, limit = 100) {
  const url = `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  return fetchWithRetry(url)
}

/**
 * Funding rate actual
 * Retorna el funding rate del período vigente
 */
async function getFundingRate(symbol) {
  const url = `${BASE_URL}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`
  const data = await fetchWithRetry(url)
  return data[0] || null
}

/**
 * Premium index — incluye markPrice, indexPrice, fundingRate, nextFundingTime
 */
async function getPremiumIndex(symbol) {
  const url = `${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`
  return fetchWithRetry(url)
}

/**
 * Order book
 * limit: 5, 10, 20, 50, 100, 500, 1000
 */
async function getOrderBook(symbol, limit = 20) {
  const url = `${BASE_URL}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`
  return fetchWithRetry(url)
}

/**
 * Ticker 24h — precio, volumen, cambio porcentual
 */
async function getTicker24h(symbol) {
  const url = `${BASE_URL}/fapi/v1/ticker/24hr?symbol=${symbol}`
  return fetchWithRetry(url)
}

/**
 * Open Interest
 */
async function getOpenInterest(symbol) {
  const url = `${BASE_URL}/fapi/v1/openInterest?symbol=${symbol}`
  return fetchWithRetry(url)
}

/**
 * Exchange info — para verificar símbolo, step size, min notional
 */
async function getExchangeInfo() {
  const url = `${BASE_URL}/fapi/v1/exchangeInfo`
  return fetchWithRetry(url)
}

/**
 * Precio actual (mark price)
 */
async function getMarkPrice(symbol) {
  const url = `${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`
  const data = await fetchWithRetry(url)
  return parseFloat(data.markPrice)
}

/**
 * Calcula el spread del order book
 * Retorna: { spread, spreadPct, bestBid, bestAsk }
 */
async function getSpread(symbol) {
  const book = await getOrderBook(symbol, 5)
  const bestBid = parseFloat(book.bids[0][0])
  const bestAsk = parseFloat(book.asks[0][0])
  const spread = bestAsk - bestBid
  const spreadPct = spread / bestBid
  return { spread, spreadPct, bestBid, bestAsk }
}

module.exports = {
  getKlines,
  getFundingRate,
  getPremiumIndex,
  getOrderBook,
  getTicker24h,
  getOpenInterest,
  getExchangeInfo,
  getMarkPrice,
  getSpread,
}
