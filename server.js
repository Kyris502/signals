const http = require(‘http’);
const https = require(‘https’);

const PUSH_TOKEN = ‘ExponentPushToken[2_TkioJHlKTlrewxCpA9jR]’;
const CHECK_INTERVAL = 20000;
const MIN_CONFIDENCE = 60;
const MIN_AGREE = 3;
const COOLDOWN = 120000;
const PAIRS = [
{ sym: ‘BTCUSDT’, label: ‘BTC/USDT’, dec: 2 },
{ sym: ‘ETHUSDT’, label: ‘ETH/USDT’, dec: 2 },
{ sym: ‘SOLUSDT’, label: ‘SOL/USDT’, dec: 3 },
{ sym: ‘BNBUSDT’, label: ‘BNB/USDT’, dec: 2 },
{ sym: ‘XRPUSDT’, label: ‘XRP/USDT’, dec: 4 },
{ sym: ‘DOGEUSDT’, label: ‘DOGE/USDT’, dec: 5 },
];
const TIMEFRAME = ‘5m’;
let lastNotifTime = 0;
let lastSignals = {};
let stats = { started: new Date().toISOString(), checks: 0, notifs: 0, errors: 0, lastCheck: null, lastSignal: null };

function sendPush(title, body) {
return new Promise(function(resolve, reject) {
var data = JSON.stringify({ to: PUSH_TOKEN, sound: ‘default’, title: title, body: body, priority: ‘high’ });
var opts = { hostname: ‘exp.host’, path: ‘/–/api/v2/push/send’, method: ‘POST’, headers: { ‘Content-Type’: ‘application/json’, ‘Content-Length’: Buffer.byteLength(data) } };
var req = https.request(opts, function(res) { var b = ‘’; res.on(‘data’, function(c) { b += c; }); res.on(‘end’, function() { console.log(’[PUSH] Sent: ’ + title); stats.notifs++; resolve(b); }); });
req.on(‘error’, function(e) { console.error(’[PUSH ERROR] ’ + e.message); reject(e); });
req.write(data); req.end();
});
}

function fetchCandles(symbol) {
return new Promise(function(resolve, reject) {
var url = ‘https://api.binance.com/api/v3/klines?symbol=’ + symbol + ‘&interval=’ + TIMEFRAME + ‘&limit=80’;
https.get(url, function(res) {
var data = ‘’;
res.on(‘data’, function(c) { data += c; });
res.on(‘end’, function() {
try {
var parsed = JSON.parse(data);
// Check if response is actually an array
if (!Array.isArray(parsed)) {
console.log(’[API] ’ + symbol + ’ returned: ’ + JSON.stringify(parsed).substring(0, 100));
reject(new Error(’Not an array: ’ + (parsed.msg || ‘unknown’)));
return;
}
var candles = parsed.map(function(k) {
return { t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) };
});
resolve(candles);
} catch (e) {
reject(new Error(’Parse error: ’ + e.message));
}
});
}).on(‘error’, function(e) { reject(e); });
});
}

function calcSMA(d, p) { return d.map(function(_, i) { if (i < p - 1) return null; var s = 0; for (var j = i - p + 1; j <= i; j++) s += d[j].c; return s / p; }); }
function calcRSI(d, p) { p = p || 14; if (d.length < p + 1) return 50; var gA = 0, lA = 0; for (var i = 1; i <= p; i++) { var ch = d[i].c - d[i - 1].c; if (ch > 0) gA += ch; else lA -= ch; } gA /= p; lA /= p; for (var i2 = p + 1; i2 < d.length; i2++) { var ch2 = d[i2].c - d[i2 - 1].c; if (ch2 > 0) { gA = (gA * (p - 1) + ch2) / p; lA = lA * (p - 1) / p; } else { gA = gA * (p - 1) / p; lA = (lA * (p - 1) - ch2) / p; } } return lA === 0 ? 100 : Math.round(100 - 100 / (1 + gA / lA)); }
function calcEMA(d, p) { var k = 2 / (p + 1), v = d[0].c; return d.map(function(x, i) { if (i === 0) return v; v = x.c * k + v * (1 - k); return v; }); }
function calcMACD(d) { var e12 = calcEMA(d, 12), e26 = calcEMA(d, 26); var line = e12.map(function(v, i) { return v - e26[i]; }); var k = 2 / 10, sv = line[0]; var sig = line.map(function(v, i) { if (i === 0) return sv; sv = v * k + sv * (1 - k); return sv; }); return { hist: line.map(function(v, i) { return v - sig[i]; }) }; }
function calcStoch(d, p) { p = p || 14; if (d.length < p) return 50; var sl = d.slice(-p); var h = -Infinity, l = Infinity; sl.forEach(function(x) { if (x.h > h) h = x.h; if (x.l < l) l = x.l; }); return h === l ? 50 : Math.round((d[d.length - 1].c - l) / (h - l) * 100); }
function detectBOS(c) { if (c.length < 20) return []; var s = [], hi = [], lo = []; for (var i = 2; i < c.length - 1; i++) { if (c[i].h > c[i-1].h && c[i].h > c[i+1].h) hi.push({ val: c[i].h }); if (c[i].l < c[i-1].l && c[i].l < c[i+1].l) lo.push({ val: c[i].l }); } for (var j = 1; j < hi.length; j++) if (hi[j].val > hi[j-1].val) s.push({ dir: ‘BULLISH’ }); for (var k2 = 1; k2 < lo.length; k2++) if (lo[k2].val < lo[k2-1].val) s.push({ dir: ‘BEARISH’ }); return s.slice(-3); }
function detectFVG(c) { if (c.length < 5) return []; var g = []; for (var i = 2; i < c.length; i++) { if (c[i].l > c[i-2].h) g.push({ dir: ‘BULLISH’ }); if (c[i].h < c[i-2].l) g.push({ dir: ‘BEARISH’ }); } return g.slice(-3); }
function detectSR(c) { if (c.length < 20) return { support: null, resistance: null }; var r = c.slice(-20); var hh = -Infinity, ll = Infinity; r.forEach(function(x) { if (x.h > hh) hh = x.h; if (x.l < ll) ll = x.l; }); return { resistance: hh, support: ll }; }
function getNewsFilter() { var h = new Date().getUTCHours(), m = new Date().getUTCMinutes(); var hi = [{ h: 12, m: 30 }, { h: 13, m: 0 }, { h: 14, m: 0 }, { h: 14, m: 30 }, { h: 8, m: 30 }, { h: 10, m: 0 }]; for (var i = 0; i < hi.length; i++) { var diff = (hi[i].h - h) * 60 + (hi[i].m - m); if (diff >= -5 && diff <= 15) return { safe: false }; } return { safe: true }; }

function analyze(candles, dec) {
if (candles.length < 26) return null;
var rsi = calcRSI(candles), macd = calcMACD(candles), stoch = calcStoch(candles);
var last = candles.length - 1, price = candles[last].c;
var bos = detectBOS(candles), fvg = detectFVG(candles), sr = detectSR(candles), nf = getNewsFilter();
var inds = [];

if (rsi < 30) inds.push({ d: ‘BUY’, s: 90 }); else if (rsi < 40) inds.push({ d: ‘BUY’, s: 65 }); else if (rsi > 70) inds.push({ d: ‘SELL’, s: 90 }); else if (rsi > 60) inds.push({ d: ‘SELL’, s: 60 }); else inds.push({ d: ‘HOLD’, s: 50 });
var mH = macd.hist[last], mHp = macd.hist[last - 1];
if (mH > 0 && mHp <= 0) inds.push({ d: ‘BUY’, s: 85 }); else if (mH < 0 && mHp >= 0) inds.push({ d: ‘SELL’, s: 85 }); else if (mH > 0) inds.push({ d: ‘BUY’, s: 60 }); else inds.push({ d: ‘SELL’, s: 60 });
if (stoch < 20) inds.push({ d: ‘BUY’, s: 80 }); else if (stoch > 80) inds.push({ d: ‘SELL’, s: 80 }); else inds.push({ d: ‘HOLD’, s: 45 });
var lb = bos.length > 0 ? bos[bos.length - 1] : null;
if (lb) inds.push({ d: lb.dir === ‘BULLISH’ ? ‘BUY’ : ‘SELL’, s: 80 }); else inds.push({ d: ‘HOLD’, s: 40 });
var lf = fvg.length > 0 ? fvg[fvg.length - 1] : null;
if (lf) inds.push({ d: lf.dir === ‘BULLISH’ ? ‘BUY’ : ‘SELL’, s: 75 }); else inds.push({ d: ‘HOLD’, s: 40 });
if (sr.support && sr.resistance) { var dS = (price - sr.support) / price * 100; if (dS < 0.3) inds.push({ d: ‘BUY’, s: 70 }); else if ((sr.resistance - price) / price * 100 < 0.3) inds.push({ d: ‘SELL’, s: 70 }); else inds.push({ d: ‘HOLD’, s: 45 }); } else inds.push({ d: ‘HOLD’, s: 40 });
if (candles.length > 10) { var r10 = candles.slice(-10); if (r10[r10.length-1].c > r10[0].c * 1.001) inds.push({ d: ‘BUY’, s: 65 }); else if (r10[r10.length-1].c < r10[0].c * 0.999) inds.push({ d: ‘SELL’, s: 65 }); else inds.push({ d: ‘HOLD’, s: 45 }); }

var buys = inds.filter(function(i) { return i.d === ‘BUY’; });
var sells = inds.filter(function(i) { return i.d === ‘SELL’; });
var dir = ‘HOLD’, conf = 50, agree = 0;
if (buys.length > sells.length) { dir = ‘BUY’; agree = buys.length; conf = Math.round(buys.reduce(function(a, i) { return a + i.s; }, 0) / buys.length); }
else if (sells.length > buys.length) { dir = ‘SELL’; agree = sells.length; conf = Math.round(sells.reduce(function(a, i) { return a + i.s; }, 0) / sells.length); }

var recSec = 0;
if (dir !== ‘HOLD’) { if (conf >= 90) recSec = 30; else if (conf >= 85) recSec = 60; else if (conf >= 80) recSec = 120; else if (conf >= 75) recSec = 180; else if (conf >= 70) recSec = 300; else if (conf >= 65) recSec = 600; else if (conf >= 60) recSec = 900; else recSec = 1800; }

var action = dir === ‘HOLD’ ? ‘Wait’ : !nf.safe ? ‘NEWS WARNING’ : lb && lf && lb.dir === (dir === ‘BUY’ ? ‘BULLISH’ : ‘BEARISH’) ? ‘ENTRY! BOS+FVG’ : ‘Wait confirm’;
return { dir: dir, conf: conf, agree: agree, total: inds.length, recSec: recSec, price: price, safe: nf.safe, action: action, rsi: rsi };
}

function formatDur(sec) { var mm = Math.floor(sec / 60), ss = sec % 60; return String(mm).padStart(2, ‘0’) + ‘:’ + String(ss).padStart(2, ‘0’); }

// Check one pair at a time with delay to avoid rate limits
var currentPairIndex = 0;

function checkNextPair() {
var pair = PAIRS[currentPairIndex];
var now = Date.now();

fetchCandles(pair.sym).then(function(candles) {
var sig = analyze(candles, pair.dec);
if (sig && sig.dir !== ‘HOLD’) {
var key = pair.sym + ‘_’ + sig.dir;
var lastSig = lastSignals[key] || 0;
if (sig.conf >= MIN_CONFIDENCE && sig.agree >= MIN_AGREE && sig.safe && (now - lastNotifTime > COOLDOWN) && (now - lastSig > 300000)) {
var emoji = sig.dir === ‘BUY’ ? ‘📈’ : ‘📉’;
var title = emoji + ’ ’ + sig.dir + ’ ’ + pair.label + ’ - ’ + sig.conf + ‘%’;
var body = sig.action + ‘\nDuration: ’ + formatDur(sig.recSec) + ’ | ’ + sig.agree + ‘/’ + sig.total + ‘\nPrice: ’ + sig.price.toFixed(pair.dec) + ’ | RSI: ’ + sig.rsi;
sendPush(title, body);
lastNotifTime = now;
lastSignals[key] = now;
stats.lastSignal = { pair: pair.label, dir: sig.dir, conf: sig.conf, time: new Date().toISOString() };
console.log(’[SIGNAL] ’ + sig.dir + ’ ’ + pair.label + ’ ’ + sig.conf + ‘% ’ + sig.action);
} else {
console.log(’[SKIP] ’ + pair.label + ’ ’ + sig.dir + ’ ’ + sig.conf + ‘% (cooldown or low conf)’);
}
} else {
console.log(’[CHECK] ’ + pair.label + ‘: ’ + (sig ? sig.dir : ‘no data’));
}
}).catch(function(err) {
stats.errors++;
console.log(’[ERROR] ’ + pair.label + ’: ’ + err.message);
});

// Move to next pair
currentPairIndex = (currentPairIndex + 1) % PAIRS.length;

// If we completed a full cycle, update stats
if (currentPairIndex === 0) {
stats.checks++;
stats.lastCheck = new Date().toISOString();
}
}

// Health check server
var PORT = process.env.PORT || 3000;
http.createServer(function(req, res) {
res.writeHead(200, { ‘Content-Type’: ‘application/json’ });
res.end(JSON.stringify({ status: ‘running’, uptime: Math.round(process.uptime()) + ‘s’, stats: stats }, null, 2));
}).listen(PORT, function() {
console.log(’=== SIGNAL SERVER v2 ===’);
console.log(’Port: ’ + PORT);
console.log(‘Token: ’ + PUSH_TOKEN.substring(0, 30) + ‘…’);
console.log(‘Pairs: ’ + PAIRS.map(function(p) { return p.label; }).join(’, ‘));
console.log(’========================’);

// Test push notification on startup
sendPush(‘🟢 Signal Server Started’, ’Monitoring ’ + PAIRS.length + ’ pairs every ’ + (CHECK_INTERVAL / 1000) + ‘s’).catch(function() {});

// Check one pair every 3 seconds (avoids rate limits)
setInterval(checkNextPair, 3000);
});
