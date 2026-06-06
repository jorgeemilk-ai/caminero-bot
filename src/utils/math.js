/**
 * math.js
 * Funciones matemáticas base para la estrategia
 */

// ── Estadísticas básicas ─────────────────────────────────────

function average(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdDev(arr) {
  if (arr.length < 2) return 0
  const avg = average(arr)
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2))
  return Math.sqrt(average(squareDiffs))
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// ── Correlación de Pearson ───────────────────────────────────
/**
 * Correlación de Pearson entre dos arrays de igual longitud
 * Usada para: correlación altcoin vs BTC en ventana de 20 velas 1H
 * Retorna valor entre -1 y +1
 */
function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return 0

  const n    = x.length
  const meanX = average(x)
  const meanY = average(y)

  let num  = 0
  let denX = 0
  let denY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    num  += dx * dy
    denX += dx * dx
    denY += dy * dy
  }

  const den = Math.sqrt(denX * denY)
  if (den === 0) return 0
  return clamp(num / den, -1, 1)
}

// ── Cambios porcentuales ─────────────────────────────────────

function pctChange(from, to) {
  if (from === 0) return 0
  return (to - from) / from
}

// ── Clusters de niveles de precio ───────────────────────────
/**
 * Agrupa niveles de precio cercanos en clusters
 * tolerance: ej. 0.0025 = ±0.25%
 * Retorna array de precios promedio por cluster
 */
function clusterLevels(levels, tolerance = 0.0025) {
  if (!levels.length) return []

  const sorted = [...levels].sort((a, b) => a - b)
  const clusters = []
  let group = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const base = group[0]
    if (Math.abs(sorted[i] - base) / base <= tolerance) {
      group.push(sorted[i])
    } else {
      clusters.push(average(group))
      group = [sorted[i]]
    }
  }
  clusters.push(average(group))

  return clusters
}

// ── Suma acumulada (para CVD) ────────────────────────────────
/**
 * Suma acumulada (running sum)
 * Usado para calcular CVD acumulado desde array de deltas
 */
function cumulativeSum(arr) {
  const result = []
  let sum = 0
  for (const v of arr) {
    sum += v
    result.push(sum)
  }
  return result
}

// ── Detección de swings en arrays ───────────────────────────
/**
 * Mínimos locales en un array numérico
 * window: cuántas posiciones a cada lado deben ser mayores
 */
function findLocalMinima(arr, window = 3) {
  const minima = []
  for (let i = window; i < arr.length - window; i++) {
    let isMin = true
    for (let j = 1; j <= window; j++) {
      if (arr[i - j] <= arr[i] || arr[i + j] <= arr[i]) {
        isMin = false
        break
      }
    }
    if (isMin) minima.push({ index: i, value: arr[i] })
  }
  return minima
}

/**
 * Máximos locales en un array numérico
 */
function findLocalMaxima(arr, window = 3) {
  const maxima = []
  for (let i = window; i < arr.length - window; i++) {
    let isMax = true
    for (let j = 1; j <= window; j++) {
      if (arr[i - j] >= arr[i] || arr[i + j] >= arr[i]) {
        isMax = false
        break
      }
    }
    if (isMax) maxima.push({ index: i, value: arr[i] })
  }
  return maxima
}

// ── Distancia porcentual entre dos precios ───────────────────

function distancePct(priceA, priceB) {
  return Math.abs(priceA - priceB) / priceA
}

module.exports = {
  average,
  stdDev,
  clamp,
  pearsonCorrelation,
  pctChange,
  clusterLevels,
  cumulativeSum,
  findLocalMinima,
  findLocalMaxima,
  distancePct,
}
