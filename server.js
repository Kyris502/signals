var http = require(“http”);
var https = require(“https”);

var PUSH_TOKEN = “ExponentPushToken[2_TkioJHlKTlrewxCpA9jR]”;
var CHECK_INTERVAL = 20000;
var MIN_CONFIDENCE = 60;
var MIN_AGREE = 3;
var COOLDOWN = 120000;
var PAIRS = [
{ sym: “BTCUSDT”, label: “BTC/USDT”, dec: 2 },
{ sym: “ETHUSDT”, label: “ETH/USDT”, dec: 2 },
{ sym: “SOLUSDT”, label: “SOL/USDT”, dec: 3 },
{ sym: “BNBUSDT”, label: “BNB/USDT”, dec: 2 },
{ sym: “XRPUSDT”, label: “XRP/USDT”, dec: 4 },
{ sym: “DOGEUSDT”, label: “DOGE/USDT”, dec: 5 }
];
var TIMEFRAME = “5m”;
var lastNotifTime = 0;
var lastSignals = {};
var stats = { checks: 0, notifs: 0, errors: 0 };

function sendPush(title, body) {
return new Promise(function(resolve, reject) {
var data = JSON.stringify({ to: PUSH_TOKEN, sound: “default”, title: title, body: body, priority: “high” });
var opts = { hostname: “exp.host”, path: “/–/api/v2/push/send”, method: “POST”, headers: { “Content-Type”: “application/json”, “Content-Length”: Buffer.byteLength(data) } };
var req = https.request(opts, function(res) { var b = “”; res.on(“data”, function(c) { b += c; }); res.on(“end”, function() { console.log(”[PUSH] “ + title); stats.notifs++; resolve(b); }); });
req.on(“error”, function(e) { reject(e); });
req.write(data);
req.end();
});
}

function fetchCandles(symbol) {
return new Promise(function(resolve, reject) {
var url = “https://data-api.binance.vision/api/v3/klines?symbol=” + symbol + “&interval=” + TIMEFRAME + “&limit=80”;
https.get(url, function(res) {
var data = “”;
res.on(“data”, function(c) { data += c; });
res.on(“end”, function() {
try {
var parsed = JSON.parse(data);
if (!Array.isArray(parsed)) { reject(new Error(“bad”)); return; }
var candles = [];
for (var i = 0; i < parsed.length; i++) {
var k = parsed[i];
candles.push({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) });
}
resolve(candles);
} catch (e) { reject(e); }
});
}).on(“error”, function(e) { reject(e); });
});
}

function calcRSI(d, p) {
p = p || 14;
if (d.length < p + 1) return 50;
var gA = 0, lA = 0;
for (var i = 1; i <= p; i++) { var ch = d[i].c - d[i - 1].c; if (ch > 0) gA += ch; else lA -= ch; }
gA /= p; lA /= p;
for (var i2 = p + 1; i2 < d.length; i2++) { var ch2 = d[i2].c - d[i2 - 1].c; if (ch2 > 0) { gA = (gA * (p - 1) + ch2) / p; lA = lA * (p - 1) / p; } else { gA = gA * (p - 1) / p; lA = (lA * (p - 1) - ch2) / p; } }
return lA === 0 ? 100 : Math.round(100 - 100 / (1 + gA / lA));
}

function calcEMA(d, p) {
var k = 2 / (p + 1), v = d[0].c;
var r = [];
for (var i = 0; i < d.length; i++) { if (i === 0) r.push(v); else { v = d[i].c * k + v * (1 - k); r.push(v); } }
return r;
}

function calcMACD(d) {
var e12 = calcEMA(d, 12), e26 = calcEMA(d, 26);
var line = [], hist = [];
for (var i = 0; i < e12.length; i++) line.push(e12[i] - e26[i]);
var k = 2 / 10, sv = line[0], sig = [];
for (var j = 0; j < line.length; j++) { if (j === 0) sig.push(sv); else { sv = line[j] * k + sv * (1 - k); sig.push(sv); } }
for (var m = 0; m < line.length; m++) hist.push(line[m] - sig[m]);
return { hist: hist };
}

function calcStoch(d, p) {
p = p || 14;
if (d.length < p) return 50;
var sl = d.slice(-p), h = -Infinity, l = Infinity;
for (var i = 0; i < sl.length; i++) { if (sl[i].h > h) h = sl[i].h; if (sl[i].l < l) l = sl[i].l; }
return h === l ? 50 : Math.round((d[d.length - 1].c - l) / (h - l) * 100);
}

function detectBOS(c) {
if (c.length < 20) return [];
var s = [], hi = [], lo = [];
for (var i = 2; i < c.length - 1; i++) { if (c[i].h > c[i-1].h && c[i].h > c[i+1].h) hi.push(c[i].h); if (c[i].l < c[i-1].l && c[i].l < c[i+1].l) lo.push(c[i].l); }
for (var j = 1; j < hi.length; j++) if (hi[j] > hi[j-1]) s.push(“BULLISH”);
for (var k2 = 1; k2 < lo.length; k2++) if (lo[k2] < lo[k2-1]) s.push(“BEARISH”);
return s.slice(-3);
}

function detectFVG(c) {
if (c.length < 5) return [];
var g = [];
for (var i = 2; i < c.length; i++) { if (c[i].l > c[i-2].h) g.push(“BULLISH”); if (c[i].h < c[i-2].l) g.push(“BEARISH”); }
return g.slice(-3);
}

function analyze(candles) {
if (candles.length < 26) return null;
var rsi = calcRSI(candles);
var macd = calcMACD(candles);
var stoch = calcStoch(candles);
var last = candles.length - 1;
var price = candles[last].c;
var bos = detectBOS(candles);
var fvg = detectFVG(candles);
var nf = true;
var h = new Date().getUTCHours(), m = new Date().getUTCMinutes();
var hi = [{ h: 12, m: 30 }, { h: 13, m: 0 }, { h: 14, m: 0 }, { h: 14, m: 30 }, { h: 8, m: 30 }, { h: 10, m: 0 }];
for (var n = 0; n < hi.length; n++) { var diff = (hi[n].h - h) * 60 + (hi[n].m - m); if (diff >= -5 && diff <= 15) nf = false; }

var inds = [];
if (rsi < 30) inds.push({ d: “BUY”, s: 90 }); else if (rsi < 40) inds.push({ d: “BUY”, s: 65 }); else if (rsi > 70) inds.push({ d: “SELL”, s: 90 }); else if (rsi > 60) inds.push({ d: “SELL”, s: 60 }); else inds.push({ d: “HOLD”, s: 50 });

var mH = macd.hist[last], mHp = macd.hist[last - 1];
if (mH > 0 && mHp <= 0) inds.push({ d: “BUY”, s: 85 }); else if (mH < 0 && mHp >= 0) inds.push({ d: “SELL”, s: 85 }); else if (mH > 0) inds.push({ d: “BUY”, s: 60 }); else inds.push({ d: “SELL”, s: 60 });

if (stoch < 20) inds.push({ d: “BUY”, s: 80 }); else if (stoch > 80) inds.push({ d: “SELL”, s: 80 }); else inds.push({ d: “HOLD”, s: 45 });

var lb = bos.length > 0 ? bos[bos.length - 1] : null;
if (lb) inds.push({ d: lb === “BULLISH” ? “BUY” : “SELL”, s: 80 }); else inds.push({ d: “HOLD”, s: 40 });

var lf = fvg.length > 0 ? fvg[fvg.length - 1] : null;
if (lf) inds.push({ d: lf === “BULLISH” ? “BUY” : “SELL”, s: 75 }); else inds.push({ d: “HOLD”, s: 40 });

if (candles.length > 10) { var r10 = candles.slice(-10); if (r10[r10.length-1].c > r10[0].c * 1.001) inds.push({ d: “BUY”, s: 65 }); else if (r10[r10.length-1].c < r10[0].c * 0.999) inds.push({ d: “SELL”, s: 65 }); else inds.push({ d: “HOLD”, s: 45 }); }

var buys = [], sells = [];
for (var i = 0; i < inds.length; i++) { if (inds[i].d === “BUY”) buys.push(inds[i]); if (inds[i].d === “SELL”) sells.push(inds[i]); }

var dir = “HOLD”, conf = 50, agree = 0;
if (buys.length > sells.length) { dir = “BUY”; agree = buys.length; var sum = 0; for (var b = 0; b < buys.length; b++) sum += buys[b].s; conf = Math.round(sum / buys.length); }
else if (sells.length > buys.length) { dir = “SELL”; agree = sells.length; var sum2 = 0; for (var s2 = 0; s2 < sells.length; s2++) sum2 += sells[s2].s; conf = Math.round(sum2 / sells.length); }

var recSec = 0;
if (dir !== “HOLD”) { if (conf >= 90) recSec = 30; else if (conf >= 85) recSec = 60; else if (conf >= 80) recSec = 120; else if (conf >= 75) recSec = 180; else if (conf >= 70) recSec = 300; else if (conf >= 65) recSec = 600; else if (conf >= 60) recSec = 900; else recSec = 1800; }

var action = “Wait”;
if (dir !== “HOLD”) { if (!nf) action = “NEWS”; else if (lb && lf) action = “ENTRY BOS+FVG”; else action = “Confirm”; }

return { dir: dir, conf: conf, agree: agree, total: inds.length, recSec: recSec, price: price, safe: nf, action: action, rsi: rsi };
}

function formatDur(sec) { var mm = Math.floor(sec / 60); var ss = sec % 60; return (mm < 10 ? “0” : “”) + mm + “:” + (ss < 10 ? “0” : “”) + ss; }

var idx = 0;
function checkNext() {
var pair = PAIRS[idx];
var now = Date.now();
fetchCandles(pair.sym).then(function(candles) {
var sig = analyze(candles);
if (sig && sig.dir !== “HOLD”) {
var key = pair.sym + sig.dir;
var ls = lastSignals[key] || 0;
if (sig.conf >= MIN_CONFIDENCE && sig.agree >= MIN_AGREE && sig.safe && (now - lastNotifTime > COOLDOWN) && (now - ls > 300000)) {
var title = sig.dir + “ “ + pair.label + “ “ + sig.conf + “%”;
var body = sig.action + “ | “ + formatDur(sig.recSec) + “ | “ + sig.agree + “/” + sig.total + “ | “ + sig.price.toFixed(pair.dec);
sendPush(title, body);
lastNotifTime = now;
lastSignals[key] = now;
}
}
}).catch(function(err) { stats.errors++; });
idx = (idx + 1) % PAIRS.length;
if (idx === 0) stats.checks++;
}

var PORT = process.env.PORT || 3000;
http.createServer(function(req, res) {
res.writeHead(200);
res.end(“ok”);
}).listen(PORT, function() {
console.log(“SERVER OK “ + PORT);
sendPush(“Server Started”, “Running 24/7”).catch(function() {});
setInterval(checkNext, 3000);
});
