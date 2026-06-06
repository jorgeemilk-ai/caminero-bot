/**
 * basketState.js — Sprint 8
 * Persiste el estado de la canasta simulada en basket-state.json
 * entre ciclos del bot.
 */

const fs   = require('fs')
const path = require('path')

const STATE_FILE = path.join(__dirname, '../../storage/basket-state.json')

const EMPTY_STATE = {
  active:           false,
  sesgo:            null,
  openedAt:         null,
  layers:           [],       // array de posiciones abiertas
  peakPnlNet:       0,        // máximo PnL neto alcanzado (para trailing)
  lastLayerTime:    null,     // timestamp de la última capa abierta
  killSwitchActive: false,
}

function leerEstado() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { ...EMPTY_STATE }
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { ...EMPTY_STATE }
  }
}

function guardarEstado(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function resetEstado() {
  guardarEstado({ ...EMPTY_STATE })
}

/**
 * Abrir primera capa
 */
function abrirCapa(symbol, sesgo, entryPrice, capital, sweepLevel, fundingRate = 0) {
  const state = leerEstado()

  const nuevaCapa = {
    symbol,
    capa:        state.layers.length + 1,
    sesgo,
    entryPrice,
    capital,
    leverage:    2,
    sweepLevel,
    openedAt:    new Date().toISOString(),
    fundingPaid: 0,
    fundingRate,
  }

  state.active        = true
  state.sesgo         = sesgo
  state.openedAt      = state.openedAt || new Date().toISOString()
  state.lastLayerTime = new Date().toISOString()
  state.layers.push(nuevaCapa)

  guardarEstado(state)
  return state
}

/**
 * Añadir funding acumulado a cada capa (se llama cada ciclo)
 */
function acumularFunding(state) {
  for (const layer of state.layers) {
    // Funding se cobra cada 8h — aproximado por ciclo de 15min
    // 15min / 480min(8h) = 0.03125 períodos por ciclo
    const fraccion = 15 / 480
    const fundingCiclo = Math.abs(layer.fundingRate || 0) * fraccion * layer.leverage
    layer.fundingPaid += fundingCiclo
  }
  return state
}

module.exports = { leerEstado, guardarEstado, resetEstado, abrirCapa, acumularFunding }
