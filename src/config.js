require('dotenv').config()

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONFIG CENTRAL â€” BTC Liquidity + Dual CVD + Altcoin Basket
// V8.4 â€” Todos los fixes incorporados
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CONFIG = {

  // â”€â”€ Activos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  patron:   'BTCUSDT',
  altcoins: ['XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'SOLUSDT'],

  // â”€â”€ Modo del sistema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  botMode: process.env.BOT_MODE || 'OBSERVER',
  simulatedCapital: parseFloat(process.env.SIMULATED_CAPITAL || '100'),

  // â”€â”€ Intervalos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  intervals: {
    cron:       '*/15 * * * *',  // ciclo principal cada 15 min
    kline1h:    '1h',
    kline15m:   '15m',
    lookback1h:  120,            // 120 velas 1H = 5 dÃ­as para BTC bias
    lookback15m: 50,             // 50 velas 15m para barrida y altcoins
  },

  // â”€â”€ BTC Bias â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FIX: bordes con < y > estrictos (no <= ni >=) para evitar solapamiento
  btcBias: {
    longZona:  0.30,   // posiciÃ³n < 0.30 â†’ LONG
    shortZona: 0.70,   // posiciÃ³n > 0.70 â†’ SHORT
    // entre 0.30 y 0.70 â†’ NO_OPERAR
  },

  // â”€â”€ Liquidez estimada (V8.3 sin Coinglass) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  liquidity: {
    volumeMultiplier:  2.0,     // velas con volumen >= 2x promedio
    clusterTolerance:  0.0025,  // Â±0.25% para agrupar niveles
    maxDistance:       0.03,    // zona vÃ¡lida mÃ¡x 3% del precio
    sweepWithin:       0.02,    // barrida debe ocurrir dentro del 2%
    swingLookback:     3,       // velas vecinas para detectar swing high/low
  },

  // â”€â”€ Barrida (sweepDetector) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sweep: {
    breakMin:        0.002,   // precio rompe zona al menos 0.2%
    mechaMin:        0.40,    // mecha >= 40% del rango high-low
    volumeMultiplier: 1.5,    // volumen >= 1.5x promedio
    volumeWindow:    20,      // promedio sobre Ãºltimas 20 velas
    // FÃ³rmula mecha:
    // mechaInf = (min(open,close) - low) / (high - low)
    // mechaSup = (high - max(open,close)) / (high - low)
  },

  // â”€â”€ CVD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  cvd: {
    window:          50,   // velas 1H para CVD acumulado
    divergenceRange: 20,   // velas para buscar swing previo
    // delta = takerBuyVolume - takerSellVolume
    // CVD acumulado = suma(delta) rolling
  },

  // â”€â”€ ConfirmaciÃ³n altcoins â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FIX: ventana 2H (8 velas 15m), umbral Ãºnico 0.35%
  altcoinConfirmation: {
    window:    8,       // 8 velas de 15m = 2 horas
    threshold: 0.0035,  // Â±0.35% para acompaÃ±ar al sesgo
    minCount:  2,       // mÃ­nimo 2 de 5 altcoins deben acompaÃ±ar
  },

  // â”€â”€ Score de altcoin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FIX: fÃ³rmulas completas para los 5 componentes
  score: {
    minimum:       75,
    newLayer:      80,   // FIX: score para capas 2 y 3
    strong:        85,
    exceptional:   90,

    weights: {
      correlation:    20,
      fuerzaRelativa: 25,
      liquidez:       20,
      funding:        20,
      spreadVolumen:  15,
      // Total base: 100
      // Bonus funding favorable: hasta +5 (max total = 100, cap aplicado)
    },

    // CorrelaciÃ³n (Pearson 1H, 20 velas)
    correlacion: {
      ventana: 20,
      min:     0.60,   // < 0.60 â†’ descartar altcoin
      // >= 0.80 â†’ 20 pts
      // 0.70-0.79 â†’ 15 pts
      // 0.60-0.69 â†’ 10 pts
    },

    // Fuerza relativa â†’ ranking (solo top 3 puntÃºan)
    fuerzaRelativa: {
      // 1er lugar â†’ 25 pts
      // 2do lugar â†’ 18 pts
      // 3er lugar â†’ 10 pts
      // 4to/5to   â†’  0 pts
    },

    // Liquidez (distancia a zona mÃ¡s cercana)
    liquidez: {
      // < 1%  â†’ 20 pts
      // < 2%  â†’ 15 pts
      // < 3%  â†’ 10 pts
      // >= 3% â†’  0 pts
    },

    // Funding (normalizado a 24h, contra la posiciÃ³n)
    funding: {
      // <= 0.10%/dÃ­a â†’ 20 pts
      // <= 0.20%/dÃ­a â†’ 10 pts
      // > 0.20%/dÃ­a  â†’  0 pts (y bloqueado de todas formas)
      // favorable (a favor) â†’ +5 bonus, cap a 100
    },

    // Spread / volumen
    spreadVolumen: {
      // spread < 0.10% && volRatio >= 1.5 â†’ 15 pts
      // spread < 0.20% && volRatio >= 1.0 â†’  8 pts
      // else                              â†’  0 pts
    },
  },

  // â”€â”€ Funding filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Normalizado a 24h: fundingDiario = fundingPorPeriodo Ã— 3 (Binance cada 8h)
  funding: {
    periodsPerDay: 3,
    normal:        0.0010,  // 0.10% diario â†’ normal
    caution:       0.0020,  // 0.20% diario â†’ solo si score >= 85
    block:         0.0020,  // > 0.20% diario â†’ bloquear entrada
    closeExposure: 0.0035,  // > 0.35% diario â†’ reducir/cerrar si dentro
    // (regla de cierre va en basketManager, no en fundingFilter)
  },

  // â”€â”€ Spread y volumen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  spread: {
    good:           0.0010,  // < 0.10% â†’ bueno
    acceptable:     0.0020,  // < 0.20% â†’ aceptable
    block:          0.0020,  // > 0.20% â†’ bloquear
    minVolumeRatio: 0.50,    // FIX: volRatio < 0.50 â†’ bloquear (mercado muerto)
  },

  // â”€â”€ Canasta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FIX: distribuciÃ³n progresiva restaurada (V8.3)
  // FIX: condiciÃ³n capa 2/3 = mejora promedio global (no "canasta positiva")
  basket: {
    maxLayers:    3,
    capitalPct:   0.40,           // 40% del capital total
    leverage:     2,
    margin:       'ISOLATED',
    layerDist:    [0.30, 0.33, 0.37],  // progresiva: mejor precio = mÃ¡s capital

    // Condiciones para nueva capa
    minTimeBetweenLayers: 6,       // velas de 15m = 90 minutos
    minScoreNewLayer:     80,      // score mÃ­nimo para capa 2/3
    maxDrawdownFromPeak:  0.03,    // drawdown desde pico < 3%
    // La capa debe mejorar el precio promedio global (no requiere canasta positiva)
  },

  // â”€â”€ TP y trailing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FIX: trailing definido en tÃ©rminos de PnL neto, no precio
  tp: {
    targetPct:            0.03,   // +3% neto sobre capital canasta
    protectionActivate:   0.02,   // mover a breakeven cuando PnL >= +2%
    trailingActivate:     0.03,   // activar trailing cuando PnL >= +3%
    trailingRetracement:  0.01,   // cerrar si PnL cae 1% desde mÃ¡ximo
    // Ejemplo: PnL llega a +4.5%, retrocede a +3.5% â†’ cerrar (cayÃ³ 1%)
  },

  // â”€â”€ Stop tÃ©cnico â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  technicalStop: {
    // LONG: cerrar si vela 1H cierra bajo el mÃ­nimo de la barrida
    // SHORT: cerrar si vela 1H cierra sobre el mÃ¡ximo de la barrida
    // + CVD deja de confirmar absorciÃ³n
  },

  // â”€â”€ Kill switch â€” 3 niveles separados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  killSwitch: {
    positionMarginLoss: 0.35,  // posiciÃ³n individual pierde 35% del margen
    basketCapitalLoss:  0.10,  // canasta pierde 10% del capital asignado
    accountTotalLoss:   0.06,  // cuenta pierde 6% del capital total
    // Con 100 USDT y canasta de 40 USDT:
    // Kill 2 = 4 USDT de pÃ©rdida en canasta
    // Kill 3 = 6 USDT de pÃ©rdida total
    // Son diferentes âœ“
  },

  // â”€â”€ SeÃ±al opuesta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  signalOpposite: {
    minScore:        85,    // score mÃ­nimo para considerar cambio de direcciÃ³n
    waitCandles:     1,     // esperar 1 vela de 1H antes de abrir nueva direcciÃ³n
  },

  // â”€â”€ Criterios de avance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FIX: A, B, X definidos explÃ­citamente
  advanceCriteria: {
    // A = seÃ±ales WOULD_OPEN donde el precio fue en la direcciÃ³n correcta
    // B = seÃ±ales donde el TP simulado fue alcanzado
    // X = seÃ±ales que habrÃ­an activado kill switch
    minAB:        0.55,   // A + B >= 55% para pasar a paper
    maxX:         0.15,   // X <= 15%
    minSamples:   30,     // mÃ­nimo 30 casos analizados
    maxFunding:   0.20,   // funding daÃ±ino <= 20% de los casos
    minAltcoin:   0.70,   // selecciÃ³n correcta de altcoin >= 70%
    maxKill:      0.10,   // kill switch simulado <= 10%
  },
}

// â”€â”€ Validaciones de seguridad al cargar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (CONFIG.botMode !== 'LIVE' && process.env.BINANCE_API_KEY) {
  console.error('[SAFETY] BINANCE_API_KEY detectada en modo no-LIVE. Remover del .env.')
  process.exit(1)
}

if (process.env.ALLOW_REAL_TRADING === 'true' && CONFIG.botMode !== 'LIVE' && CONFIG.botMode !== 'PAPER') {
  console.error('[SAFETY] ALLOW_REAL_TRADING=true pero BOT_MODE no es LIVE. Abortando.')
  process.exit(1)
}

module.exports = CONFIG

