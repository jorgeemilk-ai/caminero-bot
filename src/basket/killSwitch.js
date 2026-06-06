/**
 * killSwitch.js — Sprint 8
 * Tres niveles de protección de capital.
 *
 * Nivel 1: posición individual pierde 35% del margen asignado
 * Nivel 2: canasta pierde 10% del capital asignado
 * Nivel 3: cuenta pierde 6% del capital total
 */

const CONFIG = require('../config')

function verificarKillSwitch(state, preciosActuales, capitalTotal) {
  const capitalCanasta = capitalTotal * CONFIG.basket.capitalPct

  let pnlBrutoTotal  = 0
  let capasAfectadas = []

  for (const layer of state.layers) {
    const precioActual = preciosActuales[layer.symbol]
    if (!precioActual) continue

    // PnL bruto de esta capa
    const pnlPct = layer.sesgo === 'LONG'
      ? (precioActual - layer.entryPrice) / layer.entryPrice
      : (layer.entryPrice - precioActual) / layer.entryPrice

    const pnlUSDT = pnlPct * layer.capital * layer.leverage
    pnlBrutoTotal += pnlUSDT

    // Kill switch nivel 1: posición individual pierde 35% del margen
    const margenAsignado = layer.capital   // capital puesto como margen
    const perdidaMargen  = -pnlUSDT / margenAsignado

    if (perdidaMargen >= CONFIG.killSwitch.positionMarginLoss) {
      capasAfectadas.push({
        nivel:   1,
        symbol:  layer.symbol,
        capa:    layer.capa,
        perdida: parseFloat(perdidaMargen.toFixed(4)),
        razon:   `Posicion ${layer.symbol} perdio ${(perdidaMargen * 100).toFixed(1)}% del margen`,
      })
    }
  }

  // Kill switch nivel 2: canasta pierde 10% del capital asignado
  const pnlNetoTotal    = pnlBrutoTotal - state.layers.reduce((a, l) => a + (l.fundingPaid * l.capital), 0)
  const perdidaCanasta  = -pnlNetoTotal / capitalCanasta

  if (perdidaCanasta >= CONFIG.killSwitch.basketCapitalLoss) {
    return {
      activo: true,
      nivel:  2,
      razon:  `Canasta perdio ${(perdidaCanasta * 100).toFixed(1)}% del capital asignado`,
      pnlNeto: parseFloat(pnlNetoTotal.toFixed(4)),
      capasAfectadas,
    }
  }

  // Kill switch nivel 3: cuenta pierde 6% del capital total
  const perdidaCuenta = -pnlNetoTotal / capitalTotal

  if (perdidaCuenta >= CONFIG.killSwitch.accountTotalLoss) {
    return {
      activo: true,
      nivel:  3,
      razon:  `Cuenta perdio ${(perdidaCuenta * 100).toFixed(1)}% del capital total`,
      pnlNeto: parseFloat(pnlNetoTotal.toFixed(4)),
      capasAfectadas,
    }
  }

  // Nivel 1 — cerrar solo posiciones afectadas
  if (capasAfectadas.length > 0) {
    return {
      activo: true,
      nivel:  1,
      razon:  capasAfectadas[0].razon,
      capasAfectadas,
      pnlNeto: parseFloat(pnlNetoTotal.toFixed(4)),
    }
  }

  return {
    activo:  false,
    pnlNeto: parseFloat(pnlNetoTotal.toFixed(4)),
    pnlBruto: parseFloat(pnlBrutoTotal.toFixed(4)),
  }
}

module.exports = { verificarKillSwitch }
