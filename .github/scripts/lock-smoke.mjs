// 에뮬레이터에서 잠금 흐름을 실제처럼 점검한다 (디버그 APK — WebView 에 크롬 개발자 도구 프로토콜로 붙는다).
//  1 앱 실행·플러그인  2 잠금 켜기(서비스)  3 PIN 설정 → 화면 끄기·켜기 → 잠금화면 위 운동 화면
//  4 잠금 화면에 센서 값이 들어오나  5 가짜 스쿼트 → 열림 → 시스템 잠금(PIN)은 그대로 → PIN 으로 풀기  6 포인트
//  7 '급할 때 그냥 열기'(네이티브 버튼)  8 전화가 오면 비키기  9 카메라 모드(참고)  10 긴급 전화(참고)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [OUT, PKG] = process.argv.slice(2);
const PIN = '1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { stages: [], checks: {} };
const save = () => fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
setTimeout(() => { report.fatal = '전체 시간 초과'; save(); process.exit(2); }, 25 * 60 * 1000).unref();

function adb(args, timeout = 60000) {
  try {
    return execFileSync('adb', args, { timeout, maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (e) {
    return `ERR ${String(e.message).slice(0, 300)}`;
  }
}
const sh = (cmd, timeout) => adb(['shell', cmd], timeout);
function shot(name) {
  try { fs.writeFileSync(`${OUT}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000 })); } catch { /* 무시 */ }
}
function log(name, value) {
  report.stages.push({ name, at: new Date().toISOString(), value });
  save();
  console.log(`[${name}]`, JSON.stringify(value));
  return value;
}
const REQUIRED = new Set();
function check(name, ok, required = true) {
  report.checks[name] = !!ok;
  if (required) REQUIRED.add(name);
  save();
  console.log(`${ok ? '✅' : (required ? '❌' : '⚠️')} ${name}`);
}

/* ---------- 폰 상태 ---------- */

function lockState() {
  const a = sh('dumpsys activity activities');
  const resumed = (a.match(/topResumedActivity=ActivityRecord\{[^}]*\s(\S+\/\S+)/) || a.match(/mResumedActivity: ActivityRecord\{[^}]*\s(\S+\/\S+)/) || [])[1] || null;
  const kg = (a.match(/mKeyguardShowing=(true|false)/) || [])[1];
  return { lockAlive: a.includes(`${PKG}/.LockActivity`), resumed, keyguard: kg === 'true' ? true : kg === 'false' ? false : null };
}
function focus() {
  const w = sh('dumpsys window');
  return (w.match(/mCurrentFocus=Window\{[^}]*\s(\S+)\}/) || [])[1] || null;
}
const state = () => ({ ...lockState(), focus: focus() });

/**
 * 화면 끄기 → (꺼진 동안 운동 화면이 미리 떠야) → 켜기.
 * 에뮬레이터는 화면 꺼짐 방송이 3~5초 늦게 오기도 해서(API 34·36 실측) 정해진 시간 대신 뜰 때까지 기다린다(최대 expectMs).
 */
async function cycle(name, { expectLock = true, expectMs = 10000 } = {}) {
  sh('input keyevent 223');
  const t0 = Date.now();
  let off = lockState();
  while (expectLock && !off.lockAlive && Date.now() - t0 < expectMs) {
    await sleep(500);
    off = lockState();
  }
  if (!expectLock) await sleep(3000);
  off.waitedMs = Date.now() - t0;
  await sleep(800);
  sh('input keyevent 224');
  await sleep(2500);
  const on = state();
  shot(name);
  return log(name, { off, on });
}

/** 시스템 잠금(PIN) 풀기 */
async function unlockPin() {
  for (let i = 0; i < 3; i++) {
    const s = lockState();
    if (s.keyguard === false) return true;
    sh('input keyevent 224');
    sh('input keyevent 82');
    await sleep(800);
    sh(`input text ${PIN}`);
    sh('input keyevent 66');
    await sleep(2000);
  }
  return lockState().keyguard === false;
}

/** 화면 요소를 글씨로 찾아 누른다 (네이티브 버튼 줄) */
function tapText(re) {
  sh('uiautomator dump /sdcard/ui.xml', 30000);
  const xml = sh('cat /sdcard/ui.xml');
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const node = m[0];
    const text = (node.match(/ text="([^"]*)"/) || [])[1] || '';
    const desc = (node.match(/ content-desc="([^"]*)"/) || [])[1] || '';
    if (re.test(text) || re.test(desc)) {
      const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (!b) continue;
      const x = Math.round((+b[1] + +b[3]) / 2);
      const y = Math.round((+b[2] + +b[4]) / 2);
      sh(`input tap ${x} ${y}`);
      return { x, y, text: text || desc };
    }
  }
  return null;
}

/* ---------- WebView (크롬 개발자 도구 프로토콜) ---------- */

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (m) => { const msg = JSON.parse(m.data); this.pending.get(msg.id)?.(msg); this.pending.delete(msg.id); };
    return this;
  }
  eval(expression, ms = 30000) {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== 1) { resolve({ error: '연결 끊김' }); return; }
      const mid = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(mid); resolve({ error: '시간 초과' }); }, ms);
      this.pending.set(mid, (msg) => {
        clearTimeout(timer);
        const r = msg.result;
        resolve(r?.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r?.result?.value);
      });
      this.ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  }
  close() { try { this.ws.close(); } catch { /* 무시 */ } }
}

async function targets() {
  const pid = sh(`pidof ${PKG}`).trim();
  if (pid && !pid.startsWith('ERR')) adb(['forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`]);
  try {
    return (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
  } catch {
    return [];
  }
}
async function connect(match, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = (await targets()).find((x) => match(x.url || ''));
    if (t) {
      try { return await new Cdp(t.webSocketDebuggerUrl).open(); } catch { /* 다시 */ }
    }
    await sleep(1000);
  }
  return null;
}
const isMain = (u) => u.startsWith('https://localhost') && !u.includes('lock.html');
const isLock = (u) => u.includes('lock.html');
const NONE = { eval: async () => ({ error: '페이지 없음' }), close() {} };

/* ---------- 점검 ---------- */

let main = (await connect(isMain, 60000)) || NONE;
const app = log('1 앱', await main.eval(`(async () => {
  // 느린 에뮬레이터(API 36)에선 앱 스크립트가 늦게 뜬다 → 준비될 때까지
  for (let i = 0; i < 60 && !(window.__fitlockApp?.FitLock && document.getElementById('view')?.innerText); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const F = window.__fitlockApp?.FitLock;
  return {
    url: location.href, platform: Capacitor.getPlatform(),
    plugins: ['FitLock', 'TextToSpeech', 'App', 'Share', 'Filesystem'].filter((p) => Capacitor.isPluginAvailable(p)),
    info: F ? await F.getInfo() : null, status: F ? await F.getStatus() : null,
    webview: (navigator.userAgent.match(/Chrome\\/([\\d.]+)/) || [])[1],
    home: document.getElementById('view')?.innerText.slice(0, 120),
  };
})()`, 60000));
check('app', app?.plugins?.includes('FitLock') && app?.info?.screen === 'app');

const enable = log('2 잠금 켜기', await main.eval(`(async () => {
  const s = JSON.parse(localStorage.getItem('fitlock.settings.v1') || '{}');
  s.lock = { ...(s.lock || {}), enabled: true, freeMinutes: 0, skipsPerDay: 3,
    schedule: { enabled: false, windows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '07:00', end: '23:00' }] },
    places: { enabled: false, mode: 'only', list: [] } };
  Object.assign(s, { target: 5, mode: 'sensor', gpu: false, voice: false, ackNotSecurity: true });
  localStorage.setItem('fitlock.settings.v1', JSON.stringify(s));
  await window.__fitlockApp.syncNative();
  await new Promise((r) => setTimeout(r, 2000));
  return await window.__fitlockApp.FitLock.getStatus();
})()`));
check('service', enable?.serviceRunning === true && enable?.overlay === true && enable?.enabled === true);
const svc = sh(`dumpsys activity services ${PKG}`);
report.serviceDump = svc.slice(0, 2500);
check('serviceForeground', /isForeground=true/.test(svc), false);
shot('1b_enabled');

log('3 PIN 설정', sh(`locksettings set-pin ${PIN}`).trim());
sh('input keyevent 3');
await sleep(1500);

const c1 = await cycle('2_lock_over_keyguard');
check('lockPrelaunched', c1.off.lockAlive);
check('lockOnTop', /LockActivity/.test(c1.on.focus || '') || /LockActivity/.test(c1.on.resumed || ''));
check('keyguardUnder', c1.on.keyguard === true, false);

let lock = (await connect(isLock, 30000)) || NONE;
const motion = log('4 잠금 화면 센서', await lock.eval(`(async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const s = window.__fitlock.state();
  return { ...s, nativeBar: getComputedStyle(document.documentElement).getPropertyValue('--native-bar'),
    goal: document.getElementById('lk-goal').innerText };
})()`));
check('lockPage', motion?.kind === 'lock' && motion?.visible === true);
check('motionEvents', motion?.sensorEvents > 0 && motion?.motionRunning === true);

const inj = log('5 가짜 스쿼트', await lock.eval(`window.__fitlock.inject('squat10', { realtime: false })`, 90000));
check('counted', inj?.done === true && inj?.count >= 5);
lock.close();
await sleep(4500); // 성공 화면 2초 + 시스템 잠금 해제 화면
shot('3_after_success');
// 운동을 다 하면 시스템 잠금 해제(PIN) 화면이 뜬다 — 핏락이 PIN 을 대신 풀지 않는다
const after = log('5b 열린 뒤', state());
check('bouncerShown', !/LockActivity/.test(after.focus || ''));
check('systemLockKept', after.keyguard === true, false);
const pinOk = await unlockPin();
await sleep(1500);
const afterPin = log('5c PIN 으로 풀기', state());
check('unlockedWithPin', pinOk);
check('lockClosed', !afterPin.lockAlive);
shot('4_unlocked');

main = (await connect(isMain, 20000)) || NONE;
const pts = log('6 포인트', await main.eval(`(async () => {
  await window.__fitlockApp.refreshAll();
  const s = JSON.parse(localStorage.getItem('fitlock.state.v1'));
  return { points: s.points, unlocks: s.log.filter((l) => l.kind === 'unlock').length, status: await window.__fitlockApp.FitLock.getStatus() };
})()`));
check('points', pts?.points > 0 && pts?.unlocks >= 1);

// 매번 잠금(freeMinutes 0)이라 다시 끄고 켜면 또 잠긴다
const c2 = await cycle('5_lock_again');
check('lockAgain', c2.off.lockAlive);
await sleep(1500);
const tapped = tapText(/급할 때 그냥 열기/);
await sleep(3000);
const s2 = log('7 급할 때 그냥 열기', { tapped, ...state() });
shot('6_after_skip');
check('skipTapped', !!tapped && !/LockActivity/.test(s2.focus || ''));
await unlockPin();
await sleep(1500);
check('skip', !lockState().lockAlive);
const skipRec = log('7b 건너뛰기 기록', await main.eval(`(async () => {
  await window.__fitlockApp.refreshAll();
  const s = JSON.parse(localStorage.getItem('fitlock.state.v1'));
  const k = Object.keys(s.days).sort().pop();
  return { skips: s.days[k].skips, freeSkips: s.days[k].freeSkips, status: await window.__fitlockApp.FitLock.getStatus() };
})()`));
check('skipRecorded', skipRec?.skips === 1 && skipRec?.freeSkips === 1);

// 건너뛰면 10분 자유 → 점검을 이어가려고 다시 잠그기
log('8 다시 잠그기', await main.eval(`window.__fitlockApp.FitLock.relock().then(() => 'ok')`));
const c3 = await cycle('7_lock_before_call');
log('8b 전화 걸기', adb(['emu', 'gsm', 'call', '5551234']).trim());
await sleep(4000);
const s3 = log('8c 전화 옴', state());
shot('8_call');
check('callStepAside', c3.off.lockAlive && !s3.lockAlive);
adb(['emu', 'gsm', 'cancel', '5551234']);
await sleep(2500);
await unlockPin();

// 참고: 카메라 모드 — 잠금 화면에서 카메라가 켜지고 AI(CPU)가 프레임을 보나, 화면이 꺼지면 꺼지나
log('9 카메라 모드로', await main.eval(`(async () => {
  const s = JSON.parse(localStorage.getItem('fitlock.settings.v1'));
  s.mode = 'camera'; s.gpu = false;
  localStorage.setItem('fitlock.settings.v1', JSON.stringify(s));
  await window.__fitlockApp.syncNative();
  await window.__fitlockApp.FitLock.relock();
  return 'ok';
})()`));
await cycle('9_lock_camera');
lock = (await connect(isLock, 30000)) || NONE;
const cam = log('9b 카메라', await lock.eval(`(async () => {
  let s;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    s = window.__fitlock.state();
    if (s.camFrames > 5) break;
  }
  return { ...s, msg: document.getElementById('lk-cam-msg').innerText, video: [document.getElementById('lk-video').videoWidth, document.getElementById('lk-video').videoHeight] };
})()`, 100000));
shot('10_camera');
check('camera', cam?.camRunning === true && cam?.camFrames > 0, false);
sh('input keyevent 223');
await sleep(3000);
const camOff = log('9c 화면 끄면 카메라', await lock.eval('window.__fitlock.state()'));
check('cameraOffWhenHidden', camOff && camOff.camRunning === false, false);
lock.close();
sh('input keyevent 224');
await sleep(2500);

// 참고: 긴급 전화 버튼
const em = tapText(/긴급 전화/);
await sleep(3500);
const s4 = log('10 긴급 전화', { tapped: em, ...state() });
shot('11_emergency');
check('emergency', !!em && !s4.lockAlive && /emergency|dialer|phone/i.test(`${s4.resumed} ${s4.focus}`), false);
sh('input keyevent 4');
await sleep(1000);

const failed = [...REQUIRED].filter((k) => !report.checks[k]);
report.required = failed.length === 0;
report.failed = failed;
save();
console.log(`필수 점검 ${report.required ? '모두 통과' : `실패: ${failed.join(', ')}`}`);
console.log('참고:', JSON.stringify(Object.fromEntries(Object.entries(report.checks).filter(([k]) => !REQUIRED.has(k)))));
main.close();
process.exit(report.required ? 0 : 1);
