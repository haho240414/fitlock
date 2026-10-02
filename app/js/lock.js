// 잠금 화면 (lock.html). 세 가지로 열린다:
//  - lock     : 안드로이드 잠금 화면 위(LockActivity). 아래 '긴급 전화'·'급할 때 그냥 열기'는 네이티브 버튼 줄이 맡는다
//  - practice : 앱에서 '지금 운동하기'(?practice=1) — 연습. 끝나면 앱 홈으로
//  - browser  : 브라우저 개발 미리 보기
// 지킬 것: 센서·카메라를 못 쓰면 바로 열어 준다. 센서·카메라는 화면이 보일 때만 켠다. 전화가 오면 네이티브가 비켜 준다.

import { $, fmt, hhmm, dateLabel, toast, coinBurst } from './ui.js';
import { FitLock, buzz } from './native.js';
import { loadSettings, loadState, updateState } from './store.js';
import { recordSession, recordSkip, recordPass, levelInfo, streakInfo, todaySummary, summaryOf } from './rewards.js';
import { SENSOR_EXERCISES } from './motion/rep-sensor.js';
import { MotionCounter } from './motion/source.js';
import { saveRecording } from './sensorlog.js';
import { Voice } from './voice.js';
import { playDemo } from './demo.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';

const params = new URLSearchParams(location.search);
const st = loadSettings();
const target = Math.max(1, Math.min(200, st.target | 0 || 10));
const sensorEx = SENSOR_EXERCISES[st.exercise] ? st.exercise : 'squat';
const camEx = EXERCISE_BY_ID[st.camExercise] ? st.camExercise : 'squat';
const voice = new Voice();
const C = 2 * Math.PI * 52; // 링 둘레

const ui = {
  kind: 'browser',     // lock | practice | browser
  info: null,
  mode: st.mode === 'camera' ? 'camera' : 'sensor',
  userSwitched: false, // 사용자가 직접 바꾼 세는 방법인지
  visible: false,
  done: false,
  carried: 0,          // 다른 세는 방법으로 이미 한 횟수
  count: 0,
  startedAt: Date.now(),
};
let motion = null;
let cam = null;
let stopDemo = null;
let meterRaf = 0;
let camPing = 0;

const exName = () => (ui.mode === 'camera' ? EXERCISE_BY_ID[camEx].name : SENSOR_EXERCISES[sensorEx].name);
const exId = () => (ui.mode === 'camera' ? camEx : sensorEx);

/* ---------- 화면 ---------- */

function renderHeader() {
  const s = loadState();
  $('lk-points').textContent = fmt(s.points);
  $('lk-streak').textContent = streakInfo(s).count;
  $('lk-level').textContent = levelInfo(s.earned).level;
  $('lk-today').textContent = `오늘 ${fmt(todaySummary(s).reps)}개`;
  document.body.classList.remove('theme-basic', 'theme-ocean', 'theme-sunset', 'theme-forest');
  document.body.classList.add(`theme-${s.inv.theme || 'basic'}`);
}

function tick() {
  $('lk-time').textContent = hhmm(Date.now());
  $('lk-date').textContent = dateLabel();
}

function renderGoal() {
  const verb = ui.kind === 'lock' ? '하면 열려요' : '해 볼까요?';
  $('lk-goal').innerHTML = `${exName()} <b>${target}개</b> ${verb}`;
  $('lk-target').textContent = target;
  $('lk-cam-target').textContent = target;
  $('lk-cam-ex').textContent = exName();
  $('lk-mode-sensor').classList.toggle('on', ui.mode === 'sensor');
  $('lk-mode-camera').classList.toggle('on', ui.mode === 'camera');
  $('lk-meter-box').hidden = ui.mode !== 'sensor';
  $('lk-hint').textContent = ui.mode === 'sensor' ? SENSOR_EXERCISES[sensorEx].hint : '폰을 세워 두고 2~3m 뒤로 가서 하세요';
  $('lk-hint').classList.remove('strong');
  stopDemo?.();
  stopDemo = playDemo($('lk-demo'), exId(), { color: '#c8f53c' });
  const prog = $('lk-prog');
  prog.style.strokeDasharray = `${C}`;
  setRing();
}

function setRing() {
  const n = ui.count;
  $('lk-count').textContent = n;
  $('lk-cam-count').textContent = n;
  $('lk-prog').style.strokeDashoffset = `${C * (1 - Math.min(1, n / target))}`;
}

let hintTimer = 0;
function flashHint(text, ms = 2200) {
  const h = $('lk-hint');
  h.textContent = text;
  h.classList.add('strong');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    h.classList.remove('strong');
    h.textContent = ui.mode === 'sensor' ? SENSOR_EXERCISES[sensorEx].hint : '폰을 세워 두고 2~3m 뒤로 가서 하세요';
  }, ms);
}

function keepAwake(seconds = 45) {
  FitLock?.keepAwake({ seconds }).catch(() => {});
}

/* ---------- 세기 ---------- */

function onCount(nInMode) {
  if (ui.done) return;
  const n = ui.carried + nInMode;
  if (n <= ui.count) return;
  ui.count = n;
  setRing();
  $('lk-count').classList.remove('pop');
  void $('lk-count').offsetWidth;
  $('lk-count').classList.add('pop');
  if (st.vibrate) buzz(35);
  keepAwake();
  const left = target - n;
  let extra = '';
  if (left === 3 && target >= 8) extra = '세 개 남았어요';
  else if (left === 1) extra = '하나 더';
  else if (left <= 0) extra = '완료!';
  voice.count(n, extra);
  if (n >= target) complete();
  else scheduleHelp();
}

function startSensor() {
  if (!motion) {
    motion = new MotionCounter({
      exercise: sensorEx,
      onRep: (e) => onCount(e.count),
      onEvent: (e) => {
        if (e.type === 'shallow') flashHint('조금 더 깊게 앉아 주세요');
      },
      onNoSensor: () => pass('no-sensor', '움직임 센서를 쓸 수 없어서 그냥 열어요'),
    });
  }
  motion.start();
  cancelAnimationFrame(meterRaf);
  const minD = SENSOR_EXERCISES[sensorEx].minDepth;
  const full = 0.35;
  $('lk-mark').style.left = `${(minD / full) * 100}%`;
  const bar = $('lk-meter');
  const fill = bar.querySelector('i');
  const loop = () => {
    if (!motion?.running) return;
    const d = motion.depthNow;
    fill.style.width = `${Math.min(100, (d / full) * 100)}%`;
    bar.classList.toggle('deep', d >= minD);
    meterRaf = requestAnimationFrame(loop);
  };
  loop();
}

async function startCamera() {
  $('lk-cam').hidden = false;
  $('lk-cam-msg').textContent = '카메라 켜는 중…';
  const { CameraCounter } = await import('./camera-counter.js');
  // 불러오는 사이 화면이 꺼졌거나 다른 방법으로 바꿨으면 켜지 않는다 (카메라는 보일 때만)
  if (!ui.visible || ui.done || ui.mode !== 'camera') return;
  if (!cam) {
    cam = new CameraCounter({
      video: $('lk-video'), canvas: $('lk-skel'), exercise: camEx, gpu: st.gpu !== false,
      onRep: (n) => onCount(n),
      onStatus: (t) => { $('lk-cam-msg').textContent = t; },
      onCue: (t) => { $('lk-cam-msg').textContent = t; },
    });
  }
  keepAwake(90);
  clearInterval(camPing);
  camPing = setInterval(() => keepAwake(60), 30000);
  try {
    await cam.start();
  } catch (e) {
    console.warn('카메라 실패', e);
    cam.stop();
    clearInterval(camPing);
    $('lk-cam').hidden = true;
    if (ui.done) return;
    if (!ui.userSwitched && st.mode === 'camera') {
      pass('no-camera', '카메라를 쓸 수 없어서 그냥 열어요');
    } else {
      toast('카메라를 쓸 수 없어요 — 폰 들고 해 주세요', 3000);
      switchMode('sensor', false);
    }
  }
}

function stopCounting() {
  motion?.stop();
  cancelAnimationFrame(meterRaf);
  cam?.stop();
  clearInterval(camPing);
}

function startCounting() {
  if (ui.done || !ui.visible) return;
  if (ui.mode === 'sensor') startSensor();
  else startCamera();
  keepAwake();
}

function switchMode(mode, byUser = true) {
  if (mode === ui.mode || ui.done) return;
  stopCounting();
  // 다른 방법으로 센 만큼은 이어서 센다
  ui.carried = ui.count;
  if (ui.mode === 'sensor') motion = null;
  else cam = null;
  ui.mode = mode;
  ui.userSwitched = byUser;
  $('lk-cam').hidden = mode !== 'camera';
  renderGoal();
  startCounting();
}

/* ---------- 끝 ---------- */

function saveLog(result) {
  if (!motion || motion.rec.seconds < 3) return;
  saveRecording(motion.rec, {
    exercise: sensorEx, target, counted: motion.count, result,
    reps: motion.counter.reps, events: motion.events, injected: motion.injected,
  });
}

async function complete() {
  if (ui.done) return;
  ui.done = true;
  stopCounting();
  saveLog('success');
  // 앱에서 '잠금화면 보기'(미리 보기)로 한 건 연습으로 친다 (잠금 해제 보너스·미션 없음)
  const kind = ui.kind === 'practice' || ui.info?.reason === 'preview' ? 'practice' : 'unlock';
  const res = updateState((s) => recordSession(s, {
    kind, exercise: exId(), mode: ui.mode, reps: ui.count, target, name: exName(),
  }));
  showDone(res);
  FitLock?.setSummary({ summary: summaryOf(loadState()) }).catch(() => {}); // 상단 알림의 포인트도 바로
  voice.say(kind === 'unlock' ? '완료! 잠금이 열려요' : '완료! 잘했어요', { interrupt: false });
  setTimeout(() => finish('success', { points: res.total }), ui.kind === 'browser' ? 0 : 2000);
}

function showDone(res) {
  $('lk-cam').hidden = true;
  $('lk-done').hidden = false;
  $('lk-done-title').textContent = ui.kind === 'lock' ? '열렸어요!' : '잘했어요!';
  $('lk-done-total').textContent = `+${fmt(res.total)}P`;
  $('lk-done-list').innerHTML = res.gains.map((g) => `<li>${g.label} <b>+${g.pts}P</b></li>`).join('')
    + (res.streak?.extended ? `<li>🔥 연속 ${res.streak.count}일째</li>` : '');
  if (res.levelUp) {
    $('lk-done-lvup').hidden = false;
    $('lk-done-lvup').textContent = `🎉 레벨 업! Lv.${res.levelUp.to} ${levelInfo(loadState().earned).title}`;
  }
  renderHeader();
  coinBurst($('lk-done-total'), $('lk-points'), Math.min(14, 4 + Math.round(res.total / 5)));
}

/** 운동 못 했지만 비켜 줌 (센서·카메라 없음) */
function pass(reason, msg) {
  if (ui.done) return;
  ui.done = true;
  stopCounting();
  updateState((s) => recordPass(s, { reason }));
  $('lk-hint').textContent = msg;
  $('lk-hint').classList.add('strong');
  toast(msg, 3000);
  setTimeout(() => finish('pass', { reason }), 1500);
}

function finish(result, extra = {}) {
  if (ui.kind === 'lock') {
    FitLock.finishLock({ result, reps: ui.count, exercise: exId(), mode: ui.mode, ...extra }).catch(() => {});
  } else if (ui.kind === 'practice') {
    location.replace('index.html#home');
  } else {
    $('lk-done-bar').hidden = result !== 'success';
    if (result !== 'success') setTimeout(() => location.reload(), 1200);
  }
}

/* ---------- 시작 ---------- */

// 오래 안 세지면 도움말 (폰 들고 세기는 아직 실제 폰으로 맞추는 중이라)
let helpTimers = [];
function scheduleHelp() {
  helpTimers.forEach(clearTimeout);
  const at = ui.count;
  helpTimers = [
    setTimeout(() => {
      if (ui.done || !ui.visible || ui.count !== at || ui.mode !== 'sensor') return;
      flashHint('잘 안 세지나요? 폰을 가슴에 꼭 붙이고, 조금 더 깊고 또박또박 앉았다 일어나 보세요', 8000);
    }, 25000),
    setTimeout(() => {
      if (ui.done || !ui.visible || ui.count !== at) return;
      flashHint(ui.kind === 'lock' ? "그래도 안 되면 아래 '급할 때 그냥 열기'를 누르세요 — 설정에서 센서 기록을 보내 주시면 고칠게요" : '카메라(세워 두고)로 바꿔 봐도 돼요', 10000);
    }, 45000),
  ];
}

function setVisible(v) {
  if (v === ui.visible) return;
  ui.visible = v;
  if (v) {
    tick();
    renderHeader();
    startCounting();
    scheduleHelp();
  } else {
    helpTimers.forEach(clearTimeout);
    stopCounting();
  }
}

async function init() {
  tick();
  setInterval(tick, 5000);
  renderHeader();
  if (FitLock) {
    try { ui.info = await FitLock.getInfo(); } catch { ui.info = null; }
  }
  ui.kind = ui.info?.screen === 'lock' ? 'lock' : params.has('practice') ? 'practice' : 'browser';
  if (ui.kind === 'lock') {
    document.documentElement.style.setProperty('--native-bar', `${ui.info.barHeight || 0}px`);
    FitLock.lockReady().catch(() => {});
  } else {
    $('lk-webbar').hidden = false;
    $('lk-web-skip').hidden = ui.kind === 'practice';
    $('lk-web-close').textContent = ui.kind === 'practice' ? '그만하기' : '닫기';
  }
  // 무음·진동 모드면 숫자를 소리 내 읽지 않는다
  voice.enabled = !!st.voice;
  if (FitLock && st.voice) {
    try { voice.enabled = (await FitLock.getRingerMode()).mode === 'normal'; } catch { /* 그대로 */ }
  }
  renderGoal();

  $('lk-mode-sensor').addEventListener('click', () => switchMode('sensor'));
  $('lk-mode-camera').addEventListener('click', () => switchMode('camera'));
  $('lk-cam-back').addEventListener('click', () => switchMode('sensor'));
  $('lk-done-close').addEventListener('click', () => location.reload());
  $('lk-web-close').addEventListener('click', () => {
    stopCounting();
    saveLog('quit');
    if (ui.kind === 'practice') location.replace('index.html#home');
    else location.reload();
  });
  $('lk-web-skip').addEventListener('click', () => { // 브라우저 미리 보기용 (실제 잠금에선 네이티브 버튼)
    stopCounting();
    saveLog('skip');
    const r = updateState((s) => recordSkip(s, { reason: 'button', freeLimit: st.lock.skipsPerDay }));
    toast(r.free ? '건너뛰었어요 (기록 손해 없음)' : '건너뛰었어요 — 기록에 남아요');
    setTimeout(() => location.reload(), 1200);
  });

  window.addEventListener('pagehide', () => { stopCounting(); if (!ui.done) saveLog('leave'); });
  ready = true;
  setVisible(computeVisible());
}

// 보이는지: 안드로이드 잠금 화면은 네이티브가 알려 준다(화면 꺼짐·PIN 화면·다른 화면에 가려짐), 그 밖엔 문서 가시성.
// 시작하는 동안 온 알림도 놓치지 않게 맨 처음에 듣는다.
let ready = false;
let nativeVisible = null;
function computeVisible() {
  if (document.visibilityState === 'hidden') return false;
  if (ui.kind === 'lock') return nativeVisible ?? ui.info?.visible !== false;
  return true;
}
window.addEventListener('fitlock:visible', () => { nativeVisible = true; if (ready) setVisible(computeVisible()); });
window.addEventListener('fitlock:hidden', () => { nativeVisible = false; if (ready) setVisible(computeVisible()); });
document.addEventListener('visibilitychange', () => { if (ready) setVisible(computeVisible()); });

// 자동 점검·개발용: 가짜 센서 값 넣기 (예: __fitlock.inject('squat10'))
window.__fitlock = {
  async inject(name = 'squat10', { realtime = true, speed = 1, seed = 3 } = {}) {
    const { synthMotion, SCENARIOS } = await import('./motion/synth.js');
    if (ui.mode !== 'sensor') switchMode('sensor');
    if (!motion?.running) { ui.visible = true; startSensor(); }
    const { samples } = synthMotion({ seed, ...(SCENARIOS[name] || SCENARIOS.squat10) });
    await motion.inject(samples, { realtime, speed });
    return this.state();
  },
  state() {
    return {
      kind: ui.kind, mode: ui.mode, visible: ui.visible, done: ui.done, count: ui.count, target,
      sensorEvents: motion?.events ?? 0, injected: motion?.injected ?? 0, camFrames: cam?.frames ?? 0,
      camDelegate: cam?.delegate ?? null, camRunning: !!cam?.running, motionRunning: !!motion?.running,
    };
  },
  switchMode,
};

init();
