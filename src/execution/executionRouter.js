/**
 * executionRouter.js
 * Enruta las órdenes según el modo del bot.
 *
 * OBSERVER: solo registra (WOULD_OPEN, WOULD_CLOSE)
 * PAPER:    envía webhooks reales a Finandy (dinero real, capital mínimo)
 * LIVE:     igual que PAPER pero sin restricciones de capital
 *
 * Semana 1 PAPER: máximo 1 capa
 * Semana 2 PAPER: máximo 2 capas
 * Semana 3+:      máximo 3 capas
 */

require('dotenv').config()
const { abrirLong, abrirShort, cerrarPosicion } = require('./finandyWebhook')

const BOT_MODE = process.env.BOT_MODE || 'OBSERVER'

// Límite de capas por semana en PAPER
function getMaxCapasPaper() {
  const inicio = process.env.PAPER_START_DATE
    ? new Date(process.env.PAPER_START_DATE)
    : new Date()

  const diasTranscurridos = Math.floor(
    (Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (diasTranscurridos < 7)  return 1   // Semana 1
  if (diasTranscurridos < 14) return 2   // Semana 2
  return 3                               // Semana 3+
}

// ── Abrir capa ───────────────────────────────────────────────

async function ejecutarAbrirCapa(symbol, sesgo, capa, logSignal) {
  const action = sesgo === 'LONG' ? 'WOULD_OPEN_LONG' : 'WOULD_OPEN_SHORT'

  if (BOT_MODE === 'OBSERVER') {
    // Solo registrar
    logSignal({
      action: capa === 1 ? action : 'WOULD_ADD_LAYER',
      reason: `[OBSERVER] Capa ${capa} | ${symbol} | ${sesgo}`,
      symbol,
      sesgo,
    })
    return { modo: 'OBSERVER', accion: 'registrado' }
  }

  if (BOT_MODE === 'PAPER' || BOT_MODE === 'LIVE') {
    // Verificar límite de capas en PAPER
    if (BOT_MODE === 'PAPER') {
      const maxCapas = getMaxCapasPaper()
      if (capa > maxCapas) {
        console.log(`  [ROUTER] Capa ${capa} bloqueada — PAPER semana actual permite max ${maxCapas}`)
        return { modo: 'PAPER', accion: 'bloqueada', razon: `max ${maxCapas} capas esta semana` }
      }
    }

    // Enviar señal real a Finandy
    try {
      let resultado
      if (sesgo === 'LONG') {
        resultado = await abrirLong(symbol)
      } else {
        resultado = await abrirShort(symbol)
      }

      logSignal({
        action:  capa === 1 ? action : 'WOULD_ADD_LAYER',
        reason:  `[${BOT_MODE}] Capa ${capa} enviada a Finandy | ${symbol} | ${sesgo}`,
        symbol,
        sesgo,
        result_simulated: JSON.stringify(resultado),
      })

      return { modo: BOT_MODE, accion: 'enviado', resultado }

    } catch (err) {
      console.error(`  [ROUTER ERROR] Finandy: ${err.message}`)
      logSignal({
        action: 'ERROR',
        reason: `Finandy error capa ${capa}: ${err.message}`,
        symbol,
        sesgo,
      })
      return { modo: BOT_MODE, accion: 'error', error: err.message }
    }
  }

  return { modo: BOT_MODE, accion: 'sin_accion' }
}

// ── Cerrar canasta ───────────────────────────────────────────

async function ejecutarCerrarCanasta(layers, razon, logSignal) {
  if (BOT_MODE === 'OBSERVER') {
    logSignal({ action: 'WOULD_CLOSE_TP', reason: `[OBSERVER] ${razon}` })
    return { modo: 'OBSERVER', cerradas: layers.length }
  }

  if (BOT_MODE === 'PAPER' || BOT_MODE === 'LIVE') {
    const resultados = []
    for (const layer of layers) {
      try {
        const r = await cerrarPosicion(layer.symbol, layer.sesgo)
        resultados.push({ symbol: layer.symbol, ok: true, r })
        console.log(`  [ROUTER] Cerrada ${layer.symbol} ${layer.sesgo}`)
      } catch (err) {
        resultados.push({ symbol: layer.symbol, ok: false, error: err.message })
        console.error(`  [ROUTER ERROR] Cerrar ${layer.symbol}: ${err.message}`)
      }
    }

    logSignal({
      action: 'WOULD_CLOSE_TP',
      reason: `[${BOT_MODE}] ${razon} | ${layers.length} posiciones`,
      result_simulated: JSON.stringify(resultados),
    })

    return { modo: BOT_MODE, cerradas: resultados.filter(r => r.ok).length }
  }

  return { modo: BOT_MODE, accion: 'sin_accion' }
}

module.exports = {
  ejecutarAbrirCapa,
  ejecutarCerrarCanasta,
  getMaxCapasPaper,
  BOT_MODE,
}
