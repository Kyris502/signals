import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions, StatusBar, SafeAreaView, Animated, Switch, Vibration, Platform, Clipboard, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

Notifications.setNotificationHandler({ handleNotification: function() { return Promise.resolve({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }); } });

var PAIRS = [
  { sym: 'btcusdt', label: 'BTC/USDT', dec: 2, whaleUSD: 50000 },
  { sym: 'ethusdt', label: 'ETH/USDT', dec: 2, whaleUSD: 25000 },
  { sym: 'solusdt', label: 'SOL/USDT', dec: 3, whaleUSD: 15000 },
  { sym: 'bnbusdt', label: 'BNB/USDT', dec: 2, whaleUSD: 15000 },
  { sym: 'xrpusdt', label: 'XRP/USDT', dec: 4, whaleUSD: 15000 },
  { sym: 'dogeusdt', label: 'DOGE/USDT', dec: 5, whaleUSD: 10000 },
];
var TFS = [{ key: '1m', label: '1m' }, { key: '5m', label: '5m' }, { key: '15m', label: '15m' }, { key: '1h', label: '1h' }];
var C = {
  bg: '#0a0e17', bg2: '#111827', bg3: '#1a2236', border: '#1e2a3f',
  green: '#00c853', greenbg: 'rgba(0,200,83,0.12)', red: '#ff1744',
  redbg: 'rgba(255,23,68,0.12)', blue: '#3b82f6', amber: '#f59e0b',
  amberbg: 'rgba(245,158,11,0.15)', txt: '#e2e8f0', txt2: '#8899aa', txt3: '#556677',
  purple: '#a855f7', purplebg: 'rgba(168,85,247,0.15)', purpleborder: 'rgba(168,85,247,0.4)',
  orange: '#f97316', orangebg: 'rgba(249,115,22,0.15)', orangeborder: 'rgba(249,115,22,0.4)',
  white: '#e2e8f0', whitebg: 'rgba(226,232,240,0.1)', whiteborder: 'rgba(226,232,240,0.25)',
  cyan: '#22d3ee', gold: '#fbbf24',
};

async function registerPush() {
  if (!Device.isDevice) return { ready: false, token: null };
  var e = await Notifications.getPermissionsAsync();
  if (e.status !== 'granted') { var a = await Notifications.requestPermissionsAsync(); if (a.status !== 'granted') return { ready: false, token: null }; }
  if (Platform.OS === 'android') { await Notifications.setNotificationChannelAsync('signals', { name: 'Signals', importance: Notifications.AndroidImportance.MAX, sound: 'default' }); }
  try {
    var tokenData = await Notifications.getExpoPushTokenAsync({ projectId: undefined });
    return { ready: true, token: tokenData.data };
  } catch (err) {
    return { ready: true, token: 'Error: ' + err.message };
  }
}
async function sendNotif(title, body) { await Notifications.scheduleNotificationAsync({ content: { title: title, body: body, sound: 'default' }, trigger: null }); }

function calcSMA(d, p) { return d.map(function(_, i) { if (i < p - 1) return null; var s = 0; for (var j = i - p + 1; j <= i; j++) s += d[j].c; return s / p; }); }
function calcRSI(d, p) { p = p || 14; if (d.length < p + 1) return 50; var gA = 0, lA = 0; for (var i = 1; i <= p; i++) { var ch = d[i].c - d[i - 1].c; if (ch > 0) gA += ch; else lA -= ch; } gA /= p; lA /= p; for (var i2 = p + 1; i2 < d.length; i2++) { var ch2 = d[i2].c - d[i2 - 1].c; if (ch2 > 0) { gA = (gA * (p - 1) + ch2) / p; lA = lA * (p - 1) / p; } else { gA = gA * (p - 1) / p; lA = (lA * (p - 1) - ch2) / p; } } return lA === 0 ? 100 : Math.round(100 - 100 / (1 + gA / lA)); }
function calcEMA(d, p) { var k = 2 / (p + 1), v = d[0].c; return d.map(function(x, i) { if (i === 0) return v; v = x.c * k + v * (1 - k); return v; }); }
function calcMACD(d) { var e12 = calcEMA(d, 12), e26 = calcEMA(d, 26); var line = e12.map(function(v, i) { return v - e26[i]; }); var k = 2 / 10, sv = line[0]; var sig = line.map(function(v, i) { if (i === 0) return sv; sv = v * k + sv * (1 - k); return sv; }); return { hist: line.map(function(v, i) { return v - sig[i]; }) }; }
function calcStoch(d, p) { p = p || 14; if (d.length < p) return 50; var sl = d.slice(-p); var h = -Infinity, l = Infinity; sl.forEach(function(x) { if (x.h > h) h = x.h; if (x.l < l) l = x.l; }); return h === l ? 50 : Math.round((d[d.length - 1].c - l) / (h - l) * 100); }
function detectBOS(c) { if (c.length < 20) return []; var s = [], hi = [], lo = []; for (var i = 2; i < c.length - 1; i++) { if (c[i].h > c[i-1].h && c[i].h > c[i+1].h) hi.push({ val: c[i].h }); if (c[i].l < c[i-1].l && c[i].l < c[i+1].l) lo.push({ val: c[i].l }); } for (var j = 1; j < hi.length; j++) if (hi[j].val > hi[j-1].val) s.push({ dir: 'BULLISH', level: hi[j].val }); for (var k = 1; k < lo.length; k++) if (lo[k].val < lo[k-1].val) s.push({ dir: 'BEARISH', level: lo[k].val }); return s.slice(-3); }
function detectFVG(c) { if (c.length < 5) return []; var g = []; for (var i = 2; i < c.length; i++) { if (c[i].l > c[i-2].h) g.push({ dir: 'BULLISH', top: c[i].l, bot: c[i-2].h }); if (c[i].h < c[i-2].l) g.push({ dir: 'BEARISH', top: c[i-2].l, bot: c[i].h }); } return g.slice(-3); }
function detectSR(c) { if (c.length < 20) return { support: null, resistance: null }; var r = c.slice(-20); var hs = r.map(function(x) { return x.h; }).sort(function(a, b) { return b - a; }); var ls = r.map(function(x) { return x.l; }).sort(function(a, b) { return a - b; }); return { resistance: hs[0], support: ls[0] }; }
function getNewsFilter() { var h = new Date().getUTCHours(), m = new Date().getUTCMinutes(); var hi = [{ h: 12, m: 30 }, { h: 13, m: 0 }, { h: 14, m: 0 }, { h: 14, m: 30 }, { h: 8, m: 30 }, { h: 10, m: 0 }]; for (var i = 0; i < hi.length; i++) { var diff = (hi[i].h - h) * 60 + (hi[i].m - m); if (diff >= -5 && diff <= 15) return { safe: false, reason: 'High impact news', color: C.red }; } return { safe: true, reason: 'Safe to trade', color: C.green }; }
function getStrength(conf) { if (conf >= 75) return { level: 'STRONG', color: C.purple, bg: C.purplebg, border: C.purpleborder }; if (conf >= 60) return { level: 'MEDIUM', color: C.orange, bg: C.orangebg, border: C.orangeborder }; return { level: 'WEAK', color: C.white, bg: C.whitebg, border: C.whiteborder }; }
function formatDuration(sec) { var mm = Math.floor(sec / 60), ss = sec % 60; return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); }
function formatUSD(n) { if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M'; if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K'; return '$' + n.toFixed(0); }
function timeAgo(ts) { var s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return s + 's ago'; return Math.floor(s / 60) + 'm ago'; }

function fullAnalysis(candles, dec) {
  if (candles.length < 26) return null;
  var rsi = calcRSI(candles), macd = calcMACD(candles), stoch = calcStoch(candles);
  var sma20 = calcSMA(candles, 20); var last = candles.length - 1, price = candles[last].c;
  var bos = detectBOS(candles), fvg = detectFVG(candles), sr = detectSR(candles), nf = getNewsFilter();
  var inds = [];
  if (rsi < 30) inds.push({ n: 'RSI', d: 'BUY', s: 90, v: rsi }); else if (rsi < 40) inds.push({ n: 'RSI', d: 'BUY', s: 65, v: rsi }); else if (rsi > 70) inds.push({ n: 'RSI', d: 'SELL', s: 90, v: rsi }); else if (rsi > 60) inds.push({ n: 'RSI', d: 'SELL', s: 60, v: rsi }); else inds.push({ n: 'RSI', d: 'HOLD', s: 50, v: rsi });
  var mH = macd.hist[last], mHp = macd.hist[last - 1];
  if (mH > 0 && mHp <= 0) inds.push({ n: 'MACD', d: 'BUY', s: 85, v: 'X' }); else if (mH < 0 && mHp >= 0) inds.push({ n: 'MACD', d: 'SELL', s: 85, v: 'X' }); else if (mH > 0) inds.push({ n: 'MACD', d: 'BUY', s: 60, v: '+' }); else inds.push({ n: 'MACD', d: 'SELL', s: 60, v: '-' });
  if (stoch < 20) inds.push({ n: 'STCH', d: 'BUY', s: 80, v: stoch }); else if (stoch > 80) inds.push({ n: 'STCH', d: 'SELL', s: 80, v: stoch }); else inds.push({ n: 'STCH', d: 'HOLD', s: 45, v: stoch });
  var lb = bos.length > 0 ? bos[bos.length - 1] : null;
  if (lb) inds.push({ n: 'BOS', d: lb.dir === 'BULLISH' ? 'BUY' : 'SELL', s: 80, v: lb.dir === 'BULLISH' ? 'Bull' : 'Bear' }); else inds.push({ n: 'BOS', d: 'HOLD', s: 40, v: '--' });
  var lf = fvg.length > 0 ? fvg[fvg.length - 1] : null;
  if (lf) { if (lf.dir === 'BULLISH') inds.push({ n: 'FVG', d: 'BUY', s: 75, v: 'Gap' }); else inds.push({ n: 'FVG', d: 'SELL', s: 75, v: 'Gap' }); } else inds.push({ n: 'FVG', d: 'HOLD', s: 40, v: '--' });
  if (sr.support && sr.resistance) { var dS = (price - sr.support) / price * 100; if (dS < 0.3) inds.push({ n: 'S/R', d: 'BUY', s: 70, v: 'Sup' }); else if ((sr.resistance - price) / price * 100 < 0.3) inds.push({ n: 'S/R', d: 'SELL', s: 70, v: 'Res' }); else inds.push({ n: 'S/R', d: 'HOLD', s: 45, v: 'Mid' }); } else inds.push({ n: 'S/R', d: 'HOLD', s: 40, v: '--' });
  if (candles.length > 10) { var r10 = candles.slice(-10); if (r10[r10.length-1].c > r10[0].c * 1.001) inds.push({ n: 'MOM', d: 'BUY', s: 65, v: 'Up' }); else if (r10[r10.length-1].c < r10[0].c * 0.999) inds.push({ n: 'MOM', d: 'SELL', s: 65, v: 'Dn' }); else inds.push({ n: 'MOM', d: 'HOLD', s: 45, v: '--' }); }
  var buys = inds.filter(function(i) { return i.d === 'BUY'; }), sells = inds.filter(function(i) { return i.d === 'SELL'; });
  var dir = 'HOLD', conf = 50, agree = 0;
  if (buys.length > sells.length) { dir = 'BUY'; agree = buys.length; conf = Math.round(buys.reduce(function(a, i) { return a + i.s; }, 0) / buys.length); }
  else if (sells.length > buys.length) { dir = 'SELL'; agree = sells.length; conf = Math.round(sells.reduce(function(a, i) { return a + i.s; }, 0) / sells.length); }
  var recSec = 0;
  if (dir !== 'HOLD') { if (conf >= 90) recSec = 30; else if (conf >= 85) recSec = 60; else if (conf >= 80) recSec = 120; else if (conf >= 75) recSec = 180; else if (conf >= 70) recSec = 300; else if (conf >= 65) recSec = 600; else if (conf >= 60) recSec = 900; else recSec = 1800; }
  var action = dir === 'HOLD' ? 'Wait for setup' : !nf.safe ? 'NEWS WARNING' : lb && lf && lb.dir === (dir === 'BUY' ? 'BULLISH' : 'BEARISH') ? 'ENTRY! BOS + FVG aligned' : 'Wait for confirmation';
  var buyPct = inds.length > 0 ? Math.round(buys.length / inds.length * 100) : 50;
  return { dir: dir, conf: conf, agree: agree, total: inds.length, inds: inds, recSec: recSec, buyPct: buyPct, price: price, bos: bos, fvg: fvg, sr: sr, newsFilter: nf, action: action };
}

function PulsingDot(p) { var a = useRef(new Animated.Value(0.3)).current; useEffect(function() { var l = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(a, { toValue: 0.3, duration: 700, useNativeDriver: true })])); l.start(); return function() { l.stop(); }; }, []); return <Animated.View style={{ width: p.size, height: p.size, borderRadius: p.size / 2, backgroundColor: p.color, opacity: a }} />; }
function MiniChart(p) { if (p.candles.length < 5) return null; var W = Dimensions.get('window').width - 28, H = 140, d = p.candles.slice(-40); var mx = -Infinity, mn = Infinity; d.forEach(function(c) { if (c.h > mx) mx = c.h; if (c.l < mn) mn = c.l; }); var rng = mx - mn || 1, cw = Math.max(3, (W - 10) / d.length - 1); return (<View style={{ height: H, marginHorizontal: 14, marginVertical: 4 }}>{d.map(function(c, i) { var bull = c.c >= c.o, bT = (1 - (Math.max(c.o, c.c) - mn) / rng) * (H - 10) + 5, bB = (1 - (Math.min(c.o, c.c) - mn) / rng) * (H - 10) + 5, wT = (1 - (c.h - mn) / rng) * (H - 10) + 5, wB = (1 - (c.l - mn) / rng) * (H - 10) + 5, x = 5 + i * (cw + 1), col = bull ? C.green : C.red; return <View key={i} style={{ position: 'absolute', left: x }}><View style={{ position: 'absolute', left: cw/2-0.5, top: wT, width: 1, height: wB-wT, backgroundColor: col }} /><View style={{ position: 'absolute', left: 0, top: bT, width: cw, height: Math.max(1, bB-bT), backgroundColor: col, borderRadius: 1 }} /></View>; })}<Text style={{ position: 'absolute', right: 0, top: 0, fontSize: 8, color: C.txt3, fontFamily: 'monospace' }}>{mx.toFixed(p.pair.dec)}</Text><Text style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 8, color: C.txt3, fontFamily: 'monospace' }}>{mn.toFixed(p.pair.dec)}</Text></View>); }

export default function App() {
  var _ap = useState(0), activePair = _ap[0], setActivePair = _ap[1];
  var _at = useState(0), activeTF = _at[0], setActiveTF = _at[1];
  var _cd2 = useState([]), candles = _cd2[0], setCandles = _cd2[1];
  var _sg = useState(null), signal = _sg[0], setSignal = _sg[1];
  var _cn = useState(false), connected = _cn[0], setConnected = _cn[1];
  var _cg = useState(true), connecting = _cg[0], setConnecting = _cg[1];
  var _ct = useState(8), countdown = _ct[0], setCountdown = _ct[1];
  var _ck = useState('--:--:--'), clock = _ck[0], setClock = _ck[1];
  var _lp = useState(0), livePrice = _lp[0], setLivePrice = _lp[1];
  var _pu = useState(true), priceUp = _pu[0], setPriceUp = _pu[1];
  var _sl = useState([]), signalLog = _sl[0], setSignalLog = _sl[1];
  var _tb = useState(0), activeTab = _tb[0], setActiveTab = _tb[1];
  var _nf = useState(true), notifOn = _nf[0], setNotifOn = _nf[1];
  var _nr = useState(false), notifReady = _nr[0], setNotifReady = _nr[1];
  var _ln = useState(0), lastNotif = _ln[0], setLastNotif = _ln[1];
  var _pt = useState('Loading...'), pushToken = _pt[0], setPushToken = _pt[1];
  var _wt = useState([]), whaleTrades = _wt[0], setWhaleTrades = _wt[1];
  var _wb = useState(0), whaleBuyVol = _wb[0], setWhaleBuyVol = _wb[1];
  var _ws2 = useState(0), whaleSellVol = _ws2[0], setWhaleSellVol = _ws2[1];
  var _wc = useState(0), whaleCount = _wc[0], setWhaleCount = _wc[1];
  var wsRef = useRef(null), candlesRef = useRef([]), whaleWsRef = useRef(null);
  var whaleTradesRef = useRef([]), whaleBuyRef = useRef(0), whaleSellRef = useRef(0), whaleCountRef = useRef(0);

  useEffect(function() { registerPush().then(function(result) { setNotifReady(result.ready); if (result.token) setPushToken(result.token); else setPushToken('Not available (use real device)'); }); }, []);
  useEffect(function() { var t = setInterval(function() { setClock(new Date().toLocaleTimeString('en-GB')); }, 1000); return function() { clearInterval(t); }; }, []);
  useEffect(function() { var t = setInterval(function() { setCountdown(function(prev) { if (prev <= 1) { var sig = fullAnalysis(candlesRef.current, PAIRS[activePair].dec); if (sig) { setSignal(sig); if (sig.dir !== 'HOLD') { var now2 = new Date(); var ts = String(now2.getHours()).padStart(2, '0') + ':' + String(now2.getMinutes()).padStart(2, '0') + ':' + String(now2.getSeconds()).padStart(2, '0'); setSignalLog(function(p2) { return [{ time: ts, pair: PAIRS[activePair].label, dir: sig.dir, conf: sig.conf, dur: sig.recSec, action: sig.action }].concat(p2).slice(0, 15); }); var now3 = Date.now(); if (notifOn && notifReady && sig.conf >= 60 && sig.agree >= 3 && sig.newsFilter.safe && (now3 - lastNotif > 60000)) { sendNotif((sig.dir === 'BUY' ? '📈 BUY ' : '📉 SELL ') + PAIRS[activePair].label + ' - ' + sig.conf + '%', sig.action + ' | ' + formatDuration(sig.recSec) + ' | ' + sig.agree + '/' + sig.total); Vibration.vibrate([0, 500, 200, 500]); setLastNotif(now3); } } } return 8; } return prev - 1; }); }, 1000); return function() { clearInterval(t); }; }, [activePair, notifOn, notifReady, lastNotif]);
  useEffect(function() { doConnect(); connectWhale(); return function() { if (wsRef.current) wsRef.current.close(); if (whaleWsRef.current) whaleWsRef.current.close(); }; }, [activePair, activeTF]);

  function doConnect() { if (wsRef.current) wsRef.current.close(); setConnecting(true); setConnected(false); var pair = PAIRS[activePair], tf = TFS[activeTF]; fetch('https://api.binance.com/api/v3/klines?symbol=' + pair.sym.toUpperCase() + '&interval=' + tf.key + '&limit=80').then(function(r) { return r.json(); }).then(function(data) { var hist = data.map(function(k) { return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }; }); candlesRef.current = hist; setCandles(hist.slice()); setLivePrice(hist[hist.length - 1].c); var sig = fullAnalysis(hist, pair.dec); if (sig) setSignal(sig); var ws = new WebSocket('wss://stream.binance.com:9443/ws/' + pair.sym + '@kline_' + tf.key); wsRef.current = ws; ws.onopen = function() { setConnected(true); setConnecting(false); }; ws.onmessage = function(e) { var msg = JSON.parse(e.data); if (msg.k) { var k2 = msg.k, c2 = { t: k2.t, o: +k2.o, h: +k2.h, l: +k2.l, c: +k2.c, v: +k2.v }; var prev = candlesRef.current; if (prev.length > 0 && prev[prev.length - 1].t === c2.t) prev[prev.length - 1] = c2; else { prev.push(c2); if (prev.length > 100) prev.shift(); } candlesRef.current = prev.slice(); setCandles(prev.slice()); setPriceUp(c2.c >= livePrice); setLivePrice(c2.c); } }; ws.onerror = function() { setConnected(false); setConnecting(false); setTimeout(doConnect, 3000); }; ws.onclose = function() { setConnected(false); setTimeout(doConnect, 3000); }; }).catch(function() { setConnecting(false); setTimeout(doConnect, 5000); }); }
  function connectWhale() { if (whaleWsRef.current) whaleWsRef.current.close(); var pair = PAIRS[activePair]; whaleTradesRef.current = []; whaleBuyRef.current = 0; whaleSellRef.current = 0; whaleCountRef.current = 0; setWhaleTrades([]); setWhaleBuyVol(0); setWhaleSellVol(0); setWhaleCount(0); var wws = new WebSocket('wss://stream.binance.com:9443/ws/' + pair.sym + '@aggTrade'); whaleWsRef.current = wws; wws.onmessage = function(e) { var msg = JSON.parse(e.data); var price2 = parseFloat(msg.p), qty = parseFloat(msg.q), usdVal = price2 * qty; var isBuy = !msg.m; if (isBuy) whaleBuyRef.current += usdVal; else whaleSellRef.current += usdVal; if (usdVal >= pair.whaleUSD) { whaleCountRef.current++; var trade = { id: msg.a, time: Date.now(), price: price2, qty: qty, usd: usdVal, side: isBuy ? 'BUY' : 'SELL', size: usdVal >= pair.whaleUSD * 10 ? 'MEGA' : usdVal >= pair.whaleUSD * 3 ? 'LARGE' : 'WHALE' }; var updated = [trade].concat(whaleTradesRef.current).slice(0, 30); whaleTradesRef.current = updated; setWhaleTrades(updated); setWhaleCount(whaleCountRef.current); if (trade.size === 'MEGA' && notifOn && notifReady) { sendNotif('🐋 MEGA ' + trade.side + ' ' + pair.label, formatUSD(trade.usd)); Vibration.vibrate([0, 300, 100, 300]); } } if (Math.random() < 0.05) { setWhaleBuyVol(whaleBuyRef.current); setWhaleSellVol(whaleSellRef.current); } }; }

  var pair = PAIRS[activePair];
  var dirCol = signal ? (signal.dir === 'BUY' ? C.green : signal.dir === 'SELL' ? C.red : C.amber) : C.amber;
  var strength = signal ? getStrength(signal.conf) : getStrength(50);
  var totalVol = whaleBuyVol + whaleSellVol;
  var buyPressure = totalVol > 0 ? Math.round(whaleBuyVol / totalVol * 100) : 50;

  function copyToken() {
    if (Clipboard && Clipboard.setString) { Clipboard.setString(pushToken); Alert.alert('Copied!', 'Push token copied. Paste it in server.js'); }
    else { Alert.alert('Token', pushToken); }
  }

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView style={st.scroll} showsVerticalScrollIndicator={false}>
        <View style={st.header}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={[st.dot, connected && st.dotOk]} /><Text style={st.logoText}>Smart Terminal</Text><View style={st.liveBadge}><Text style={st.liveText}>LIVE</Text></View></View><Text style={st.clock}>{clock}</Text></View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.pairBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 5 }}>
          {PAIRS.map(function(p, i) { return <TouchableOpacity key={i} onPress={function() { setActivePair(i); setCandles([]); candlesRef.current = []; }} style={[st.chip, activePair === i && st.chipActive]}><Text style={[st.chipText, activePair === i && st.chipTextActive]}>{p.label}</Text></TouchableOpacity>; })}
        </ScrollView>
        <View style={st.tfBar}>{TFS.map(function(t, i) { return <TouchableOpacity key={i} onPress={function() { setActiveTF(i); setCandles([]); candlesRef.current = []; }} style={[st.tfBtn, activeTF === i && st.tfActive]}><Text style={[st.tfText, activeTF === i && st.tfTextActive]}>{t.label}</Text></TouchableOpacity>; })}</View>

        {signal && <View style={[st.filterBanner, { backgroundColor: signal.newsFilter.safe ? 'rgba(0,200,83,0.1)' : 'rgba(255,23,68,0.1)', borderColor: signal.newsFilter.safe ? 'rgba(0,200,83,0.3)' : 'rgba(255,23,68,0.3)' }]}><Text style={{ fontSize: 12 }}>{signal.newsFilter.safe ? '✅' : '❌'}</Text><Text style={[st.filterText, { color: signal.newsFilter.color }]}>{signal.newsFilter.reason}</Text></View>}

        <MiniChart candles={candles} pair={pair} />
        <View style={st.priceRow}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={[st.connDot, connected ? st.connOk : st.connWait]} /><Text style={{ fontSize: 9, color: C.txt3 }}>{connected ? 'Live: ' + pair.label : 'Connecting...'}</Text></View><View style={[st.priceTag, { backgroundColor: priceUp ? C.green : C.red }]}><Text style={st.priceTagText}>{livePrice.toFixed(pair.dec)}</Text></View></View>

        {/* TABS */}
        <View style={st.tabBar}>
          {['Signal', '🐋 Whales', 'Structure', '⚙️'].map(function(tab, i) { return <TouchableOpacity key={i} onPress={function() { setActiveTab(i); }} style={[st.tab, activeTab === i && st.tabActive]}><Text style={[st.tabText, activeTab === i && st.tabTextActive]}>{tab}</Text></TouchableOpacity>; })}
        </View>

        {/* SIGNAL TAB */}
        {activeTab === 0 && signal && (
          <View>
            {signal.dir !== 'HOLD' && <View style={[st.strengthBar, { backgroundColor: strength.bg, borderColor: strength.border }]}><PulsingDot color={strength.color} size={12} /><Text style={[st.strengthText, { color: strength.color }]}>{strength.level}</Text><Text style={[st.strengthConf, { color: strength.color }]}>{signal.conf}%</Text></View>}
            <View style={[st.sigBox, { borderColor: strength.border, backgroundColor: strength.bg }]}>
              <View style={[st.sigIcon, { backgroundColor: dirCol + '20', borderWidth: 2, borderColor: strength.color }]}><Text style={{ fontSize: 22, color: dirCol, fontWeight: '700' }}>{signal.dir === 'BUY' ? '↑' : signal.dir === 'SELL' ? '↓' : '↔'}</Text></View>
              <View style={{ flex: 1 }}><Text style={[st.sigDir, { color: dirCol }]}>{signal.dir === 'BUY' ? 'BUY (CALL)' : signal.dir === 'SELL' ? 'SELL (PUT)' : 'HOLD'}</Text><Text style={st.sigSub}>{signal.agree}/{signal.total} indicators</Text></View>
              <View style={{ alignItems: 'flex-end' }}><View style={[st.recBadge, { backgroundColor: strength.color }]}><Text style={{ fontSize: 7, fontWeight: '700', color: '#000' }}>{signal.dir === 'HOLD' ? 'WAIT' : 'REC'}</Text></View><Text style={[st.recTime, { color: strength.color }]}>{signal.recSec === 0 ? '--:--' : formatDuration(signal.recSec)}</Text><Text style={{ fontSize: 8, color: C.txt3 }}>duration</Text></View>
            </View>
            <View style={st.actionBox}><Text style={st.actionText}>{signal.action}</Text></View>
            <View style={st.sentRow}><Text style={[st.sentPct, { color: C.green }]}>{signal.buyPct}%</Text><View style={st.sentTrack}><View style={[st.sentFill, { width: signal.buyPct + '%', backgroundColor: C.green }]} /><View style={[st.sentFill, { width: (100 - signal.buyPct) + '%', backgroundColor: C.red }]} /></View><Text style={[st.sentPct, { color: C.red }]}>{100 - signal.buyPct}%</Text></View>
            <View style={st.indGrid}>{signal.inds.map(function(ind, i) { var ic = ind.d === 'BUY' ? C.green : ind.d === 'SELL' ? C.red : C.amber; return <View key={i} style={[st.ind, { borderColor: ic + '40' }]}><Text style={st.indName}>{ind.n}</Text><Text style={[st.indVal, { color: ic }]}>{ind.d}</Text><Text style={st.indNum}>{String(ind.v)}</Text></View>; })}</View>
            <View style={st.btnRow}>
              <TouchableOpacity style={[st.buyBtn, signal.dir === 'BUY' ? { shadowColor: strength.color, shadowOpacity: 0.6, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } } : st.dimBtn]}><Text style={st.btnText}>BUY</Text></TouchableOpacity>
              <TouchableOpacity style={[st.sellBtn, signal.dir === 'SELL' ? { shadowColor: strength.color, shadowOpacity: 0.6, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } } : st.dimBtn]}><Text style={st.btnText}>SELL</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {/* WHALES TAB */}
        {activeTab === 1 && (<View style={{ paddingHorizontal: 12 }}>
          <View style={st.whaleStats}><View style={st.whaleStat}><Text style={st.whaleStatLabel}>TRADES</Text><Text style={[st.whaleStatVal, { color: C.gold }]}>{whaleCount}</Text></View><View style={st.whaleStat}><Text style={st.whaleStatLabel}>BUY</Text><Text style={[st.whaleStatVal, { color: C.green }]}>{formatUSD(whaleBuyVol)}</Text></View><View style={st.whaleStat}><Text style={st.whaleStatLabel}>SELL</Text><Text style={[st.whaleStatVal, { color: C.red }]}>{formatUSD(whaleSellVol)}</Text></View></View>
          <View style={{ marginBottom: 10 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ fontSize: 11, fontWeight: '700', color: C.green, fontFamily: 'monospace', minWidth: 35 }}>{buyPressure}%</Text><View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.bg3, flexDirection: 'row', overflow: 'hidden' }}><View style={{ width: buyPressure + '%', height: 8, backgroundColor: C.green }} /><View style={{ width: (100 - buyPressure) + '%', height: 8, backgroundColor: C.red }} /></View><Text style={{ fontSize: 11, fontWeight: '700', color: C.red, fontFamily: 'monospace', minWidth: 35 }}>{100 - buyPressure}%</Text></View></View>
          {whaleTrades.length === 0 && <View style={{ padding: 20, alignItems: 'center' }}><Text style={{ fontSize: 24 }}>🐋</Text><Text style={{ fontSize: 11, color: C.txt2, marginTop: 8 }}>Waiting for whales...</Text></View>}
          {whaleTrades.map(function(t, i) { var isBuy = t.side === 'BUY'; var sizeCol = t.size === 'MEGA' ? C.gold : t.size === 'LARGE' ? C.purple : isBuy ? C.green : C.red; var sizeBg = t.size === 'MEGA' ? 'rgba(251,191,36,0.15)' : t.size === 'LARGE' ? C.purplebg : isBuy ? C.greenbg : C.redbg; return (<View key={t.id || i} style={[st.whaleItem, { borderLeftWidth: 3, borderLeftColor: sizeCol }]}><View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ fontSize: 14 }}>{t.size === 'MEGA' ? '🐋🐋' : t.size === 'LARGE' ? '🐋' : isBuy ? '🟢' : '🔴'}</Text><View style={[st.badge, { backgroundColor: sizeBg }]}><Text style={{ fontSize: 10, fontWeight: '700', color: sizeCol }}>{t.side}</Text></View>{t.size !== 'WHALE' && <View style={[st.badge, { backgroundColor: sizeBg }]}><Text style={{ fontSize: 8, fontWeight: '700', color: sizeCol }}>{t.size}</Text></View>}</View><Text style={{ fontSize: 10, color: C.txt2, marginTop: 3 }}>{t.price.toFixed(pair.dec)} - <Text style={{ color: sizeCol, fontWeight: '700' }}>{formatUSD(t.usd)}</Text></Text></View><Text style={{ fontSize: 9, color: C.txt3 }}>{timeAgo(t.time)}</Text></View>); })}
        </View>)}

        {/* STRUCTURE TAB */}
        {activeTab === 2 && signal && (<View style={{ paddingHorizontal: 12 }}>
          <Text style={st.secTitle}>Break of Structure</Text>
          {signal.bos.length > 0 ? signal.bos.map(function(b, i) { return <View key={i} style={st.structItem}><Text style={{ color: b.dir === 'BULLISH' ? C.green : C.red, fontWeight: '700', fontSize: 12 }}>{b.dir} BOS</Text><Text style={st.structVal}>{b.level.toFixed(pair.dec)}</Text></View>; }) : <Text style={st.structNone}>No BOS detected</Text>}
          <Text style={st.secTitle}>Fair Value Gaps</Text>
          {signal.fvg.length > 0 ? signal.fvg.map(function(f, i) { return <View key={i} style={st.structItem}><Text style={{ color: f.dir === 'BULLISH' ? C.green : C.red, fontWeight: '700', fontSize: 12 }}>{f.dir} FVG</Text><Text style={st.structVal}>{f.bot.toFixed(pair.dec)} - {f.top.toFixed(pair.dec)}</Text></View>; }) : <Text style={st.structNone}>No FVG detected</Text>}
          <Text style={st.secTitle}>Support / Resistance</Text>
          {signal.sr.resistance && <View><View style={st.structItem}><Text style={{ color: C.red, fontWeight: '700', fontSize: 12 }}>Resistance</Text><Text style={st.structVal}>{signal.sr.resistance.toFixed(pair.dec)}</Text></View><View style={st.structItem}><Text style={{ color: C.green, fontWeight: '700', fontSize: 12 }}>Support</Text><Text style={st.structVal}>{signal.sr.support.toFixed(pair.dec)}</Text></View></View>}
        </View>)}

        {/* SETTINGS TAB */}
        {activeTab === 3 && (<View style={{ paddingHorizontal: 12 }}>
          <Text style={st.secTitle}>Notifications</Text>
          <View style={st.settingRow}><Text style={{ fontSize: 12, color: C.txt }}>Push notifications</Text><Switch value={notifOn} onValueChange={setNotifOn} trackColor={{ false: C.bg3, true: C.purple + '60' }} thumbColor={notifOn ? C.purple : C.txt3} /></View>
          <View style={st.settingRow}><Text style={{ fontSize: 12, color: C.txt }}>Status</Text><Text style={{ fontSize: 12, color: notifReady ? C.green : C.red, fontWeight: '600' }}>{notifReady ? 'Ready' : 'Not available'}</Text></View>

          <Text style={st.secTitle}>Push Token (for 24/7 server)</Text>
          <Text style={{ fontSize: 9, color: C.txt3, marginBottom: 8 }}>Copy this token and paste it in server.js to get notifications even when the app is closed</Text>
          <View style={st.tokenBox}>
            <Text style={st.tokenText} selectable={true}>{pushToken}</Text>
          </View>
          <TouchableOpacity onPress={copyToken} style={st.copyBtn}><Text style={st.copyBtnText}>Copy Token</Text></TouchableOpacity>

          <Text style={st.secTitle}>Signal Settings</Text>
          <View style={st.settingRow}><Text style={{ fontSize: 11, color: C.txt2 }}>Min confidence</Text><Text style={{ fontSize: 11, color: C.txt, fontFamily: 'monospace' }}>60%</Text></View>
          <View style={st.settingRow}><Text style={{ fontSize: 11, color: C.txt2 }}>Min indicators</Text><Text style={{ fontSize: 11, color: C.txt, fontFamily: 'monospace' }}>3 / 8</Text></View>
          <View style={st.settingRow}><Text style={{ fontSize: 11, color: C.txt2 }}>Cooldown</Text><Text style={{ fontSize: 11, color: C.txt, fontFamily: 'monospace' }}>60s</Text></View>
          <View style={st.settingRow}><Text style={{ fontSize: 11, color: C.txt2 }}>Durations</Text><Text style={{ fontSize: 11, color: C.txt, fontFamily: 'monospace' }}>30s - 30min</Text></View>

          <Text style={st.secTitle}>Duration Guide</Text>
          <View style={st.guideBox}>
            <Text style={st.guideRow}>90%+ → 0:30   85%+ → 1:00</Text>
            <Text style={st.guideRow}>80%+ → 2:00   75%+ → 3:00</Text>
            <Text style={st.guideRow}>70%+ → 5:00   65%+ → 10:00</Text>
            <Text style={st.guideRow}>60%+ → 15:00  {'<60% → 30:00'}</Text>
          </View>
        </View>)}

        <View style={st.cdBar}><Text style={st.cdText}>Next: {countdown}s</Text><View style={st.cdTrack}><View style={[st.cdFill, { width: (countdown / 8 * 100) + '%', backgroundColor: strength.color }]} /></View></View>

        {signalLog.length > 0 && <View><Text style={st.logHdr}>HISTORY</Text>{signalLog.map(function(l, i) { var ls = getStrength(l.conf); return <View key={i} style={[st.logEntry, { borderLeftWidth: 3, borderLeftColor: ls.color }]}><Text style={st.logTime}>{l.time}</Text><Text style={st.logPair}>{l.pair}</Text><View style={[st.logSig, { backgroundColor: l.dir === 'BUY' ? C.greenbg : C.redbg }]}><Text style={{ fontSize: 9, fontWeight: '700', color: l.dir === 'BUY' ? C.green : C.red }}>{l.dir}</Text></View><Text style={st.logDur}>{formatDuration(l.dur)}</Text><Text style={[st.logConf, { color: ls.color }]}>{l.conf}%</Text></View>; })}</View>}
        <Text style={st.foot}>Live Binance - SMC + Whales + 24/7 Alerts - Not financial advice</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

var st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, scroll: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, paddingHorizontal: 14, backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.amber }, dotOk: { backgroundColor: C.green },
  logoText: { fontWeight: '700', fontSize: 13, color: C.txt },
  liveBadge: { backgroundColor: C.greenbg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 }, liveText: { fontSize: 8, fontWeight: '700', color: C.green, letterSpacing: 1 },
  clock: { fontFamily: 'monospace', fontSize: 11, color: C.txt2 },
  pairBar: { backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: C.border }, chipActive: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { fontSize: 11, fontWeight: '600', color: C.txt2 }, chipTextActive: { color: '#fff' },
  tfBar: { flexDirection: 'row', gap: 3, paddingHorizontal: 12, paddingVertical: 5 },
  tfBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }, tfActive: { backgroundColor: C.bg3 },
  tfText: { fontSize: 9, fontWeight: '600', color: C.txt3, fontFamily: 'monospace' }, tfTextActive: { color: C.txt },
  filterBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 6, padding: 8, borderRadius: 8, borderWidth: 1 },
  filterText: { fontSize: 10, fontWeight: '600', flex: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 4 },
  connDot: { width: 5, height: 5, borderRadius: 3 }, connOk: { backgroundColor: C.green }, connWait: { backgroundColor: C.amber },
  priceTag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 }, priceTagText: { fontFamily: 'monospace', fontSize: 12, fontWeight: '600', color: '#fff' },
  tabBar: { flexDirection: 'row', marginHorizontal: 12, marginVertical: 6, backgroundColor: C.bg3, borderRadius: 8, padding: 3 },
  tab: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6 }, tabActive: { backgroundColor: C.bg2 },
  tabText: { fontSize: 10, fontWeight: '600', color: C.txt3 }, tabTextActive: { color: C.txt },
  strengthBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginVertical: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1 },
  strengthText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, flex: 1 }, strengthConf: { fontSize: 16, fontWeight: '700', fontFamily: 'monospace' },
  sigBox: { marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sigIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sigDir: { fontSize: 15, fontWeight: '700' }, sigSub: { fontSize: 10, color: C.txt2, marginTop: 2 },
  recBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, marginBottom: 2 }, recTime: { fontFamily: 'monospace', fontSize: 20, fontWeight: '700' },
  actionBox: { marginHorizontal: 12, marginBottom: 8, padding: 10, backgroundColor: C.bg3, borderRadius: 8, borderWidth: 1, borderColor: C.border }, actionText: { fontSize: 12, color: C.txt, fontWeight: '600', textAlign: 'center' },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, marginBottom: 6 },
  sentPct: { fontSize: 11, fontWeight: '700', minWidth: 30, textAlign: 'center', fontFamily: 'monospace' },
  sentTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: C.bg3, flexDirection: 'row', overflow: 'hidden' }, sentFill: { height: 5 },
  indGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12, marginBottom: 6 },
  ind: { width: '18%', backgroundColor: C.bg3, borderRadius: 6, padding: 4, alignItems: 'center', borderWidth: 1 },
  indName: { fontSize: 6, color: C.txt3, fontWeight: '600' }, indVal: { fontFamily: 'monospace', fontSize: 8, fontWeight: '600', marginTop: 1 }, indNum: { fontFamily: 'monospace', fontSize: 7, color: C.txt2, marginTop: 1 },
  btnRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, marginBottom: 8 },
  buyBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: C.green },
  sellBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: C.red },
  dimBtn: { opacity: 0.3 }, btnText: { fontSize: 14, fontWeight: '700', color: '#fff', letterSpacing: 1.2 },
  whaleStats: { flexDirection: 'row', gap: 6, marginBottom: 10, marginTop: 6 },
  whaleStat: { flex: 1, backgroundColor: C.bg3, borderRadius: 8, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  whaleStatLabel: { fontSize: 7, color: C.txt3, fontWeight: '600' }, whaleStatVal: { fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginTop: 3 },
  whaleItem: { backgroundColor: C.bg3, borderRadius: 8, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  secTitle: { fontSize: 12, fontWeight: '700', color: C.cyan, marginTop: 10, marginBottom: 6 },
  structItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, backgroundColor: C.bg3, borderRadius: 8, marginBottom: 4, borderWidth: 1, borderColor: C.border },
  structVal: { fontFamily: 'monospace', fontSize: 11, color: C.txt2 }, structNone: { fontSize: 10, color: C.txt3, padding: 8 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: C.bg3, borderRadius: 8, marginBottom: 4, borderWidth: 1, borderColor: C.border },
  tokenBox: { backgroundColor: C.bg3, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: C.purple + '40', marginBottom: 8 },
  tokenText: { fontFamily: 'monospace', fontSize: 10, color: C.purple, textAlign: 'center' },
  copyBtn: { backgroundColor: C.purple, borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 10 },
  copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  guideBox: { backgroundColor: C.bg3, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.border },
  guideRow: { fontFamily: 'monospace', fontSize: 10, color: C.txt2, lineHeight: 18 },
  cdBar: { paddingHorizontal: 14, alignItems: 'center', marginVertical: 8 }, cdText: { fontFamily: 'monospace', fontSize: 9, color: C.amber },
  cdTrack: { height: 2, backgroundColor: C.bg3, borderRadius: 1, marginTop: 3, width: '100%', overflow: 'hidden' }, cdFill: { height: 2 },
  logHdr: { paddingHorizontal: 14, paddingVertical: 6, fontSize: 10, fontWeight: '600', color: C.txt2, borderTopWidth: 1, borderTopColor: C.border, marginTop: 4 },
  logEntry: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 12, marginBottom: 3, padding: 6, paddingHorizontal: 8, borderRadius: 6, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  logTime: { fontFamily: 'monospace', fontSize: 9, color: C.txt3, minWidth: 50 }, logPair: { fontWeight: '600', fontSize: 10, color: C.txt, minWidth: 55 },
  logSig: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, minWidth: 34, alignItems: 'center' },
  logDur: { fontFamily: 'monospace', fontSize: 8, color: C.txt2 }, logConf: { fontFamily: 'monospace', fontSize: 9, marginLeft: 'auto' },
  foot: { padding: 14, textAlign: 'center', fontSize: 7, color: C.txt3, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
});
