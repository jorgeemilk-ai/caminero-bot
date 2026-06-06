/**
 * coinglassClient.js
 * Cliente para Coinglass API v4 — Plan Hobbyist
 *
 * Base URL: https://open-api-v4.coinglass.com
 * Header:   CG-API-KEY
 *
 * Endpoints confirmados para Hobbyist:
 * - /api/futures/open-interest/aggregated-history  (4h, 6h, 8h, 12h, 1d)
 * - /api/futures/liquidation/aggregated-history    (4h, 6h, 8h, 12h, 1d)
 * - /api/futures/supported-coins
 */

require('dotenv').config()

const fetch   = require('node-fetch')

const BASE_URL = 'https://open-api-v4.coinglass.com'
const API_KEY  = process.env.COINGLASS_API_KEY || ''

// Rate limit Hobbyist: 30 req/min = 1 req cada 2 segundos
// El bot corre cada 15 min y hace ~6 llamadas = bien dentro del límite

async function cgFetch(path) {
  if (!API_KEY) throw new Error('COINGLASS_API_KEY no configurada en .env')

  const url = `${BASE_URL}${path}`
  const res  = await fetch(url, {
    headers: {
      'CG-API-KEY':  API_KEY,
      'accept':      'application/json',
    }
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Coinglass HTTP ${res.status}: ${body}`)
  }

  const json = await res.json()

  if (json.code !== '0') {
    throw new Error(`Coinglass API error ${json.code}: ${json.msg}`)
  }

  return json.data
}

// ── Open Interest agregado (OHLC) ────────────────────────────
/**
 * OI agregado multi-exchange en OHLC
 * interval: '4h' | '6h' | '8h' | '12h' | '1d'
 * limit: número de velas
 *
 * Retorna: [{ time, open, high, low, close }]
 * close = OI actual en USD
 */
async function getOIAggregated(symbol = 'BTC', interval = '4h', limit = 12) {
  const path = `/api/futures/open-interest/aggregated-history?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const data  = await cgFetch(path)

  return data.map(d => ({
    time:  d.time,
    open:  parseFloat(d.open),
    high:  parseFloat(d.high),
    low:   parseFloat(d.low),
    close: parseFloat(d.close),
  }))
}

// ── Liquidation history agregado ─────────────────────────────
/**
 * Historial de liquidaciones agregadas multi-exchange
 * interval: '4h' | '6h' | '8h' | '12h' | '1d'
 *
 * Retorna array con liquidaciones por período
 * Útil para detectar zonas donde se concentraron liquidaciones
 */
async function getLiquidationHistory(symbol = 'BTC', interval = '4h', limit = 24) {
  const path = `/api/futures/liquidation/aggregated-history?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const data  = await cgFetch(path)
  return data
}

// ── Análisis de OI ────────────────────────────────────────────
/**
 * Interpreta la tendencia del OI para el sesgo dado
 *
 * OI subiendo + precio subiendo = trend alcista (nuevas posiciones long)
 * OI subiendo + precio bajando = nuevas posiciones short (bearish)
 * OI bajando = cierre de posiciones (desapalancamiento)
 *
 * Retorna: { tendencia, cambio4h, cambio24h, oiActual, confirma }
 */
async function analizarOI(symbol = 'BTC', sesgo = 'LONG') {
  try {
    const datos = await getOIAggregated(symbol, '4h', 7)  // últimas 28h

    if (datos.length < 2) return { confirma: false, razon: 'Datos OI insuficientes' }

    const oiActual  = datos[datos.length - 1].close
    const oiHace4h  = datos[datos.length - 2].close
    const oiHace24h = datos[Math.max(0, datos.length - 7)].close

    const cambio4h  = (oiActual - oiHace4h)  / oiHace4h
    const cambio24h = (oiActual - oiHace24h) / oiHace24h

    let tendencia = 'NEUTRAL'
    if (cambio4h > 0.005)       tendencia = 'SUBIENDO'
    else if (cambio4h < -0.005) tendencia = 'BAJANDO'

    // Para LONG: OI subiendo = nuevas posiciones, puede confirmar movimiento
    // Para SHORT: OI subiendo también = nuevas posiciones short o squeeze
    // OI bajando = desapalancamiento, menos convicción en el movimiento

    let confirma = true
    let razon    = ''

    if (tendencia === 'BAJANDO' && Math.abs(cambio4h) > 0.02) {
      confirma = false
      razon    = `OI cayendo ${(cambio4h * 100).toFixed(2)}% en 4h — desapalancamiento`
    } else {
      razon = `OI ${tendencia} ${(cambio4h * 100).toFixed(2)}% en 4h | ${(cambio24h * 100).toFixed(2)}% en 24h`
    }

    return {
      confirma,
      tendencia,
      cambio4h:  parseFloat(cambio4h.toFixed(6)),
      cambio24h: parseFloat(cambio24h.toFixed(6)),
      oiActual:  parseFloat(oiActual.toFixed(0)),
      razon,
    }
  } catch (err) {
    return { confirma: true, razon: `OI no disponible: ${err.message}`, fallback: true }
  }
}

// ── Zonas de liquidez desde liquidation history ───────────────
/**
 * Estima zonas de liquidez basándose en dónde se concentraron
 * las liquidaciones históricas.
 *
 * Zonas con muchas liquidaciones = donde estaban los stops = liquidez
 *
 * Retorna array de niveles de precio con peso de liquidación
 */
async function zonasLiquidezDesdeHistorial(symbol = 'BTC', precioActual = 0) {
  try {
    const data = await getLiquidationHistory(symbol, '4h', 42)  // ~7 días

    if (!data || data.length === 0) return []

    // Extraer niveles de precio donde hubo liquidaciones significativas
    // La estructura exacta depende de la respuesta de Coinglass
    // Típicamente: { time, longLiquidationUsd, shortLiquidationUsd, price? }

    const zonas = []

    for (const item of data) {
      const longLiq  = parseFloat(item.longLiquidationUsd  || item.buyLiquidation  || item.long  || 0)
      const shortLiq = parseFloat(item.shortLiquidationUsd || item.sellLiquidation || item.short || 0)
      const precio   = parseFloat(item.price || item.close || 0)

      if (precio === 0) continue

      const totalLiq = longLiq + shortLiq
      if (totalLiq > 0 && precioActual > 0) {
        const distancia = Math.abs(precio - precioActual) / precioActual
        if (distancia <= 0.05) {  // dentro del 5%
          zonas.push({
            price:     precio,
            longLiq,
            shortLiq,
            totalLiq,
            distancia: parseFloat(distancia.toFixed(4)),
            direction: precio < precioActual ? 'DOWN' : 'UP',
          })
        }
      }
    }

    // Ordenar por total de liquidaciones (más liquidaciones = zona más caliente)
    zonas.sort((a, b) => b.totalLiq - a.totalLiq)

    return zonas.slice(0, 10)  // top 10 zonas

  } catch (err) {
    return []  // fallback silencioso
  }
}

module.exports = {
  getOIAggregated,
  getLiquidationHistory,
  analizarOI,
  zonasLiquidezDesdeHistorial,
}
