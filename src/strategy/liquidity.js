/**
 * liquidity.js — Sprint 3
 * Detecta zonas de liquidez estimadas usando datos públicos de Binance.
 *
 * Método:
 * 1. Swing highs/lows en velas 1H (pivots)
 * 2. Velas con volumen >= 2x promedio (high-volume nodes)
 * 3. Agrupar niveles cercanos en clusters (±0.25%)
 * 4. Filtrar por distancia al precio actual (máx 3%)
 *
 * Retorna array de zonas ordenadas por distancia:
 * [{ level, direction, distance, strength, source }]
 */

const { getKlines }                          = require('../data/binanceClient')
const { parseCandles, getLatest,
        getAverageVolume, findSwingHighs,
        findSwingLows }                      = require('../utils/candles')
const { clusterLevels, distancePct, average } = require('../utils/math')
const CONFIG                                 = require('../config')

// ── Recopilar niveles crudos ─────────────────────────────────

function recopilarNiveles(candles) {
  const niveles = []

  const avgVol      = getAverageVolume(candles, 50)
  const swingHighs  = findSwingHighs(candles, CONFIG.liquidity.swingLookback)
  const swingLows   = findSwingLows(candles,  CONFIG.liquidity.swingLookback)

  // Swing highs → resistencias potenciales
  for (const s of swingHighs) {
    niveles.push({ price: s.price, type: 'resistance', source: 'swing' })
  }

  // Swing lows → soportes potenciales
  for (const s of swingLows) {
    niveles.push({ price: s.price, type: 'support', source: 'swing' })
  }

  // High-volume nodes → ambos lados
  for (const c of candles) {
    if (c.volume >= avgVol * CONFIG.liquidity.volumeMultiplier) {
      niveles.push({ price: c.high, type: 'resistance', source: 'volume' })
      niveles.push({ price: c.low,  type: 'support',    source: 'volume' })
    }
  }

  return niveles
}

// ── Agrupar en clusters ──────────────────────────────────────

function agruparEnClusters(niveles, tolerance) {
  const resistencias = niveles
    .filter(n => n.type === 'resistance')
    .map(n => n.price)

  const soportes = niveles
    .filter(n => n.type === 'support')
    .map(n => n.price)

  const clustersRes = clusterLevels(resistencias, tolerance)
  const clustersOp  = clusterLevels(soportes,     tolerance)

  return {
    resistencias: clustersRes,
    soportes:     clustersOp,
  }
}

// ── Calcular fuerza de cada zona ─────────────────────────────
// Cuántos niveles crudos caen dentro del cluster → más = más fuerte

function calcularFuerza(clusterPrice, nivelesRaw, tolerance) {
  const count = nivelesRaw.filter(n =>
    distancePct(clusterPrice, n.price) <= tolerance
  ).length

  if (count >= 4) return 'HIGH'
  if (count >= 2) return 'MEDIUM'
  return 'LOW'
}

// ── Función principal ─────────────────────────────────────────

async function calcularLiquidez(symbol = CONFIG.patron) {
  const raw     = await getKlines(symbol, '1h', 200)
  const candles = parseCandles(raw)
  const precio  = getLatest(candles).close

  const nivelesRaw = recopilarNiveles(candles)
  const clusters   = agruparEnClusters(nivelesRaw, CONFIG.liquidity.clusterTolerance)

  const zonas = []

  // Procesar resistencias (encima del precio → SHORT target)
  for (const level of clusters.resistencias) {
    const dist = distancePct(precio, level)
    if (dist > CONFIG.liquidity.maxDistance) continue
    if (level <= precio) continue   // debe estar encima

    zonas.push({
      level,
      direction: 'UP',
      distance:  parseFloat(dist.toFixed(4)),
      strength:  calcularFuerza(level, nivelesRaw, CONFIG.liquidity.clusterTolerance),
      source:    'cluster_resistance',
    })
  }

  // Procesar soportes (debajo del precio → LONG target)
  for (const level of clusters.soportes) {
    const dist = distancePct(precio, level)
    if (dist > CONFIG.liquidity.maxDistance) continue
    if (level >= precio) continue   // debe estar debajo

    zonas.push({
      level,
      direction: 'DOWN',
      distance:  parseFloat(dist.toFixed(4)),
      strength:  calcularFuerza(level, nivelesRaw, CONFIG.liquidity.clusterTolerance),
      source:    'cluster_support',
    })
  }

  // Ordenar por distancia (más cercana primero)
  zonas.sort((a, b) => a.distance - b.distance)

  // Zona más relevante según sesgo
  const nearest = zonas[0] || null

  return {
    valid:   zonas.length > 0,
    precio,
    zones:   zonas,
    nearest,
  }
}

// ── Validar si hay liquidez para un sesgo dado ───────────────

function liquidezValida(resultado, sesgo) {
  if (!resultado.valid) return false

  const zonaRelevante = resultado.zones.find(z =>
    sesgo === 'LONG'  ? z.direction === 'DOWN' :
    sesgo === 'SHORT' ? z.direction === 'UP'   : false
  )

  if (!zonaRelevante) return false

  // La zona debe estar dentro del 3% del precio
  return zonaRelevante.distance <= CONFIG.liquidity.maxDistance
}

module.exports = { calcularLiquidez, liquidezValida }
