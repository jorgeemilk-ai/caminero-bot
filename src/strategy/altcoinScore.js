/**
 * altcoinScore.js — Sprint 7
 * Calcula score 0-100 para cada altcoin de la canasta.
 *
 * Componentes (fórmulas completas V8.4):
 *   Correlación BTC  20 pts  — Pearson 1H, 20 velas
 *   Fuerza relativa  25 pts  — ranking vs BTC en ventana 20 velas 1H
 *   Liquidez         20 pts  — distancia a zona más cercana
 *   Funding          20 pts  — funding diario contra la posición
 *   Spread/volumen   15 pts  — spread + volumen ratio
 *   Bonus funding     +5     — si funding es favorable (a favor), cap 100
 */

const { getKlines, getFundingRate, getSpread } = require('../data/binanceClient')
const { parseCandles, getLatest,
        getAverageVolume }                     = require('../utils/candles')
const { pearsonCorrelation, pctChange,
        distancePct }                          = require('../utils/math')
const { calcularLiquidez }                     = require('./liquidity')
const CONFIG                                   = require('../config')

// ── 1. Correlación con BTC (20 pts) ─────────────────────────

async function scoreCorrelacion(symbol, btcCloses) {
  const raw     = await getKlines(symbol, '1h', CONFIG.score.correlacion.ventana)
  const candles = parseCandles(raw)
  const closes  = candles.map(c => c.close)

  // Alinear longitud
  const len    = Math.min(closes.length, btcCloses.length)
  const correl = pearsonCorrelation(
    btcCloses.slice(-len),
    closes.slice(-len)
  )

  if (correl < CONFIG.score.correlacion.min) {
    return { pts: 0, correl, descarte: true }
  }

  let pts = 0
  if (correl >= 0.80)      pts = 20
  else if (correl >= 0.70) pts = 15
  else if (correl >= 0.60) pts = 10

  return { pts, correl: parseFloat(correl.toFixed(4)), descarte: false }
}

// ── 2. Fuerza relativa (25 pts) — ranking ───────────────────
// Para LONG:  la que menos cayó / más recuperó = más fuerte
// Para SHORT: la que menos subió / más rechazó = más débil
// Se calcula el retorno relativo vs BTC y se rankea

function calcularFuerzaRelativa(retornoAltcoin, retornoBTC) {
  if (retornoBTC === 0) return 1.0
  return retornoAltcoin / retornoBTC
}

// ── 3. Liquidez (20 pts) — distancia a zona más cercana ─────

async function scoreLiquidez(symbol) {
  try {
    const liq   = await calcularLiquidez(symbol)
    if (!liq.valid || !liq.nearest) return { pts: 0, distance: null }

    const dist = liq.nearest.distance

    let pts = 0
    if (dist < 0.01)      pts = 20
    else if (dist < 0.02) pts = 15
    else if (dist < 0.03) pts = 10

    return { pts, distance: parseFloat(dist.toFixed(4)) }
  } catch {
    return { pts: 0, distance: null }
  }
}

// ── 4. Funding (20 pts + bonus +5) ──────────────────────────

async function scoreFunding(symbol, sesgo) {
  try {
    const f = await getFundingRate(symbol)
    if (!f) return { pts: 10, bonus: 0, fundingDaily: null }

    const funding8h   = parseFloat(f.fundingRate)
    const fundingDay  = funding8h * CONFIG.funding.periodsPerDay

    // Funding "en contra": LONG sufre con positivo, SHORT sufre con negativo
    const enContra = sesgo === 'LONG' ? fundingDay : -fundingDay

    let pts   = 0
    let bonus = 0

    if (enContra <= CONFIG.funding.normal) {
      pts = 20
    } else if (enContra <= CONFIG.funding.caution) {
      pts = 10
    } else {
      pts = 0   // bloqueado de todas formas en fundingFilter
    }

    // Bonus si el funding es favorable (a favor de la posición)
    if (enContra < 0) bonus = 5

    return {
      pts,
      bonus,
      fundingDaily: parseFloat(fundingDay.toFixed(6)),
      enContra:     parseFloat(enContra.toFixed(6)),
    }
  } catch {
    return { pts: 10, bonus: 0, fundingDaily: null }
  }
}

// ── 5. Spread / Volumen (15 pts) ─────────────────────────────

async function scoreSpreadVolumen(symbol) {
  try {
    const [spreadData, rawKlines] = await Promise.all([
      getSpread(symbol),
      getKlines(symbol, '1h', 21),
    ])

    const candles  = parseCandles(rawKlines)
    const avgVol   = getAverageVolume(candles, 20)
    const lastVol  = getLatest(candles).volume
    const volRatio = avgVol > 0 ? lastVol / avgVol : 0
    const spread   = spreadData.spreadPct

    let pts = 0
    if (spread < CONFIG.spread.good && volRatio >= 1.5)       pts = 15
    else if (spread < CONFIG.spread.acceptable && volRatio >= 1.0) pts = 8

    // Bloquear si spread muy alto o volumen muerto
    const bloqueado = spread > CONFIG.spread.block || volRatio < CONFIG.spread.minVolumeRatio

    return {
      pts,
      spread:   parseFloat(spread.toFixed(6)),
      volRatio: parseFloat(volRatio.toFixed(3)),
      bloqueado,
    }
  } catch {
    return { pts: 5, spread: null, volRatio: null, bloqueado: false }
  }
}

// ── Score total de una altcoin ───────────────────────────────

async function calcularScoreAltcoin(symbol, sesgo, btcCloses, retornoBTC) {
  const [sCorrel, sLiq, sFunding, sSpread] = await Promise.all([
    scoreCorrelacion(symbol, btcCloses),
    scoreLiquidez(symbol),
    scoreFunding(symbol, sesgo),
    scoreSpreadVolumen(symbol),
  ])

  // Descartar si correlación muy baja
  if (sCorrel.descarte) {
    return {
      symbol, sesgo, score: 0,
      descartado: true,
      razon: `Correlacion insuficiente: ${sCorrel.corrел}`,
      detalle: { correlacion: sCorrel, liquidez: sLiq, funding: sFunding, spread: sSpread }
    }
  }

  // Descartar si spread bloquea
  if (sSpread.bloqueado) {
    return {
      symbol, sesgo, score: 0,
      descartado: true,
      razon: `Spread/volumen bloqueante: spread ${sSpread.spread} volRatio ${sSpread.volRatio}`,
      detalle: { correlacion: sCorrel, liquidez: sLiq, funding: sFunding, spread: sSpread }
    }
  }

  // Fuerza relativa se calcula después del ranking — aquí retorna retorno base
  const raw     = await getKlines(symbol, '1h', 21)
  const candles = parseCandles(raw)
  const closes  = candles.map(c => c.close)
  const retornoAlt = pctChange(closes[0], closes[closes.length - 1])
  const fuerza     = calcularFuerzaRelativa(retornoAlt, retornoBTC)

  // Subtotal sin fuerza relativa (se asigna después del ranking)
  const subtotal = sCorrel.pts + sLiq.pts + sFunding.pts + sFunding.bonus + sSpread.pts

  return {
    symbol,
    sesgo,
    score:      0,     // se asigna en seleccionarMejorAltcoin tras ranking
    subtotal,          // pts sin fuerza relativa
    fuerza,            // ratio para ranking
    retornoAlt:        parseFloat(retornoAlt.toFixed(6)),
    descartado:        false,
    detalle: {
      correlacion: sCorrel,
      liquidez:    sLiq,
      funding:     sFunding,
      spread:      sSpread,
    }
  }
}

// ── Seleccionar mejor altcoin ────────────────────────────────

async function seleccionarMejorAltcoin(sesgo, altcoinsExcluidas = []) {
  // Datos de BTC para correlación y fuerza relativa
  const rawBTC   = await getKlines(CONFIG.patron, '1h', 21)
  const candBTC  = parseCandles(rawBTC)
  const btcCls   = candBTC.map(c => c.close)
  const retBTC   = pctChange(btcCls[0], btcCls[btcCls.length - 1])

  // Candidatas (excluir las que ya tienen capa abierta)
  const candidatas = CONFIG.altcoins.filter(s => !altcoinsExcluidas.includes(s))

  // Calcular score parcial para cada una
  const resultados = await Promise.all(
    candidatas.map(symbol => calcularScoreAltcoin(symbol, sesgo, btcCls, retBTC))
  )

  // Filtrar descartadas
  const validas = resultados.filter(r => !r.descartado)

  if (validas.length === 0) {
    return { found: false, reason: 'Todas las altcoins descartadas por filtros' }
  }

  // Ranking por fuerza relativa
  if (sesgo === 'LONG') {
    // LONG: la más fuerte (mayor fuerza relativa) = 1er lugar
    validas.sort((a, b) => b.fuerza - a.fuerza)
  } else {
    // SHORT: la más débil (menor fuerza relativa) = 1er lugar
    validas.sort((a, b) => a.fuerza - b.fuerza)
  }

  // Asignar puntos de fuerza relativa según ranking
  const ptosFuerza = [25, 18, 10, 0, 0]
  validas.forEach((r, i) => {
    r.ptsFuerzaRelativa = ptosFuerza[i] || 0
    r.score = Math.min(100, r.subtotal + r.ptsFuerzaRelativa)
    r.ranking = i + 1
  })

  // Mejor altcoin = mayor score total (mínimo 75)
  const mejor = validas[0]

  if (mejor.score < CONFIG.score.minimum) {
    return {
      found:  false,
      reason: `Mejor score insuficiente: ${mejor.symbol} = ${mejor.score}/100 (min ${CONFIG.score.minimum})`,
      todas:  validas,
    }
  }

  return {
    found:   true,
    symbol:  mejor.symbol,
    score:   mejor.score,
    ranking: mejor.ranking,
    detalle: mejor,
    todas:   validas,
  }
}

module.exports = { seleccionarMejorAltcoin, calcularScoreAltcoin }
