/**
 * basketManager.js — Sprint 8
 * Gestión de la canasta simulada: PnL, TP, trailing, stop técnico, kill switch.
 *
 * En modo OBSERVER solo emite eventos WOULD_* sin ejecutar nada real.
 */

const { leerEstado, guardarEstado, resetEstado,
        abrirCapa, acumularFunding }             = require('./basketState')
const { verificarKillSwitch }                    = require('./killSwitch')
const { getKlines, getFundingRate }              = require('../data/binanceClient')
const { parseCandles, getLatest }                = require('../utils/candles')
const CONFIG                                     = require('../config')

// ── Calcular PnL neto de la canasta ──────────────────────────

function calcularPnLCanasta(state, preciosActuales) {
  let pnlBruto    = 0
  let fundingTotal = 0
  const comisionPct = 0.0008  // 0.04% taker × 2 lados = 0.08%

  for (const layer of state.layers) {
    const precio = preciosActuales[layer.symbol]
    if (!precio) continue

    const pnlPct = layer.sesgo === 'LONG'
      ? (precio - layer.entryPrice) / layer.entryPrice
      : (layer.entryPrice - precio) / layer.entryPrice

    pnlBruto     += pnlPct * layer.capital * layer.leverage
    fundingTotal += layer.fundingPaid * layer.capital
  }

  const capitalUsado  = state.layers.reduce((a, l) => a + l.capital, 0)
  const comisiones    = capitalUsado * comisionPct
  const pnlNeto       = pnlBruto - fundingTotal - comisiones
  const pnlNetoPct    = capitalUsado > 0 ? pnlNeto / capitalUsado : 0

  return {
    pnlBruto:    parseFloat(pnlBruto.toFixed(4)),
    fundingTotal: parseFloat(fundingTotal.toFixed(4)),
    comisiones:  parseFloat(comisiones.toFixed(4)),
    pnlNeto:     parseFloat(pnlNeto.toFixed(4)),
    pnlNetoPct:  parseFloat(pnlNetoPct.toFixed(6)),
    capitalUsado: parseFloat(capitalUsado.toFixed(2)),
  }
}

// ── Verificar stop técnico ────────────────────────────────────

async function verificarStopTecnico(state) {
  const layer = state.layers[0]
  if (!layer) return { activo: false }

  const raw     = await getKlines(layer.symbol, '1h', 3)
  const candles = parseCandles(raw)
  const ultima  = getLatest(candles)

  if (layer.sesgo === 'LONG') {
    // Vela 1H cierra debajo del mínimo de la barrida
    if (ultima.close < layer.sweepLevel) {
      return {
        activo: true,
        razon:  `Cierre 1H $${ultima.close} bajo nivel barrida $${layer.sweepLevel}`,
      }
    }
  } else {
    // Vela 1H cierra encima del máximo de la barrida
    if (ultima.close > layer.sweepLevel) {
      return {
        activo: true,
        razon:  `Cierre 1H $${ultima.close} sobre nivel barrida $${layer.sweepLevel}`,
      }
    }
  }

  return { activo: false }
}

// ── Verificar TP y trailing ───────────────────────────────────

function verificarTP(state, pnl) {
  const pct = pnl.pnlNetoPct

  // TP fijo: +3% neto
  if (pct >= CONFIG.tp.targetPct) {
    return {
      tipo:  'TP_GLOBAL',
      activo: true,
      razon:  `PnL neto +${(pct * 100).toFixed(2)}% alcanza objetivo +${(CONFIG.tp.targetPct * 100).toFixed(0)}%`,
    }
  }

  // Trailing: activar en +3%, cerrar si retrocede 1% desde pico
  if (pct >= CONFIG.tp.trailingActivate) {
    // Actualizar pico
    if (pct > state.peakPnlNet) {
      state.peakPnlNet = pct
    }

    // Cerrar si retrocedió 1% desde el pico
    if (state.peakPnlNet - pct >= CONFIG.tp.trailingRetracement) {
      return {
        tipo:   'TRAILING',
        activo: true,
        razon:  `Trailing: PnL retrocedio de +${(state.peakPnlNet * 100).toFixed(2)}% a +${(pct * 100).toFixed(2)}%`,
      }
    }
  }

  return { activo: false, pct }
}

// ── Gestión principal de canasta activa ──────────────────────

async function gestionarCanasta(logSignal, capitalTotal) {
  const state = leerEstado()
  if (!state.active || state.layers.length === 0) return null

  // Leer precios actuales de todas las altcoins en la canasta
  const preciosActuales = {}
  for (const layer of state.layers) {
    try {
      const raw    = await getKlines(layer.symbol, '1h', 1)
      const cands  = parseCandles(raw)
      preciosActuales[layer.symbol] = getLatest(cands).close
    } catch { /* precio no disponible */ }
  }

  // Acumular funding
  acumularFunding(state)

  // Calcular PnL
  const pnl = calcularPnLCanasta(state, preciosActuales)

  console.log(`  [CANASTA] Capas: ${state.layers.length} | PnL: ${pnl.pnlNetoPct >= 0 ? '+' : ''}${(pnl.pnlNetoPct * 100).toFixed(2)}% | Funding: $${pnl.fundingTotal.toFixed(4)}`)

  // ── Kill switch ──────────────────────────────────────────
  const ks = verificarKillSwitch(state, preciosActuales, capitalTotal)

  if (ks.activo) {
    console.log(`  [KILL SWITCH] Nivel ${ks.nivel}: ${ks.razon}`)

    logSignal({
      action:   'WOULD_KILL_SWITCH',
      reason:   `KS nivel ${ks.nivel}: ${ks.razon}`,
      symbol:   state.layers[0]?.symbol,
      sesgo:    state.sesgo,
      score:    null,
      result_simulated: `pnlNeto: ${(pnl.pnlNetoPct * 100).toFixed(2)}%`,
    })

    resetEstado()
    return { evento: 'WOULD_KILL_SWITCH', pnl }
  }

  // ── Stop técnico ─────────────────────────────────────────
  const stop = await verificarStopTecnico(state)

  if (stop.activo) {
    console.log(`  [STOP TECNICO] ${stop.razon}`)

    logSignal({
      action:   'WOULD_CLOSE_TECHNICAL_STOP',
      reason:   stop.razon,
      symbol:   state.layers[0]?.symbol,
      sesgo:    state.sesgo,
      result_simulated: `pnlNeto: ${(pnl.pnlNetoPct * 100).toFixed(2)}%`,
    })

    resetEstado()
    return { evento: 'WOULD_CLOSE_TECHNICAL_STOP', pnl }
  }

  // ── TP y trailing ────────────────────────────────────────
  const tp = verificarTP(state, pnl)

  if (tp.activo) {
    const action = tp.tipo === 'TRAILING' ? 'WOULD_CLOSE_TRAILING' : 'WOULD_CLOSE_TP'
    console.log(`  [${action}] ${tp.razon}`)

    logSignal({
      action,
      reason:   tp.razon,
      symbol:   state.layers[0]?.symbol,
      sesgo:    state.sesgo,
      result_simulated: `pnlNeto: ${(pnl.pnlNetoPct * 100).toFixed(2)}%`,
    })

    resetEstado()
    return { evento: action, pnl }
  }

  // Actualizar pico y guardar estado
  if (pnl.pnlNetoPct > state.peakPnlNet) {
    state.peakPnlNet = pnl.pnlNetoPct
  }
  guardarEstado(state)

  return { evento: 'HOLDING', pnl, capas: state.layers.length }
}

// ── Abrir nueva capa simulada ─────────────────────────────────

async function simularAperturaCapa(symbol, sesgo, zonaLevel, logSignal, capitalTotal) {
  const state          = leerEstado()
  const capitalCanasta = capitalTotal * CONFIG.basket.capitalPct
  const capaNum        = state.layers.length + 1

  if (capaNum > CONFIG.basket.maxLayers) return null

  const nocional = capitalCanasta * CONFIG.basket.layerDist[capaNum - 1]

  // Leer precio y funding actual del símbolo
  let entryPrice = 0
  let fundingRate = 0

  try {
    const raw  = await getKlines(symbol, '1h', 1)
    entryPrice = getLatest(parseCandles(raw)).close
  } catch { return null }

  try {
    const f    = await getFundingRate(symbol)
    fundingRate = f ? parseFloat(f.fundingRate) : 0
  } catch {}

  abrirCapa(symbol, sesgo, entryPrice, nocional, zonaLevel, fundingRate)

  logSignal({
    action:  capaNum === 1 ? `WOULD_OPEN_${sesgo}` : 'WOULD_ADD_LAYER',
    reason:  `Capa ${capaNum} | ${symbol} @ $${entryPrice.toFixed(4)} | capital $${nocional.toFixed(2)}`,
    symbol,
    sesgo,
    result_simulated: `capa: ${capaNum} | nocional: $${nocional.toFixed(2)} | entry: ${entryPrice.toFixed(4)}`,
  })

  console.log(`  [${capaNum === 1 ? 'WOULD_OPEN' : 'WOULD_ADD_LAYER'}] ${symbol} capa ${capaNum} @ $${entryPrice.toFixed(4)} | $${nocional.toFixed(2)}`)

  return { capaNum, symbol, entryPrice, nocional }
}

module.exports = { gestionarCanasta, simularAperturaCapa, calcularPnLCanasta }
