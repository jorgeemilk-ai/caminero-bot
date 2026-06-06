require('dotenv').config()

const cron    = require('node-cron')
const CONFIG  = require('./config')
const { logSignal, logError, ensureStorageExists } = require('./logs/signalLogger')
const { getKlines, getFundingRate }                = require('./data/binanceClient')
const { parseCandles, getVolumeRatio }             = require('./utils/candles')
const { analizarBTC }                              = require('./strategy/btcBias')
const { calcularLiquidez, liquidezValida }         = require('./strategy/liquidity')
const { detectarBarrida }                          = require('./strategy/sweepDetector')
const { analizarCVD }                              = require('./strategy/cvdSignal')
const { confirmarAltcoins }                        = require('./strategy/altcoinConfirmation')
const { seleccionarMejorAltcoin,
        calcularScoreAltcoin }                     = require('./strategy/altcoinScore')
const { leerEstado, abrirCapa, resetEstado }       = require('./basket/basketState')
const { gestionarCanasta }                         = require('./basket/basketManager')
const { analizarOI }                               = require('./data/coinglassClient')
const { ejecutarAbrirCapa, ejecutarCerrarCanasta,
        getMaxCapasPaper, BOT_MODE }               = require('./execution/executionRouter')

const BOT_NAME   = 'Caminero Bot V8.4'
const MODO_LABEL = BOT_MODE === 'PAPER' ? 'PAPER (Finandy real)' :
                   BOT_MODE === 'LIVE'  ? 'LIVE' : 'OBSERVER'

console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•')
console.log(`  ${BOT_NAME}`)
console.log(`  BTC Liquidity + Dual CVD + Altcoin Basket`)
console.log(`  Modo: ${MODO_LABEL}`)
console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•')
console.log(`  Capital: $${CONFIG.simulatedCapital} USDT`)
console.log(`  Canasta: ${CONFIG.altcoins.join(', ')}`)
if (BOT_MODE === 'PAPER') {
  console.log(`  Capas max esta semana: ${getMaxCapasPaper()}`)
}
console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n')

ensureStorageExists()

// â”€â”€ Scan de altcoins (corre siempre, independiente del flujo) â”€â”€
async function scanAltcoins(sesgo) {
  try {
    const rawBTC  = await getKlines(CONFIG.patron, '1h', 21)
    const candBTC = parseCandles(rawBTC)
    const btcCls  = candBTC.map(c => c.close)
    const retBTC  = (btcCls[btcCls.length-1] - btcCls[0]) / btcCls[0]

    const scores = []
    for (const symbol of CONFIG.altcoins) {
      try {
        const r = await calcularScoreAltcoin(symbol, sesgo, btcCls, retBTC)
        scores.push({
          symbol,
          score:      r.score || r.subtotal || 0,
          subtotal:   r.subtotal || 0,
          fuerza:     r.fuerza ? parseFloat(r.fuerza.toFixed(3)) : null,
          descartado: r.descartado || false,
          razonDesc:  r.razon || null,
          detalle: {
            correlacion: r.detalle?.correlacion?.pts ?? null,
            liquidez:    r.detalle?.liquidez?.pts    ?? null,
            funding:     r.detalle?.funding?.pts     ?? null,
            spread:      r.detalle?.spread?.pts      ?? null,
            corrVal:     r.detalle?.correlacion?.correl ?? null,
            distance:    r.detalle?.liquidez?.distance  ?? null,
            volRatio:    r.detalle?.spread?.volRatio     ?? null,
          }
        })
      } catch { /* skip */ }
    }

    return scores
  } catch {
    return []
  }
}

async function runCycle() {
  const cycleTime    = new Date().toISOString()
  const capitalTotal = CONFIG.simulatedCapital
  console.log(`\n [${BOT_NAME}] Ciclo: ${cycleTime}  [${BOT_MODE}]`)

  try {

    // â”€â”€ Canasta activa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const state = leerEstado()

    if (state.active) {
      const resultado = await gestionarCanasta(
        (signal) => logSignal({ ...signal, botName: BOT_NAME, modo: BOT_MODE }),
        capitalTotal
      )

      if (resultado?.evento && resultado.evento !== 'HOLDING') {
        if (BOT_MODE !== 'OBSERVER' && state.layers?.length > 0) {
          await ejecutarCerrarCanasta(state.layers, resultado.evento, logSignal)
        }
        resetEstado()
        return
      }

      if (resultado?.evento === 'HOLDING' && resultado.capas < CONFIG.basket.maxLayers) {
        const maxCapas = BOT_MODE === 'PAPER' ? getMaxCapasPaper() : CONFIG.basket.maxLayers
        if (resultado.capas < maxCapas) {
          const minutos = state.lastLayerTime
            ? (Date.now() - new Date(state.lastLayerTime).getTime()) / 60000
            : 999

          if (minutos >= 90) {
            const scoreR = await seleccionarMejorAltcoin(
              state.sesgo, state.layers.map(l => l.symbol))
            if (scoreR.found && scoreR.score >= CONFIG.basket.minScoreNewLayer) {
              const capaNum = state.layers.length + 1
              await ejecutarAbrirCapa(scoreR.symbol, state.sesgo, capaNum, logSignal)
            }
          } else {
            console.log(`  [CANASTA] ${resultado.capas} capa(s) activa(s)`)
          }
        }
      }
      return
    }

    // â”€â”€ Sprint 1: datos bÃ¡sicos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const rawKlines = await getKlines(CONFIG.patron, '1h', 5)
    const candles   = parseCandles(rawKlines)
    const volRatio  = getVolumeRatio(candles, CONFIG.sweep.volumeWindow)

    let fundingBTC = null
    try {
      const f = await getFundingRate(CONFIG.patron)
      fundingBTC = f ? parseFloat(f.fundingRate) : null
    } catch (err) { logError('funding:BTC', err) }

    // â”€â”€ Sprint 2: BTC Bias (7 dÃ­as) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const bias = await analizarBTC()
    console.log(`  BTC: $${bias.price.toLocaleString()} | ${bias.zone} | Sesgo: ${bias.sesgo}`)
    if (fundingBTC !== null) {
      const daily = fundingBTC * CONFIG.funding.periodsPerDay
      console.log(`  Funding: ${(fundingBTC*100).toFixed(4)}% (${(daily*100).toFixed(4)}%/dÃ­a)`)
    }

    // â”€â”€ Scan altcoins (siempre, para el dashboard) â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const altScores = await scanAltcoins(bias.sesgo)
    console.log(`  Altcoin scan: ${altScores.map(s =>
      s.symbol.replace('USDT','') + ':' + (s.descartado ? 'X' : s.subtotal)
    ).join(' | ')}`)

    // Registrar scan siempre para el dashboard
    logSignal({
      action:      'MARKET_SCAN',
      reason:      `BTC ${bias.sesgo} ${(bias.position*100).toFixed(1)}% | Rango 5d`,
      symbol:      CONFIG.patron,
      sesgo:       bias.sesgo,
      btcZone:     bias.zone,
      btcPosition: parseFloat(bias.position.toFixed(4)),
      funding:     fundingBTC,
      fundingDaily: fundingBTC ? parseFloat((fundingBTC * CONFIG.funding.periodsPerDay).toFixed(6)) : null,
      altcoinScores: altScores,
      botName:     BOT_NAME,
      timestamp:   cycleTime,
    })

    if (bias.sesgo === 'NO_OPERAR') {
      console.log(`  --> NO_TRADE_BTC_MIDDLE_RANGE`)
      logSignal({ action: 'NO_TRADE_BTC_MIDDLE_RANGE', reason: bias.reason,
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â”€â”€ Sprint 3: Liquidez â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const liquidez   = await calcularLiquidez(CONFIG.patron)
    const liqOk      = liquidezValida(liquidez, bias.sesgo)
    const zonaTarget = liquidez.zones.find(z =>
      bias.sesgo === 'LONG'  ? z.direction === 'DOWN' :
      bias.sesgo === 'SHORT' ? z.direction === 'UP'   : false
    )
    console.log(`  Liquidez: ${liquidez.zones.length} zonas | Target: ${zonaTarget ? '$' + zonaTarget.level.toFixed(1) + ' (' + zonaTarget.strength + ')' : 'ninguna'}`)

    if (!liqOk || !zonaTarget) {
      console.log(`  --> NO_TRADE_NO_LIQUIDITY`)
      logSignal({ action: 'NO_TRADE_NO_LIQUIDITY', reason: 'Sin zona valida',
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: zonaTarget?.level ?? null,
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â”€â”€ Sprint 4: Barrida â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const barrida = await detectarBarrida(bias.sesgo, zonaTarget.level)
    console.log(`  Barrida: ${barrida.valid ? 'CONFIRMADA âœ“' : 'no detectada'} | ${barrida.reason}`)

    if (!barrida.valid) {
      console.log(`  --> NO_TRADE_NO_SWEEP`)
      logSignal({ action: 'NO_TRADE_NO_SWEEP', reason: barrida.reason,
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: parseFloat(zonaTarget.level.toFixed(2)),
        sweepConfirmed: false, funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â”€â”€ Sprint 5: CVD BTC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const cvdBTC = await analizarCVD(CONFIG.patron, bias.sesgo)
    console.log(`  CVD BTC: ${cvdBTC.confirmed ? 'CONFIRMA âœ“' : 'no confirma'} | ${cvdBTC.reason}`)

    if (!cvdBTC.confirmed) {
      console.log(`  --> NO_TRADE_CVD_BTC_FAIL`)
      logSignal({ action: 'NO_TRADE_CVD_BTC_FAIL', reason: cvdBTC.reason,
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: parseFloat(zonaTarget.level.toFixed(2)),
        sweepConfirmed: true, cvdBTC: 'FAIL',
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â”€â”€ Coinglass OI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const oi = await analizarOI(CONFIG.patron, bias.sesgo)
    console.log(`  OI: ${oi.fallback ? 'N/A' : oi.razon}`)

    if (!oi.confirma && !oi.fallback) {
      console.log(`  --> NO_TRADE_CVD_BTC_FAIL (OI desapalancando)`)
      logSignal({ action: 'NO_TRADE_CVD_BTC_FAIL', reason: `OI: ${oi.razon}`,
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: parseFloat(zonaTarget.level.toFixed(2)),
        sweepConfirmed: true, cvdBTC: 'OK',
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â”€â”€ Sprint 6: Altcoins acompaÃ±ando â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const altConf = await confirmarAltcoins(bias.sesgo)
    console.log(`  Altcoins: ${altConf.confirmadas}/${altConf.total} acompaÃ±an`)

    if (!altConf.valido) {
      console.log(`  --> NO_TRADE_ALTCOINS_NOT_CONFIRMING`)
      logSignal({ action: 'NO_TRADE_ALTCOINS_NOT_CONFIRMING',
        reason: `Solo ${altConf.confirmadas}/${altConf.total} altcoins acompaÃ±an`,
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: parseFloat(zonaTarget.level.toFixed(2)),
        sweepConfirmed: true, cvdBTC: 'OK', cvdAltcoin: 'FAIL',
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    let cvdAltcoinOK = []
    for (const symbol of altConf.simbolos) {
      try {
        const cvd = await analizarCVD(symbol, bias.sesgo)
        if (cvd.confirmed) cvdAltcoinOK.push(symbol)
      } catch (err) { logError(`cvdAlt:${symbol}`, err) }
    }

    if (cvdAltcoinOK.length === 0) {
      console.log(`  --> NO_TRADE_CVD_BTC_FAIL (altcoins sin CVD)`)
      logSignal({ action: 'NO_TRADE_CVD_BTC_FAIL',
        reason: 'Altcoins sin CVD confirmado',
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: parseFloat(zonaTarget.level.toFixed(2)),
        sweepConfirmed: true, cvdBTC: 'OK', cvdAltcoin: 'FAIL',
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â”€â”€ Sprint 7: Score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const scoreResult = await seleccionarMejorAltcoin(bias.sesgo)

    if (!scoreResult.found) {
      console.log(`  --> NO_TRADE_SCORE_LOW`)
      logSignal({ action: 'NO_TRADE_SCORE_LOW', reason: scoreResult.reason,
        symbol: CONFIG.patron, sesgo: bias.sesgo, btcZone: bias.zone,
        btcPosition: parseFloat(bias.position.toFixed(4)),
        liquidityLevel: parseFloat(zonaTarget.level.toFixed(2)),
        sweepConfirmed: true, cvdBTC: 'OK',
        funding: fundingBTC, timestamp: cycleTime, botName: BOT_NAME })
      return
    }

    // â•â• CADENA COMPLETA â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const capitalCanasta = capitalTotal * CONFIG.basket.capitalPct
    const nocional       = capitalCanasta * CONFIG.basket.layerDist[0]

    console.log(`\n  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—`)
    console.log(`  â•‘  ðŸŽ¯ ${BOT_MODE}_OPEN_${bias.sesgo}`)
    console.log(`  â•‘  ${scoreResult.symbol} | Score: ${scoreResult.score}/100 | $${nocional.toFixed(2)}`)
    console.log(`  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n`)

    const f  = await getFundingRate(scoreResult.symbol).catch(() => null)
    const fr = f ? parseFloat(f.fundingRate) : 0
    abrirCapa(scoreResult.symbol, bias.sesgo, bias.price, nocional, zonaTarget.level, fr)
    await ejecutarAbrirCapa(scoreResult.symbol, bias.sesgo, 1, logSignal)

    logSignal({
      action:            BOT_MODE === 'PAPER' ? `PAPER_OPEN_${bias.sesgo}` : `WOULD_OPEN_${bias.sesgo}`,
      reason:            `Cadena completa | score ${scoreResult.score} | zona $${zonaTarget.level.toFixed(1)}`,
      symbol:            scoreResult.symbol,
      sesgo:             bias.sesgo,
      btcZone:           bias.zone,
      btcPosition:       parseFloat(bias.position.toFixed(4)),
      score:             scoreResult.score,
      liquidityLevel:    parseFloat(zonaTarget.level.toFixed(2)),
      liquidityDistance: parseFloat(zonaTarget.distance.toFixed(4)),
      sweepConfirmed:    true,
      mechaValue:        parseFloat(barrida.mecha.toFixed(4)),
      cvdBTC:            'OK',
      cvdAltcoin:        cvdAltcoinOK.join(','),
      funding:           fundingBTC,
      fundingDaily:      fundingBTC ? parseFloat((fundingBTC * CONFIG.funding.periodsPerDay).toFixed(6)) : null,
      volumeRatio:       parseFloat(barrida.volRatio?.toFixed(3) ?? volRatio.toFixed(3)),
      altcoinScores:     altScores,
      result_simulated:  `capital: $${nocional.toFixed(2)} | modo: ${BOT_MODE}`,
      timestamp:         cycleTime,
      botName:           BOT_NAME,
    })

  } catch (error) {
    logError('runCycle', error)
  }
}

runCycle()
cron.schedule(CONFIG.intervals.cron, runCycle)
console.log(`[${BOT_NAME}] Corriendo en modo ${BOT_MODE}. Ciclos: ${CONFIG.intervals.cron}\n`)

