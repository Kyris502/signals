const http = require('http');
const https = require('https');

// YOUR PUSH TOKEN
const PUSH_TOKEN = 'ExponentPushToken[2_TkioJHlKTlrewxCpA9jR]';

const CHECK_INTERVAL = 15000;
const MIN_CONFIDENCE = 60;
const MIN_AGREE = 3;
const COOLDOWN = 120000;
const PAIRS = [
  { sym: 'btcusdt', label: 'BTC/USDT', dec: 2 },
  { sym: 'ethusdt', label: 'ETH/USDT', dec: 2 },
  { sym: 'solusdt', label: 'SOL/USDT', dec: 3 },
  { sym: 'bnbusdt', label: 'BNB/USDT', dec: 2 },
  { sym: 'xrpusdt', label: 'XRP/USDT', dec: 4 },
  { sym: 'dogeusdt', label: 'DOGE/USDT', dec: 5 },
];
const TIMEFRAME = '5m';

let lastNotifTime = 0;
let lastSignals = {};
let serverStats = { started: new Date().toISOString(), checks: 0, notifications: 0, lastCheck: null, lastSignal: null };

function sendPush(title, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ to: PUSH_TOKEN, sound: 'default', title: title, body: body, priority: 'high' });
    const options = { hostname: 'exp.host', path: '/--/api/v2/push/send', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(options, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => { console.log('[PUSH] Sent:', title); serverStats.notifications++; resolve(b); }); });
    req.on('error', (e) => { console.error('[PUSH] Error:', e.message); reject(e); });
    req.write(data); req.end();
  });
}

function fetchCandles(symbol, interval) {
  return new Promise((resolve, reject) => {
    https.get('https://api.binance.com/api/v3/klines?symbol=' + symbol.toUpperCase() + '&interval=' + interval + '&limit=80', (res) => {
      let data = ''; res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data).map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function calcSMA(d, p) { return d.map((_, i) => { if (i < p - 1) return null; let s = 0; for (let j = i - p + 1; j <= i; j++) s += d[j].c; return s / p; }); }
function calcRSI(d, p = 14) { if (d.length < p + 1) return 50; let gA = 0, lA = 0; for (let i = 1; i <= p; i++) { const ch = d[i].c - d[i - 1].c; if (ch > 0) gA += ch; else lA -= ch; } gA /= p; lA /= p; for (let i = p + 1; i < d.length; i++) { const ch = d[i].c - d[i - 1].c; if (ch > 0) { gA = (gA * (p - 1) + ch) / p; lA = lA * (p - 1) / p; } else { gA = gA * (p - 1) / p; lA = (lA * (p - 1) - ch) / p; } } return lA === 0 ? 100 : Math.round(100 - 100 / (1 + gA / lA)); }
function calcEMA(d, p) { const k = 2 / (p + 1); let v = d[0].c; return d.map((x, i) => { if (i === 0) return v; v = x.c * k + v * (1 - k); return v; }); }
function calcMACD(d) { const e12 = calcEMA(d, 12), e26 = calcEMA(d, 26); const line = e12.map((v, i) => v - e26[i]); const k = 2 / 10; let sv = line[0]; const sig = line.map((v, i) => { if (i === 0) return sv; sv = v * k + sv * (1 - k); return sv; }); return { hist: line.map((v, i) => v - sig[i]) }; }
function calcStoch(d, p = 14) { if (d.length < p) return 50; const sl = d.slice(-p); let h = -Infinity, l = Infinity; sl.forEach(x => { if (x.h > h) h = x.h; if (x.l < l) l = x.l; }); return h === l ? 50 : Math.round((d[d.length - 1].c - l) / (h - l) * 100); }
function detectBOS(c) { if (c.length < 20) return []; const s = [], hi = [], lo = []; for (let i = 2; i < c.length - 1; i++) { if (c[i].h > c[i-1].h && c[i].h > c[i+1].h) hi.push({ val: c[i].h }); if (c[i].l < c[i-1].l && c[i].l < c[i+1].l) lo.push({ val: c[i].l }); } for (let j = 1; j < hi.length; j++) if (hi[j].val > hi[j-1].val) s.push({ dir: 'BULLISH' }); for (let k = 1; k < lo.length; k++) if (lo[k].val < lo[k-1].val) s.push({ dir: 'BEARISH' }); return s.slice(-3); }
function detectFVG(c) { if (c.length < 5) return []; const g = []; for (let i = 2; i < c.length; i++) { if (c[i].l > c[i-2].h) g.push({ dir: 'BULLISH' }); if (c[i].h < c[i-2].l) g.push({ dir: 'BEARISH' }); } return g.slice(-3); }
function detectSR(c) { if (c.length < 20) return { support: null, resistance: null }; const r = c.slice(-20); return { resistance: Math.max(...r.map(x => x.h)), support: Math.min(...r.map(x => x.l)) }; }
function getNewsFilter() { const h = new Date().getUTCHours(), m = new Date().getUTCMinutes(); const hi = [{ h: 12, m: 30 }, { h: 13, m: 0 }, { h: 14, m: 0 }, { h: 14, m: 30 }, { h: 8, m: 30 }, { h: 10, m: 0 }]; for (const ev of hi) { const diff = (ev.h - h) * 60 + (ev.m - m); if (diff >= -5 && diff <= 15) return { safe: false, reason: 'High impact news' }; } return { safe: true, reason: 'Safe' }; }

function fullAnalysis(candles, dec) {
  if (candles.length < 26) return null;
  const rsi = calcRSI(candles), macd = calcMACD(candles), stoch = calcStoch(candles);
  const last = candles.length - 1, price = candles[last].c;
  const bos = detectBOS(candles), fvg = detectFVG(candles), sr = detectSR(candles), nf = getNewsFilter();
  const inds = [];

  if (rsi < 30) inds.push({ n: 'RSI', d: 'BUY', s: 90 }); else if (rsi < 40) inds.push({ n: 'RSI', d: 'BUY', s: 65 }); else if (rsi > 70) inds.push({ n: 'RSI', d: 'SELL', s: 90 }); else if (rsi > 60) inds.push({ n: 'RSI', d: 'SELL', s: 60 }); else inds.push({ n: 'RSI', d: 'HOLD', s: 50 });
  const mH = macd.hist[last], mHp = macd.hist[last - 1];
  if (mH > 0 && mHp <= 0) inds.push({ n: 'MACD', d: 'BUY', s: 85 }); else if (mH < 0 && mHp >= 0) inds.push({ n: 'MACD', d: 'SELL', s: 85 }); else if (mH > 0) inds.push({ n: 'MACD', d: 'BUY', s: 60 }); else inds.push({ n: 'MACD', d: 'SELL', s: 60 });
  if (stoch < 20) inds.push({ n: 'STCH', d: 'BUY', s: 80 }); else if (stoch > 80) inds.push({ n: 'STCH', d: 'SELL', s: 80 }); else inds.push({ n: 'STCH', d: 'HOLD', s: 45 });
  const lb = bos.length > 0 ? bos[bos.length - 1] : null;
  if (lb) inds.push({ n: 'BOS', d: lb.dir === 'BULLISH' ? 'BUY' : 'SELL', s: 80 }); else inds.push({ n: 'BOS', d: 'HOLD', s: 40 });
  const lf = fvg.length > 0 ? fvg[fvg.length - 1] : null;
  if (lf) { if (lf.dir === 'BULLISH') inds.push({ n: 'FVG', d: 'BUY', s: 75 }); else inds.push({ n: 'FVG', d: 'SELL', s: 75 }); } else inds.push({ n: 'FVG', d: 'HOLD', s: 40 });
  if (sr.support && sr.resistance) { const dS = (price - sr.support) / price * 100; if (dS < 0.3) inds.push({ n: 'S/R', d: 'BUY', s: 70 }); else if ((sr.resistance - price) / price * 100 < 0.3) inds.push({ n: 'S/R', d: 'SELL', s: 70 }); else inds.push({ n: 'S/R', d: 'HOLD', s: 45 }); } else inds.push({ n: 'S/R', d: 'HOLD', s: 40 });
  if (candles.length > 10) { const r10 = candles.slice(-10); if (r10[r10.length-1].c > r10[0].c * 1.001) inds.push({ n: 'MOM', d: 'BUY', s: 65 }); else if (r10[r10.length-1].c < r10[0].c * 0.999) inds.push({ n: 'MOM', d: 'SELL', s: 65 }); else inds.push({ n: 'MOM', d: 'HOLD', s: 45 }); }

  const buys = inds.filter(i => i.d === 'BUY'), sells = inds.filter(i => i.d === 'SELL');
  let dir = 'HOLD', conf = 50, agree = 0;
  if (buys.length > sells.length) { dir = 'BUY'; agree = buys.length; conf = Math.round(buys.reduce((a, i) => a + i.s, 0) / buys.length); }
  else if (sells.length > buys.length) { dir = 'SELL'; agree = sells.length; conf = Math.round(sells.reduce((a, i) => a + i.s, 0) / sells.length); }

  let recSec = 0;
  if (dir !== 'HOLD') { if (conf >= 90) recSec = 30; else if (conf >= 85) recSec = 60; else if (conf >= 80) recSec = 120; else if (conf >= 75) recSec = 180; else if (conf >= 70) recSec = 300; else if (conf >= 65) recSec = 600; else if (conf >= 60) recSec = 900; else recSec = 1800; }

  let action = dir === 'HOLD' ? 'Wait' : !nf.safe ? 'NEWS WARNING' : lb && lf && lb.dir === (dir === 'BUY' ? 'BULLISH' : 'BEARISH') ? 'ENTRY! BOS + FVG aligned' : 'Wait for confirmation';
  return { dir, conf, agree, total: inds.length, recSec, price, newsFilter: nf, action, rsi, stoch };
}

function formatDur(sec) { const mm = Math.floor(sec / 60), ss = sec % 60; return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); }

async function checkAllPairs() {
  serverStats.checks++;
  serverStats.lastCheck = new Date().toISOString();
  const now = Date.now();
  for (const pair of PAIRS) {
    try {
      const candles = await fetchCandles(pair.sym, TIMEFRAME);
      const sig = fullAnalysis(candles, pair.dec);
      if (!sig || sig.dir === 'HOLD') continue;
      const key = pair.sym + '_' + sig.dir;
      const lastSig = lastSignals[key] || 0;
      if (sig.conf >= MIN_CONFIDENCE && sig.agree >= MIN_AGREE && sig.newsFilter.safe && (now - lastNotifTime > COOLDOWN) && (now - lastSig > 300000)) {
        const emoji = sig.dir === 'BUY' ? '📈' : '📉';
        const title = emoji + ' ' + sig.dir + ' ' + pair.label + ' - ' + sig.conf + '%';
        const body = sig.action + '\nDuration: ' + formatDur(sig.recSec) + ' | ' + sig.agree + '/' + sig.total + ' indicators\nPrice: ' + sig.price.toFixed(pair.dec) + ' | RSI: ' + sig.rsi;
        await sendPush(title, body);
        lastNotifTime = now;
        lastSignals[key] = now;
        serverStats.lastSignal = { pair: pair.label, dir: sig.dir, conf: sig.conf, time: new Date().toISOString() };
        console.log('[SIGNAL] ' + sig.dir + ' ' + pair.label + ' | ' + sig.conf + '% | ' + sig.action);
      }
    } catch (err) { console.error('[ERROR] ' + pair.label + ':', err.message); }
  }
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'running', uptime: Math.round(process.uptime()) + 's', stats: serverStats }, null, 2));
}).listen(PORT, () => {
  console.log('=== SIGNAL SERVER STARTED ===');
  console.log('Port: ' + PORT);
  console.log('Token: ' + PUSH_TOKEN.substring(0, 30) + '...');
  console.log('Checking every ' + CHECK_INTERVAL / 1000 + 's');
  console.log('============================');
  checkAllPairs();
  setInterval(checkAllPairs, CHECK_INTERVAL);
});
