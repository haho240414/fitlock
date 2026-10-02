// 핏락 앱 화면: 홈(포인트·연속 기록·잠금 상태·오늘의 미션) / 미션(미션·상점) / 기록 / 설정(잠금·시간대·장소·권한).
// 잠금 자체는 네이티브(LockService·LockActivity)가 하고, 이 화면은 설정을 네이티브에 넘긴다(FitLock.setConfig).

import { $, fmt, hhmm, toast, sheet, coinBurst, esc } from './ui.js';
import { icon, mountIcons } from './icons.js';
import { FitLock, NativeApp, canShareFile, shareTextFile, downloadText } from './native.js';
import { loadSettings, updateSettings, loadState, updateState, onExternalChange, exportAll, importAll, resetAll } from './store.js';
import {
  levelInfo, streakInfo, weekDots, todaySummary, missionsFor, claimMission, SHOP, THEMES, buy, setTheme,
  skipsLeft, ingestNativeEvents, levelThreshold, summaryOf, dayKey,
} from './rewards.js';
import { activityReport } from './activity.js';
import { SENSOR_EXERCISES } from './motion/rep-sensor.js';
import { listRecordings, exportRecordings, clearRecordings, setTruth } from './sensorlog.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';
import { openCamera } from './camera.js';
import { cameraOptions, autoCamera, toSetting, describe } from './camera-pick.js';

const CAM_EXERCISES = ['squat', 'pushup', 'lunge', 'jumpingjack', 'burpee', 'climber', 'situp', 'bridge', 'sidelunge', 'press', 'curl', 'highknees']
  .filter((id) => EXERCISE_BY_ID[id]);
const FREE_OPTIONS = [[0, '매번'], [15, '15분'], [30, '30분'], [60, '1시간'], [120, '2시간'], [180, '3시간'], [-1, '하루 한 번']];
const DAY_NAMES = ['', '월', '화', '수', '목', '금', '토', '일']; // 1=월 … 7=일 (네이티브와 같게)
const TAB_IDS = ['home', 'missions', 'records', 'settings'];
const tabFromHash = () => {
  const id = location.hash.slice(1);
  return TAB_IDS.includes(id) ? id : 'home';
};

let tab = 'home';
let missionView = 'missions';
let recordsRange = 'week';
let status = null;   // 네이티브 상태 (FitLock.getStatus)
let info = null;     // 기기 정보 (FitLock.getInfo)

const exNameOf = (st) => (st.mode === 'camera' ? EXERCISE_BY_ID[st.camExercise]?.name || '스쿼트' : SENSOR_EXERCISES[st.exercise]?.name || '스쿼트');
const freeLabel = (m) => (FREE_OPTIONS.find(([v]) => v === m) || [0, `${m}분`])[1];

/* ================= 네이티브와 주고받기 ================= */

async function refreshStatus() {
  if (!FitLock) return null;
  try { status = await FitLock.getStatus(); } catch (e) { console.warn(e); }
  return status;
}

/** 잠금 설정·요약을 네이티브(서비스·알림)에 넘긴다 */
async function syncNative() {
  if (!FitLock) return;
  const st = loadSettings();
  const s = loadState();
  try {
    await FitLock.setConfig({
      config: {
        enabled: !!st.lock.enabled,
        freeMinutes: st.lock.freeMinutes,
        skipsPerDay: st.lock.skipsPerDay,
        skipTickets: s.inv.skipTickets,
        schedule: st.lock.schedule,
        places: st.lock.places,
        target: st.target,
        exerciseName: exNameOf(st),
        summary: summaryOf(s),
      },
    });
  } catch (e) { console.warn('setConfig', e); }
}

/** 잠금 화면 네이티브 버튼(급할 때 그냥 열기·홈 버튼·전화·자동 통과) 기록을 받아 반영 */
async function drainNative() {
  if (!FitLock) return;
  try {
    const { events } = await FitLock.drainEvents();
    if (events?.length) {
      const st = loadSettings();
      updateState((s) => ingestNativeEvents(s, events, { freeLimit: st.lock.skipsPerDay }));
    }
  } catch (e) { console.warn('drainEvents', e); }
}

/* ================= 홈 ================= */

function lockCardHtml() {
  const st = loadSettings();
  const s = loadState();
  const left = skipsLeft(s, st.lock.skipsPerDay);
  const today = todaySummary(s);
  if (!FitLock) {
    return '';
  }
  if (!st.lock.enabled) {
    return `<section class="lockcard status-row">${icon('unlock')}<div class="grow">
      <div class="state">운동 잠금이 꺼져 있어요</div><div class="why">${esc(exNameOf(st))} ${st.target}개로 만드는 작은 습관</div></div>
      <button class="btn primary sm" data-action="setup">켜기</button></section>`;
  }
  const warns = [];
  if (status && !status.overlay) warns.push("'다른 앱 위에 표시'가 꺼져 있어 잠금이 안 떠요");
  if (status && status.enabled && !status.serviceRunning) warns.push('잠금 서비스가 멈춰 있어요');
  if (status && !status.battery) warns.push('배터리 절전 때문에 잠금이 가끔 안 뜰 수 있어요');
  let why = `화면을 켜면 ${esc(exNameOf(st))} ${st.target}개 · 한 번 하면 ${freeLabel(st.lock.freeMinutes)} 자유`;
  const d = status?.decision;
  if (d?.reason === 'free' && d.until) why = `지금은 자유 시간 — ${hhmm(d.until)}부터 다시 잠겨요`;
  else if (d?.reason === 'schedule') why = '지금은 잠금 쉬는 시간대예요';
  else if (d?.reason === 'place') why = '정한 장소가 아니라 잠금 쉬는 중이에요';
  else if (d?.reason === 'place-unknown') why = '위치를 몰라서 잠금 쉬는 중이에요 (모르면 열어 둬요)';
  return `<section class="card lockcard">
    <div class="row between"><div class="state">${icon('lock')} 운동 잠금 켜짐</div><span class="badge ${warns.length ? 'warn' : 'ok'}">${warns.length ? '확인 필요' : '정상'}</span></div>
    <div class="why">${why}</div>
    <div class="why">오늘 건너뛰기 ${today.skips}번 · 기록 손해 없이 ${left}번 더 가능</div>
    ${warns.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
    ${warns.length ? '<button class="btn sm" style="margin-top:10px" data-action="setup">고치기</button>' : ''}
    ${d?.reason === 'free' ? '<button class="btn ghost sm" style="margin-top:8px" data-action="relock">자유 시간 끝내고 다시 잠그기</button>' : ''}
  </section>`;
}

function missionRowHtml(m) {
  const titles = { reps30: '30회 운동하기', reps60: '60회 운동하기', reps100: '100회 운동하기', unlock3: '잠금 3번 열기', unlock5: '잠금 5번 열기', morning: '아침 9시 전 운동', noskip: '건너뛰기 없이 잠금 2번 열기', extra: '목표보다 5회 더 하기', camera: '카메라로 1번 운동', practice: '연습 운동 1번' };
  const glyph = m.id.startsWith('reps') || m.id === 'extra' || m.id === 'practice' ? 'workout'
    : m.id === 'camera' ? 'camera' : m.id === 'morning' ? 'sun' : 'unlock';
  const btn = m.claimed ? `<span class="mission-received">${icon('check')} 받았어요</span>`
    : m.done ? `<button class="btn coin sm" data-action="claim" data-id="${m.id}">+${m.reward}P 받기</button>`
      : m.failed ? '<span class="mission-received">다음에 도전</span>' : `<span class="reward-amount num">+${m.reward}P</span>`;
  const pct = Math.min(100, Math.round(m.progress / m.goal * 100));
  return `<div class="mission ${m.claimed ? 'claimed' : ''} ${m.failed ? 'failed' : ''}">
    <div class="ic mission-${glyph}" aria-hidden="true">${icon(m.claimed ? 'check' : glyph)}</div>
    <div class="grow"><div class="t" title="${esc(m.title)}">${esc(titles[m.id] || m.title)}</div>
      <div class="bar mission-meter" role="progressbar" aria-label="${esc(m.title)}" aria-valuenow="${m.progress}" aria-valuemin="0" aria-valuemax="${m.goal}"><i style="width:${pct}%"></i></div>
      <div class="mission-progress num">${m.claimed ? '보상을 받았어요' : m.done ? '완료했어요' : m.failed ? '내일 새로운 미션이 기다려요' : `${m.progress} / ${m.goal}`}</div></div>
    ${btn}</div>`;
}

function sortedMissions(s) {
  const rank = (m) => m.claimed ? 3 : m.failed ? 2 : m.done ? 0 : 1;
  return missionsFor(s).sort((a, b) => rank(a) - rank(b));
}

function progressRing(pct, content, label, cls = '') {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="dashboard-ring ${cls}" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="42"/><circle class="progress" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - p}"/></svg><div>${content}</div></div>`;
}

function growthCard(s, { week = false, interactive = true } = {}) {
  const lv = levelInfo(s.earned), sk = streakInfo(s);
  const tag = interactive ? 'button' : 'div';
  return `<section class="card growth-card" aria-label="나의 성장"><div class="growth-heading"><${tag} class="growth-link" ${interactive ? 'data-action="growth" aria-label="나의 성장과 레벨 보기"' : ''}><span class="growth-symbol">${icon('sprout')}</span><span class="grow"><strong>${esc(lv.title)} · Lv.${lv.level}</strong><span>다음 레벨까지 ${fmt(lv.toNext)}P</span></span>${interactive ? icon('chevron') : ''}</${tag}><span class="streak-label">${sk.count}일 연속</span></div>
    <div class="bar growth-progress" role="progressbar" aria-label="다음 레벨까지의 진행" aria-valuenow="${Math.round(lv.frac * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(lv.frac * 100)}%"></i></div>
    ${week ? `<div class="week">${weekDots(s).map((d) => `<div aria-label="${d.label}요일${d.today ? ', 오늘' : ''}: ${d.done ? '운동 완료' : d.frozen ? '보호권 사용' : '운동 전'}">${d.label}<i class="${d.done ? 'done' : d.frozen ? 'frozen' : ''} ${d.today ? 'today' : ''}">${d.done ? icon('check') : d.frozen ? icon('shield') : ''}</i></div>`).join('')}</div>` : ''}</section>`;
}

function renderHome() {
  const s = loadState();
  const st = loadSettings();
  const today = todaySummary(s);
  const ms = sortedMissions(s);
  const repMission = ms.find((m) => m.id.startsWith('reps'));
  const goal = repMission?.goal || st.target;
  const progress = repMission?.progress || 0;
  const pct = Math.min(100, Math.round(progress / goal * 100));
  const goalText = repMission?.claimed ? '오늘의 운동 미션 완료!'
    : repMission?.done ? `운동 목표 달성! +${repMission.reward}P 받으세요`
      : repMission ? `${goal - progress}회 더 하면 +${repMission.reward}P` : '오늘도 한 세트로 시작해요';
  return `<section class="card daily-card" aria-label="오늘의 운동과 포인트"><h1>오늘도 가볍게, 한 세트</h1>
    <div class="daily-overview"><div class="grow"><p class="daily-target">오늘 목표 ${goal}회</p><div class="daily-count num">${fmt(today.reps)}<small>회</small></div><p class="daily-reward">${goalText}</p></div>
    ${progressRing(pct, `<strong class="num">${pct}<small>%</small></strong>`, `오늘 운동 목표 ${goal}회 중 ${progress}회, ${pct}%`)}</div>
    <button class="btn block workout-primary" data-action="practice">${esc(exNameOf(st))} ${st.target}회 시작 ${icon('chevron')}</button>
    <div class="workout-options"><span>${icon(st.mode === 'camera' ? 'camera' : 'phone')} ${st.mode === 'camera' ? '카메라' : '폰 들고'} · 목표 ${st.target}회</span><button class="btn sm" data-action="preview">${icon('lock')} 잠금화면 보기 ${icon('chevron')}</button></div></section>
  <button class="wallet-strip" data-tab-go="missions">${icon('reward')}<span class="grow"><span>내 포인트</span><strong class="num"><b id="h-points">${fmt(s.points)}</b><small>P</small></strong></span>${icon('chevron')}</button>
  ${lockCardHtml()}
  ${growthCard(s, { week: true })}
  <section class="home-missions"><div class="section-heading"><h2>오늘의 미션</h2><button class="btn ghost sm" data-tab-go="missions">전체 보기 ${icon('chevron')}</button></div><div class="card mission-list">${ms.map(missionRowHtml).join('')}</div></section>`;
}

/* ================= 미션·상점 ================= */

function shopRowHtml(it, s) {
  const owned = it.id.startsWith('theme:') && s.inv.themes.includes(it.id.slice(6));
  const qty = it.id === 'skip' ? s.inv.skipTickets : s.inv.freezes;
  const limited = !it.id.startsWith('theme:') && qty >= it.max;
  const glyph = it.id === 'skip' ? 'skip' : it.id === 'freeze' ? 'shield' : 'leaf';
  const short = it.id === 'skip' ? '급할 때 기록 손해 없이 건너뛰어요' : '쉬어 가는 날에도 연속 기록을 지켜요';
  return `<div class="shopitem"><span class="shop-symbol ${it.id === 'freeze' ? 'rose' : ''}">${icon(glyph)}</span><div class="grow"><div class="t">${esc(it.name)}</div><div class="small muted">${esc(short)}</div><div class="small muted">보유 ${qty}장${!owned && !limited && s.points < it.price ? ` · ${fmt(it.price - s.points)}P 더 필요해요` : ''}</div></div><button class="btn coin sm" data-action="buy" data-id="${it.id}" ${owned || limited || s.points < it.price ? 'disabled' : ''}>${owned ? '보유' : limited ? '보유 한도' : `${it.price}P`}</button></div>`;
}

function renderMissions() {
  const s = loadState(), lv = levelInfo(s.earned);
  const themes = SHOP.filter((it) => it.id.startsWith('theme:')).map((it) => {
    const th = it.id.slice(6), owned = s.inv.themes.includes(th), on = s.inv.theme === th;
    return `<button class="theme-tile theme-${th} ${on ? 'on' : ''}" data-action="${owned ? 'theme' : 'buy'}" data-id="${owned ? th : it.id}" ${!owned && s.points < it.price ? 'disabled' : ''} aria-pressed="${on}">${icon(th === 'sunset' ? 'sun' : 'leaf')}<strong>${THEMES[th]}</strong><span>${on ? '사용 중' : owned ? '선택하기' : `${it.price}P`}</span></button>`;
  }).join('');
  const shop = `<section class="card rewards-shop"><h2>나를 위한 보상</h2>${SHOP.filter((it) => !it.id.startsWith('theme:')).map((it) => shopRowHtml(it, s)).join('')}
    ${missionView === 'shop' ? `<h3>잠금화면 테마</h3><div class="theme-tiles">${themes}</div><button class="btn block sm basic-theme" data-action="theme" data-id="basic">기본 테마 ${s.inv.theme === 'basic' ? '사용 중' : '선택하기'}</button>` : '<button class="btn block shop-more" data-action="mission-view" data-id="shop">테마와 모든 보상 보기 '+icon('chevron')+'</button>'}
    <p class="shop-note">포인트는 핏락 안에서만 사용해요</p></section>`;
  return `<div class="page-intro"><h1>미션과 보상</h1><p>작은 움직임을 나를 위한 보상으로</p></div>
    <section class="card points-summary"><div><span>내 포인트</span><strong class="num">${fmt(s.points)}<small>P</small></strong><p>오늘 +${fmt(todaySummary(s).pts)}P</p></div>${progressRing(lv.frac * 100, icon('sprout'), `Lv.${lv.level}, 다음 레벨까지 ${lv.toNext}P`, 'leaf-ring')}</section>
    <div class="seg page-seg" role="group" aria-label="미션과 상점"><button class="${missionView === 'missions' ? 'on' : ''}" data-action="mission-view" data-id="missions" aria-pressed="${missionView === 'missions'}">오늘의 미션</button><button class="${missionView === 'shop' ? 'on' : ''}" data-action="mission-view" data-id="shop" aria-pressed="${missionView === 'shop'}">포인트 상점</button></div>
    ${missionView === 'missions' ? `<section class="card mission-list">${sortedMissions(s).map(missionRowHtml).join('')}</section>` : ''}${shop}
    <button class="card growth-shortcut" data-action="growth">${icon('chart')}<span class="grow">내 성장 보기<small>지금까지의 꾸준함을 확인하세요</small></span>${icon('chevron')}</button>`;
}

/* ================= 기록 ================= */

function renderRecords() {
  const s = loadState();
  const report = activityReport(s, { range: recordsRange });
  const sk = streakInfo(s);
  const max = Math.max(10, ...report.chart.map((d) => d.reps));
  const peak = report.chart.findLast((d) => d.reps > 0)?.key;
  const chart = report.chart.map((d, i) => `<div class="activity-column ${d.today ? 'today' : ''} ${d.key === peak ? 'latest' : ''} ${d.future ? 'future' : ''}" aria-label="${d.key}: ${d.future ? '아직 오지 않은 날' : `${d.reps}회`}"><div class="plot"><i style="height:${Math.round(d.reps / max * 100)}%">${!d.future ? `<span>${fmt(d.reps)}</span>` : ''}</i></div><span class="day-label">${recordsRange === 'week' ? '월화수목금토일'[i] : Number(d.key.slice(8))}</span></div>`).join('');
  const comparison = report.previous.reps === 0 ? report.week.reps > 0 ? '이번 주의 첫 움직임을 쌓고 있어요' : '첫 운동으로 이번 주를 시작해요'
    : report.delta === 0 ? '지난주 같은 요일까지와 같아요' : `지난주 같은 요일까지보다 ${fmt(Math.abs(report.delta))}회 ${report.delta > 0 ? '더 했어요' : '적어요'}`;
  const exerciseRows = report.exercises.map((e) => `<button class="exercise-row" data-action="exercise-record" data-id="${esc(e.id)}"><span class="shop-symbol">${icon('workout')}</span><span class="grow"><strong>${esc(exerciseName(e.id))}</strong><span class="bar"><i style="width:${e.pct}%"></i></span></span><span class="exercise-value"><b class="num">${fmt(e.reps)}회</b><small>${e.pct}%</small></span>${icon('chevron')}</button>`).join('');
  const kindLabel = { unlock: '잠금 해제', practice: '운동', skip: '건너뜀', pass: '그냥 열림', mission: '미션', buy: '구매' };
  const passWhy = { call: '전화', 'no-sensor': '센서 없음', 'no-camera': '카메라 못 씀', error: '앱 오류', watchdog: '화면 오류', home: '홈 버튼' };
  const log = [...s.log].reverse().slice(0, 40).map((l) => {
    const d = new Date(l.at);
    let what = kindLabel[l.kind] || l.kind;
    if (l.kind === 'unlock' || l.kind === 'practice') what += ` · ${EXERCISE_BY_ID[l.exercise]?.name || SENSOR_EXERCISES[l.exercise]?.name || l.exercise} ${l.reps}개${l.mode === 'camera' ? ' (카메라)' : ''}`;
    if (l.kind === 'skip') what += l.free ? ' (무료)' : '';
    if (l.kind === 'pass') what += ` (${passWhy[l.reason] || l.reason})`;
    if (l.kind === 'buy') what += ` · ${SHOP.find((x) => x.id === l.id)?.name || l.id}`;
    return `<div class="activity-row"><span class="activity-symbol">${icon(l.kind === 'unlock' ? 'unlock' : l.kind === 'mission' ? 'gift' : l.kind === 'buy' ? 'bag' : l.kind === 'skip' ? 'skip' : 'workout')}</span><span class="grow"><small>${d.getMonth() + 1}/${d.getDate()} ${hhmm(l.at)}</small><strong>${esc(what)}</strong></span><span class="num activity-points ${l.pts > 0 ? 'earned' : ''}">${l.pts > 0 ? '+' : ''}${l.pts || 0}P</span></div>`;
  }).join('') || `<div class="empty-state">${icon('chart')}<p>첫 움직임을 기다리고 있어요.</p><p class="small">한 세트만 해도 오늘의 기록이 생겨요.</p><button class="btn primary" data-action="practice">운동 시작하기</button></div>`;
  return `
  <div class="page-intro"><h1>나의 운동 기록</h1><p>꾸준히 움직인 만큼 쌓이는 변화</p></div>
  <section class="card weekly-summary"><div class="weekly-overview"><div class="grow"><h2>이번 주</h2><strong class="weekly-count num">${fmt(report.week.reps)}<small>회</small></strong><p>${comparison}</p></div>${progressRing(report.week.days / 7 * 100, `<strong>${report.week.days}<small>일</small></strong><span>이번 주</span>`, `이번 주 7일 중 ${report.week.days}일 운동`)}</div><div class="weekly-stats"><div><span>운동한 날</span><strong>${report.week.days}<small>일</small></strong></div><div><span>잠금 해제</span><strong>${report.week.unlocks}<small>번</small></strong></div><div><span>연속 기록</span><strong>${sk.count}<small>일</small></strong></div></div></section>
  <section class="card activity-chart-card"><div class="seg page-seg" role="group" aria-label="기록 기간"><button class="${recordsRange === 'week' ? 'on' : ''}" data-action="record-range" data-id="week">이번 주</button><button class="${recordsRange === 'fortnight' ? 'on' : ''}" data-action="record-range" data-id="fortnight">최근 2주</button></div><div class="row between"><h2>하루 운동량</h2><span class="small muted">(회)</span></div><div class="activity-chart ${recordsRange === 'fortnight' ? 'fortnight' : ''}">${chart}</div><p class="chart-note">${recordsRange === 'week' ? '월요일부터 오늘까지의 운동을 보여줘요' : '오늘을 포함한 최근 14일의 운동을 보여줘요'}</p></section>
  <section class="card exercise-summary"><h2>운동별 기록</h2><p class="small muted">${recordsRange === 'week' ? '이번 주' : '최근 2주'}</p>${exerciseRows || '<p class="small muted">첫 운동을 하면 종류별 기록이 쌓여요</p>'}</section>
  <section class="card"><h2>최근 활동</h2>${log}</section>`;
}

const exerciseName = (id) => EXERCISE_BY_ID[id]?.name || SENSOR_EXERCISES[id]?.name || id;

function openGrowth() {
  const s = loadState(), lv = levelInfo(s.earned), sk = streakInfo(s);
  const ladder = Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<div class="logrow"><span>${icon(n <= lv.level ? 'check' : 'lock')} Lv.${n} ${esc(levelInfo(levelThreshold(n)).title)}</span><span class="muted num">${fmt(levelThreshold(n))}P</span></div>`).join('');
  sheet({ title: '나의 성장', html: `${growthCard(s, { interactive: false })}<p>누적 ${fmt(s.earned)}P · 최장 ${sk.best}일 연속<br>포인트를 써도 레벨은 내려가지 않아요.</p>${ladder}`, actions: [{ label: '좋아요, 계속 움직여요', cls: 'primary' }] });
}

function openExerciseRecord(id) {
  const s = loadState(), r = activityReport(s, { range: recordsRange });
  const item = r.exercises.find((e) => e.id === id);
  if (!item) return;
  const logs = [...s.log].reverse().filter((l) => ['unlock', 'practice'].includes(l.kind) && l.exercise === id && dayKey(l.at) >= r.periodStart && dayKey(l.at) <= r.today).slice(0, 20);
  sheet({ title: `${exerciseName(id)} 기록`, html: `<p>${recordsRange === 'week' ? '이번 주' : '최근 2주'} <b>${fmt(item.reps)}회</b></p>${logs.map((l) => `<div class="logrow"><span>${dayKey(l.at).slice(5)} ${hhmm(l.at)} · ${l.mode === 'camera' ? '카메라' : '폰 들고'}</span><b>${fmt(l.reps)}회</b></div>`).join('') || '<p>이 기간의 상세 활동 내역은 남아 있지 않아요.</p>'}`, actions: [{ label: '닫기', cls: 'primary' }] });
}

/* ================= 설정 ================= */

function permRow(label, help, ok, action, btn = '설정') {
  const badge = ok === true ? '<span class="badge ok">켜짐</span>' : ok === false ? '<span class="badge bad">꺼짐</span>' : '<span class="badge off">—</span>';
  return `<div class="perm"><div class="grow"><div style="font-weight:700">${label}</div><div class="help">${help}</div></div>${badge}
    ${ok === false && action ? `<button class="btn sm" data-action="${action}">${btn}</button>` : ''}</div>`;
}

function renderSettings() {
  const st = loadSettings();
  const L = st.lock;
  const sw = (key, on) => `<label class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></label>`;
  const exSeg = st.mode === 'sensor'
    ? `<div class="seg">${Object.values(SENSOR_EXERCISES).map((e) => `<button class="${st.exercise === e.id ? 'on' : ''}" data-action="exercise" data-id="${e.id}">${e.name}</button>`).join('')}</div>`
    : `<select data-set="camExercise">${CAM_EXERCISES.map((id) => `<option value="${id}" ${st.camExercise === id ? 'selected' : ''}>${EXERCISE_BY_ID[id].name}${EXERCISE_BY_ID[id].verified ? '' : ' (베타)'}</option>`).join('')}</select>`;
  const windows = L.schedule.windows.map((w, i) => `<div class="window-row">
      <div class="days">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<button class="${w.days.includes(d) ? 'on' : ''}" data-action="win-day" data-i="${i}" data-d="${d}">${DAY_NAMES[d]}</button>`).join('')}</div>
      <input type="time" value="${w.start}" data-win="${i}" data-k="start"> ~ <input type="time" value="${w.end}" data-win="${i}" data-k="end">
      ${L.schedule.windows.length > 1 ? `<button class="btn ghost sm danger" data-action="win-del" data-i="${i}">삭제</button>` : ''}</div>`).join('');
  const places = L.places.list.map((p, i) => `<div class="window-row"><div class="grow"><b>${esc(p.name)}</b>
      <div class="small muted">${p.lat != null ? `반경 ${p.radius}m` : ''}${p.ssid ? `${p.lat != null ? ' · ' : ''}와이파이 ${esc(p.ssid)}` : ''}</div></div>
      <button class="btn ghost sm danger" data-action="place-del" data-i="${i}">삭제</button></div>`).join('') || '<p class="small muted">아직 장소가 없어요</p>';
  const S = status || {};
  const sdk = info?.sdk || 0;
  const recs = listRecordings();
  return `
  <div class="page-intro"><h1>설정</h1><p>내게 맞는 운동과 잠금 방식을 선택하세요.</p></div>
  <section class="card"><h2>운동 잠금</h2>
    <div class="field"><div><div class="label">잠금 켜기</div><div class="help">화면을 켜면 운동 화면이 먼저 떠요</div></div>
      <label class="switch"><input type="checkbox" data-action="lock-toggle" ${L.enabled ? 'checked' : ''}><i></i></label></div>
    <div class="field mode-field"><div><div class="label">세는 방법</div><div class="help">${st.mode === 'sensor' ? '폰을 가슴에 대고 하면 센서로 세요' : '폰을 2~3m 앞에 세워 두면 카메라로 세요'}</div></div>
      <div class="seg"><button class="${st.mode === 'sensor' ? 'on' : ''}" data-action="mode" data-id="sensor">${icon('phone')} 폰 들고</button><button class="${st.mode === 'camera' ? 'on' : ''}" data-action="mode" data-id="camera">${icon('camera')} 카메라</button></div></div>
    <div class="field"><div><div class="label">운동</div></div>${exSeg}</div>
    ${st.mode === 'camera' ? `<div class="field"><div><div class="label">카메라</div><div class="help">${esc(describe(st.camera))}</div></div>
      <button class="btn sm" data-action="camera-pick">바꾸기</button></div>` : ''}
    <div class="field"><div><div class="label">목표 횟수</div></div>
      <div class="stepper"><button data-action="target" data-d="-1">−</button><output class="num">${st.target}</output><button data-action="target" data-d="1">+</button></div></div>
    <div class="field"><div><div class="label">한 번 하면 자유</div><div class="help">운동하고 나면 이 시간 동안은 그냥 열려요</div></div>
      <select data-set="lock.freeMinutes">${FREE_OPTIONS.map(([v, l]) => `<option value="${v}" ${L.freeMinutes === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><div><div class="label">무료 건너뛰기 (하루)</div><div class="help">이만큼은 기록 손해 없이 '급할 때 그냥 열기'</div></div>
      <div class="stepper"><button data-action="skips" data-d="-1">−</button><output class="num">${L.skipsPerDay}</output><button data-action="skips" data-d="1">+</button></div></div>
  </section>

  <section class="card"><div class="row between"><h2 style="margin:0">시간대</h2>${sw('lock.schedule.enabled', L.schedule.enabled)}</div>
    <p class="small muted">켜 두면 이 시간에만 잠가요. 끄면 언제나 잠가요.</p>
    ${L.schedule.enabled ? `${windows}<button class="btn sm" data-action="win-add" style="margin-top:8px">+ 시간대 추가</button>` : ''}
  </section>

  <section class="card"><div class="row between"><h2 style="margin:0">장소</h2>${sw('lock.places.enabled', L.places.enabled)}</div>
    <p class="small muted">집처럼 정한 곳에서만 잠그거나, 정한 곳에선 안 잠글 수 있어요. 위치는 이 폰 안에서만 써요.</p>
    ${L.places.enabled ? `<div class="seg" style="margin:6px 0 4px"><button class="${L.places.mode === 'only' ? 'on' : ''}" data-action="place-mode" data-id="only">이곳에서만 잠금</button><button class="${L.places.mode === 'except' ? 'on' : ''}" data-action="place-mode" data-id="except">이곳에선 잠금 안 함</button></div>
      ${places}<button class="btn sm" data-action="place-add" style="margin-top:8px" ${FitLock ? '' : 'disabled'}>${icon('pin')} 지금 있는 곳 추가</button>
      <p class="small dim">위치를 모를 땐(꺼짐·실내 등) 잠그지 않아요.</p>` : ''}
  </section>

  <section class="card"><h2>소리·진동</h2>
    <div class="field"><div><div class="label">숫자 음성</div><div class="help">무음·진동 모드에선 저절로 꺼져요</div></div>${sw('voice', st.voice)}</div>
    <div class="field"><div><div class="label">셀 때마다 진동</div></div>${sw('vibrate', st.vibrate)}</div>
    <div class="field"><div><div class="label">카메라 AI 가속(GPU)</div><div class="help">카메라 모드가 멈추면 끄세요</div></div>${sw('gpu', st.gpu)}</div>
  </section>

  <section class="card"><h2>권한·상태</h2>
    ${FitLock ? `
      ${sdk >= 33 ? permRow('알림', '상단에 오늘 기록·잠금 상태를 보여줘요', S.notifications, 'perm-notifications', '허용') : ''}
      ${permRow('다른 앱 위에 표시', '잠금화면 위에 운동 화면을 띄우는 데 꼭 필요해요', S.overlay, 'perm-overlay')}
      ${permRow('배터리 제한 없음', '폰이 핏락을 멈추지 않게 해요', S.battery, 'perm-battery', '허용')}
      ${permRow('카메라', '카메라 모드에서만 써요', S.camera, 'perm-camera', '허용')}
      ${L.places.enabled ? permRow('위치 (항상 허용)', '화면이 꺼져 있을 때도 장소를 확인해요', S.backgroundLocation, 'perm-location', '허용') : ''}
      <div class="perm"><div class="grow"><div style="font-weight:700">잠금 서비스</div><div class="help">${S.serviceRunning ? '돌아가는 중' : '멈춤'}${S.keyguardSecure === false ? ' · 이 폰엔 화면 잠금(PIN·패턴)이 없어요' : ''}</div></div>
        <span class="badge ${S.serviceRunning ? 'ok' : 'off'}">${S.serviceRunning ? '켜짐' : '꺼짐'}</span></div>
      ${!S.overlay && sdk >= 35 ? `<p class="notice">안드로이드 15 이상에선 직접 받은 앱(APK)의 '다른 앱 위에 표시'가 막혀 있을 수 있어요:
        <b>설정 → 애플리케이션 → 핏락 → 오른쪽 위 ⋮ → 제한된 설정 허용</b> 을 누른 뒤 다시 켜 주세요.</p>
        <button class="btn sm" data-action="open-app">앱 정보 열기</button>` : ''}
    ` : '<p class="muted">안드로이드 앱에서 확인할 수 있어요</p>'}
  </section>

  <section class="card"><h2>센서 기록 보내기</h2>
    <p class="small muted">'폰 들고' 세기를 사용자님 폰에 맞추는 데 써요. 최근 도전 ${recs.length}번의 움직임 값(영상 아님)이 이 폰에만 있고,
      아래 버튼을 눌러야만 파일로 나가요. 실제로 한 개수를 적어 주면 더 정확히 맞출 수 있어요.</p>
    ${recs.slice().reverse().map((r) => `<div class="window-row"><div class="grow small">${new Date(r.at).getMonth() + 1}/${new Date(r.at).getDate()} ${hhmm(r.at)} · ${SENSOR_EXERCISES[r.exercise]?.name || r.exercise}
      앱이 센 개수 <b>${r.counted}</b> · ${Math.round(r.n / 60)}초</div>
      <label class="small muted">실제 <input type="number" min="0" max="200" style="width:64px" value="${r.truth ?? ''}" placeholder="${r.counted}" data-truth="${r.id}">개</label></div>`).join('')}
    <div class="row" style="margin-top:8px"><button class="btn sm" data-action="send-log" ${recs.length ? '' : 'disabled'}>보내기</button>
      <button class="btn ghost sm danger" data-action="clear-log" ${recs.length ? '' : 'disabled'}>지우기</button></div>
  </section>

  <section class="card"><h2>데이터</h2>
    <div class="row" style="flex-wrap:wrap"><button class="btn sm" data-action="backup">백업 파일 저장</button>
      <button class="btn sm" data-action="restore">백업 불러오기</button>
      <button class="btn ghost sm danger" data-action="reset">처음부터</button></div>
  </section>

  <section class="card"><h2>알아 둘 것</h2>
    <p class="notice"><b>보안 잠금이 아니에요.</b> 폰의 PIN·지문 잠금은 그대로 쓰세요. 핏락은 그 위에 운동 화면을 하나 더 띄울 뿐이고,
      '급할 때 그냥 열기'·긴급 전화·홈 버튼으로 언제든 나갈 수 있어요. 전화가 오면 바로 비켜요.</p>
    <p class="notice">카메라는 운동 화면에서 '카메라'를 고를 때만 켜지고, 영상은 저장하거나 어디로 보내지 않아요. 위치도 이 폰 안에서만 써요. 서버가 없어요.</p>
    <p class="notice">카메라 운동 인식은 <b>핸즈프리 PT</b> 엔진을 그대로 써요. '폰 들고' 세기는 아직 실제 폰으로 맞추는 중이에요 — 틀리면 센서 기록을 보내 주세요.</p>
    <p class="small dim">${info ? `핏락 ${esc(info.version || '')} · 안드로이드 ${esc(info.release || '')} (API ${sdk}) · ${esc(info.manufacturer || '')} ${esc(info.model || '')}` : '브라우저 미리 보기'}</p>
  </section>`;
}

/* ================= 그리기·전환 ================= */

function render() {
  const active = document.activeElement;
  const focusData = active?.closest('#view') ? { ...active.dataset } : null;
  const s = loadState();
  const lv = levelInfo(s.earned);
  $('top-level').innerHTML = `Lv.<b>${lv.level}</b> ${icon('chevron')}`;
  $('top-level').setAttribute('aria-label', `나의 성장 보기, Lv.${lv.level} ${lv.title}`);
  const views = { home: renderHome, missions: renderMissions, records: renderRecords, settings: renderSettings };
  $('view').innerHTML = (views[tab] || renderHome)();
  document.body.dataset.view = tab;
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.toggle('on', b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  mountIcons();
  // Keep controls usable with keyboard and screen readers after a settings redraw.
  for (const field of document.querySelectorAll('.field')) {
    const label = field.querySelector('.label')?.textContent;
    if (label) for (const input of field.querySelectorAll('input, select')) input.setAttribute('aria-label', label);
  }
  for (const input of document.querySelectorAll('.switch input:not([aria-label])')) {
    const heading = input.closest('.card')?.querySelector('h2')?.textContent;
    if (heading) input.setAttribute('aria-label', `${heading} 사용`);
  }
  for (const b of document.querySelectorAll('.seg button, .days button')) b.setAttribute('aria-pressed', String(b.classList.contains('on')));
  for (const b of document.querySelectorAll('.stepper button')) {
    const label = b.closest('.field')?.querySelector('.label')?.textContent || '횟수';
    b.setAttribute('aria-label', `${label} ${Number(b.dataset.d) > 0 ? '늘리기' : '줄이기'}`);
  }
  for (const select of document.querySelectorAll('input[data-win]')) select.setAttribute('aria-label', `시간대 ${Number(select.dataset.win) + 1} ${select.dataset.k === 'start' ? '시작' : '종료'}`);
  if (focusData && Object.keys(focusData).length) {
    const replacement = [...$('view').querySelectorAll('button, input, select')].find((el) => Object.entries(focusData).every(([k, v]) => el.dataset[k] === v));
    (replacement || $('view')).focus({ preventScroll: true });
  }
}

function go(t) {
  tab = TAB_IDS.includes(t) ? t : 'home';
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
  window.scrollTo(0, 0);
  $('view').focus({ preventScroll: true });
}

/* ================= 설정 바꾸기 ================= */

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks[ks.length - 1]] = val;
}

async function changeSettings(fn, { sync = true } = {}) {
  updateSettings(fn);
  render();
  if (sync) await syncNative();
}

/* ================= 카메라 고르기 ================= */

let pickerList = [];
let previewStream = null;
function stopPreview() {
  previewStream?.getTracks().forEach((t) => t.stop());
  previewStream = null;
}

async function ensureCameraPermission() {
  if (!FitLock) return true;
  await refreshStatus();
  if (status?.camera) return true;
  const r = await FitLock.requestPermissions({ permissions: ['camera'] }).catch(() => null);
  await refreshStatus();
  return r?.camera === 'granted' || !!status?.camera;
}

/** 카메라 모드로 바꿀 때: 아직 고른 게 없으면 가장 넓은 전면 카메라로 (후면이 훨씬 넓으면 알려 준다) */
async function autoPickCamera() {
  if (loadSettings().camera) return;
  if (!(await ensureCameraPermission())) return;
  let list;
  try { list = await cameraOptions(); } catch { return; }
  const c = autoCamera(list);
  if (!c) return;
  await changeSettings((s) => { s.camera = { ...toSetting(c), auto: true }; });
  const backWide = list.find((x) => x.facing === 'environment' && x.fovLong && c.fovLong && x.fovLong - c.fovLong > 15);
  toast(backWide
    ? `${describe(toSetting(c))} — 후면 ${Math.round(backWide.fovLong)}° 카메라는 더 가까이 둬도 돼요 ('바꾸기')`
    : `${describe(toSetting(c))}`, 5000);
}

async function openCameraPicker() {
  if (!(await ensureCameraPermission())) { toast('카메라 권한이 있어야 고를 수 있어요'); return; }
  toast('카메라를 살펴보는 중…', 3000);
  try { pickerList = await cameraOptions(); } catch { toast('카메라 목록을 못 읽었어요'); return; }
  if (!pickerList.length) { toast('쓸 수 있는 카메라가 없어요'); return; }
  const cur = loadSettings().camera?.deviceId;
  const rows = pickerList.map((c) => `<div class="cam-row ${c.deviceId === cur ? 'on' : ''}">
      <div class="grow"><div class="t">${esc(c.name)}${c.wide ? ' <span class="badge ok">넓음</span>' : ''}${c.deviceId === cur ? icon('check') : ''}</div>
        <div class="help">${c.fovLong ? `시야 ${Math.round(c.fovLong)}° · 폰을 허리 높이에 두면 약 ${c.distance}m` : '시야 정보 없음'}${c.facing === 'environment' ? ' · 화면이 반대쪽이라 소리로 세요' : ''}</div></div>
      <button class="btn sm" data-action="cam-preview" data-id="${esc(c.deviceId)}">보기</button>
      <button class="btn sm primary" data-action="cam-pick" data-id="${esc(c.deviceId)}">고르기</button></div>`).join('');
  sheet({
    title: '어느 카메라로 셀까요?',
    html: `<p>시야가 넓을수록 가까이 둬도 전신이 들어와요. '보기'로 얼마나 넓게 보이는지 확인해 보세요.
      (폰을 바닥에 두면 거리가 1.5~2배 필요해요 — 의자·선반처럼 허리 높이가 좋아요)</p>
      <div class="cam-prev"><video id="cp-video" playsinline muted></video><span id="cp-label">'보기'를 누르세요</span></div>${rows}`,
    actions: [
      { label: '자동 (가장 넓은 전면)', onClick: () => pickCamera(null) },
      { label: '닫기', cls: 'ghost' },
    ],
    onClose: stopPreview,
  });
}

async function previewCamera(deviceId) {
  stopPreview();
  const c = pickerList.find((x) => x.deviceId === deviceId);
  const v = document.getElementById('cp-video');
  if (!v) return;
  try {
    const stream = await openCamera({ cameraWide: true, cameraId: deviceId });
    if (!document.getElementById('cp-video')) { stream.getTracks().forEach((t) => t.stop()); return; } // 그사이 창이 닫힘
    previewStream = stream;
    v.srcObject = stream;
    v.classList.toggle('mirror', c?.facing !== 'environment');
    await v.play().catch(() => {});
    document.getElementById('cp-label').textContent = describe(toSetting(c));
  } catch {
    toast('이 카메라는 지금 열 수 없어요');
  }
}

async function pickCamera(deviceId) {
  stopPreview();
  const c = deviceId ? pickerList.find((x) => x.deviceId === deviceId) : autoCamera(pickerList);
  document.querySelector('.sheet-back')?._close?.();
  await changeSettings((s) => { s.camera = c ? { ...toSetting(c), auto: !deviceId } : null; });
  if (c?.facing === 'environment') {
    sheet({
      title: '후면 카메라로 할 때',
      html: `<p>폰 <b>뒷면(카메라)이 나를 보게</b> 세워 두세요. 화면은 반대쪽이라 몇 개 했는지는 <b>소리</b>로 알려 줘요.</p>
        <p class="small">무음·진동 모드면 소리가 안 나요. 잠금 화면 아래 버튼('급할 때 그냥 열기')은 그대로 있어요.</p>`,
      actions: [{ label: '알겠어요', cls: 'primary' }],
    });
  } else toast(`카메라: ${describe(toSetting(c))}`);
}

/* ================= 잠금 켜기(권한 안내) ================= */

function notSecuritySheet() {
  return new Promise((resolve) => {
    sheet({
      title: '먼저 알아 두세요',
      html: `<p>핏락은 <b>운동 습관용 잠금</b>이에요. 보안 잠금이 아니에요.</p>
        <ol><li>폰의 PIN·지문 잠금은 그대로 두세요. 핏락은 그 위에 운동 화면을 하나 더 띄워요.</li>
        <li>'급할 때 그냥 열기'와 긴급 전화 버튼이 언제나 있어요. 하루 ${loadSettings().lock.skipsPerDay}번까지는 기록 손해도 없어요.</li>
        <li>전화가 오면 바로 비켜요. 센서·카메라를 못 쓰면 그냥 열려요.</li>
        <li>카메라는 운동 화면이 떠 있을 때만 켜지고, 영상은 어디에도 저장·전송하지 않아요.</li></ol>`,
      actions: [
        { label: '알겠어요', cls: 'primary', onClick: () => { updateSettings((s) => { s.ackNotSecurity = true; }); resolve(true); } },
        { label: '그만두기', cls: 'ghost', onClick: () => resolve(false) },
      ],
      dismissable: false,
    });
  });
}

let setupClose = null;
function setupHtml() {
  const S = status || {};
  const st = loadSettings();
  const sdk = info?.sdk || 0;
  const row = (ok, title, help, action, btn) => `<div class="perm"><div class="grow"><div style="font-weight:700">${icon(ok ? 'check' : 'lock')} ${title}</div><div class="help">${help}</div></div>
    ${ok ? '' : `<button class="btn sm ${action === 'perm-overlay' ? 'primary' : ''}" data-setup="${action}">${btn}</button>`}</div>`;
  return `${row(S.overlay, '다른 앱 위에 표시 (꼭 필요)', '잠금화면 위에 운동 화면을 띄워요. 목록에서 핏락을 찾아 켜 주세요.', 'perm-overlay', '설정 열기')}
    ${!S.overlay && sdk >= 35 ? `<p class="notice">켜는 스위치가 회색이라 안 눌리면: <b>앱 정보 → 오른쪽 위 ⋮ → 제한된 설정 허용</b> 후 다시 켜 주세요
      (안드로이드 15+ 에서 직접 받은 앱은 이렇게 한 번 풀어야 해요). <button class="btn sm" data-setup="open-app">앱 정보 열기</button></p>` : ''}
    ${sdk >= 33 ? row(S.notifications, '알림', '오늘 기록·잠금 상태를 알림에 보여줘요 (꺼도 잠금은 돼요)', 'perm-notifications', '허용') : ''}
    ${row(S.battery, '배터리 제한 없음 (권장)', '삼성 등은 절전 때문에 핏락을 멈출 수 있어요', 'perm-battery', '허용')}
    ${st.mode === 'camera' ? row(S.camera, '카메라', '카메라 모드에서만 써요', 'perm-camera', '허용') : ''}`;
}

async function openSetup() {
  if (!FitLock) { toast('안드로이드 앱에서 켤 수 있어요'); return; }
  if (!loadSettings().ackNotSecurity && !(await notSecuritySheet())) return;
  await refreshStatus();
  setupClose?.();
  setupClose = sheet({
    title: '잠금 켜기',
    html: `<p>아래를 켜면 화면을 켤 때 운동 화면이 떠요.</p><div id="setup-rows">${setupHtml()}</div>`,
    actions: [
      { label: '잠금 켜기', cls: 'primary', id: 'setup-go', onClick: async () => {
        await refreshStatus();
        if (!status?.overlay) { toast("'다른 앱 위에 표시'를 먼저 켜 주세요"); return false; }
        await changeSettings((s) => { s.lock.enabled = true; });
        await refreshStatus();
        render();
        sheet({
          title: '잠금이 켜졌어요',
          html: '<p>화면을 껐다가 다시 켜 보세요. 운동 화면이 먼저 떠요.</p><p class="small">처음엔 \'잠금화면 보기\'로 미리 해 봐도 좋아요.</p>',
          actions: [{ label: '잠금화면 미리 보기', cls: 'primary', onClick: () => FitLock.previewLock().catch(() => {}) }, { label: '닫기', cls: 'ghost' }],
        });
        return true;
      } },
      { label: '나중에', cls: 'ghost' },
    ],
  });
}

async function refreshSetup() {
  const el = document.getElementById('setup-rows');
  if (!el) return;
  await refreshStatus();
  el.innerHTML = setupHtml();
}

async function permAction(a) {
  if (!FitLock) return;
  try {
    if (a === 'perm-overlay') await FitLock.openSettings({ target: 'overlay' });
    else if (a === 'open-app') await FitLock.openSettings({ target: 'app' });
    else if (a === 'perm-battery') await FitLock.requestBatteryExemption();
    else if (a === 'perm-notifications') await FitLock.requestPermissions({ permissions: ['notifications'] });
    else if (a === 'perm-camera') await FitLock.requestPermissions({ permissions: ['camera'] });
    else if (a === 'perm-location') await requestLocation(true);
  } catch (e) { console.warn(a, e); }
  await refreshStatus();
  await refreshSetup();
  render();
}

async function requestLocation(background) {
  let r = await FitLock.requestPermissions({ permissions: ['location'] });
  if (r.location !== 'granted') { toast('위치 권한이 있어야 장소를 쓸 수 있어요'); return false; }
  if (background) {
    await new Promise((resolve) => sheet({
      title: "위치를 '항상 허용'으로",
      html: '<p>화면이 꺼져 있을 때도 지금 장소를 확인하려면 위치 권한을 <b>항상 허용</b>으로 바꿔야 해요.</p><p class="small">다음 화면에서 <b>항상 허용</b>을 골라 주세요. 위치는 이 폰 안에서만 써요.</p>',
      actions: [{ label: '다음', cls: 'primary', onClick: resolve }, { label: '나중에', cls: 'ghost', onClick: resolve }],
    }));
    r = await FitLock.requestPermissions({ permissions: ['backgroundLocation'] });
  }
  return true;
}

async function addPlace() {
  if (!(await requestLocation(false))) return;
  toast('지금 위치를 찾는 중…', 4000);
  let p;
  try { p = await FitLock.getPlace(); } catch (e) { toast(`위치를 못 찾았어요 (${e.message || e})`); return; }
  if (p.lat == null && !p.ssid) { toast('위치를 못 찾았어요. 위치(GPS)가 켜져 있는지 확인해 주세요'); return; }
  const n = loadSettings().lock.places.list.length;
  sheet({
    title: '이 장소 저장',
    html: `<div class="field"><div class="label">이름</div><input type="text" id="pl-name" value="${n ? `장소 ${n + 1}` : '집'}" maxlength="12"></div>
      ${p.lat != null ? `<div class="field"><div><div class="label">반경</div><div class="help">위치 정확도 약 ${Math.round(p.accuracy || 0)}m</div></div>
        <select id="pl-radius">${[100, 150, 300, 500].map((r) => `<option value="${r}" ${r === 150 ? 'selected' : ''}>${r}m</option>`).join('')}</select></div>` : ''}
      ${p.ssid ? `<div class="field"><div><div class="label">와이파이로도 확인</div><div class="help">${esc(p.ssid)} 에 연결돼 있으면 이 장소로 봐요</div></div>
        <label class="switch"><input type="checkbox" id="pl-wifi" checked><i></i></label></div>` : ''}`,
    actions: [
      { label: '저장', cls: 'primary', onClick: async () => {
        const name = ($('pl-name').value || '장소').trim().slice(0, 12);
        const radius = Number($('pl-radius')?.value || 150);
        const place = { id: Date.now().toString(36), name, lat: p.lat ?? null, lng: p.lng ?? null, radius, ssid: $('pl-wifi')?.checked ? p.ssid : null };
        await changeSettings((s) => { s.lock.places.list.push(place); });
        await refreshStatus();
        if (!status?.backgroundLocation) await requestLocation(true);
        await refreshStatus();
        render();
      } },
      { label: '취소', cls: 'ghost' },
    ],
  });
}

/* ================= 버튼 처리 ================= */

async function onAction(el) {
  const a = el.dataset.action;
  const id = el.dataset.id;
  switch (a) {
    case 'growth': return openGrowth();
    case 'mission-view': missionView = id === 'shop' ? 'shop' : 'missions'; render(); return;
    case 'record-range': recordsRange = id === 'fortnight' ? 'fortnight' : 'week'; render(); return;
    case 'exercise-record': return openExerciseRecord(id);
    case 'setup': return openSetup();
    case 'practice': location.href = 'lock.html?practice=1'; return;
    case 'preview':
      if (FitLock) await FitLock.previewLock().catch((e) => toast(`미리 보기를 못 띄웠어요: ${e.message || e}`));
      else location.href = 'lock.html';
      return;
    case 'claim': {
      const r = updateState((s) => claimMission(s, id));
      if (!r.ok) { toast(r.error); return; }
      coinBurst(el, $('h-points') || $('top-level'));
      render();
      toast(`+${r.pts}P 받았어요${r.levelUp ? ` · 레벨 업! Lv.${r.levelUp.to}` : ''}`);
      syncNative();
      return;
    }
    case 'buy': {
      const item = SHOP.find((x) => x.id === id);
      sheet({
        title: `${item.name} 사기`, html: `<p>${esc(item.desc)}</p><p><b>${item.price}P</b>를 써요.</p>`,
        actions: [{ label: `${item.price}P 쓰기`, cls: 'coin', onClick: () => {
          const r = updateState((s) => buy(s, id));
          toast(r.ok ? `${item.name}을(를) 샀어요` : r.error);
          render();
          syncNative();
        } }, { label: '취소', cls: 'ghost' }],
      });
      return;
    }
    case 'theme': updateState((s) => setTheme(s, id)); render(); toast(`잠금화면 테마: ${THEMES[id]}`); return;
    case 'relock':
      await FitLock?.relock().catch(() => {});
      await refreshStatus();
      render();
      toast('다음에 화면을 켜면 다시 잠겨요');
      return;
    case 'lock-toggle':
      if (el.checked) { el.checked = false; return openSetup(); }
      return changeSettings((s) => { s.lock.enabled = false; });
    case 'mode':
      await changeSettings((s) => { s.mode = id; });
      if (id === 'camera') await autoPickCamera();
      return;
    case 'camera-pick': return openCameraPicker();
    case 'cam-preview': return previewCamera(id);
    case 'cam-pick': return pickCamera(id);
    case 'exercise': return changeSettings((s) => { s.exercise = id; });
    case 'target': return changeSettings((s) => { s.target = Math.max(3, Math.min(50, s.target + Number(el.dataset.d))); });
    case 'skips': return changeSettings((s) => { s.lock.skipsPerDay = Math.max(0, Math.min(5, s.lock.skipsPerDay + Number(el.dataset.d))); });
    case 'win-day': return changeSettings((s) => {
      const w = s.lock.schedule.windows[Number(el.dataset.i)];
      const d = Number(el.dataset.d);
      w.days = w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort();
    });
    case 'win-add': return changeSettings((s) => { s.lock.schedule.windows.push({ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }); });
    case 'win-del': return changeSettings((s) => { s.lock.schedule.windows.splice(Number(el.dataset.i), 1); });
    case 'place-mode': return changeSettings((s) => { s.lock.places.mode = id; });
    case 'place-add': return addPlace();
    case 'place-del': return changeSettings((s) => { s.lock.places.list.splice(Number(el.dataset.i), 1); });
    case 'perm-overlay': case 'perm-battery': case 'perm-notifications': case 'perm-camera': case 'perm-location': case 'open-app':
      return permAction(a);
    case 'send-log': {
      const text = exportRecordings(info ? { model: info.model, manufacturer: info.manufacturer, sdk: info.sdk, version: info.version } : {});
      const name = `fitlock-sensor-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
      if (canShareFile) await shareTextFile(name, text, '핏락 센서 기록').catch((e) => toast(`보내기 실패: ${e.message || e}`));
      else downloadText(name, text);
      return;
    }
    case 'clear-log':
      sheet({ title: '센서 기록 지우기', html: '<p>이 폰에 남은 센서 기록을 지울까요?</p>', actions: [
        { label: '지우기', cls: 'danger', onClick: () => { clearRecordings(); render(); } }, { label: '취소', cls: 'ghost' }] });
      return;
    case 'backup': {
      const name = `fitlock-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (canShareFile) await shareTextFile(name, exportAll()).catch((e) => toast(`저장 실패: ${e.message || e}`));
      else downloadText(name, exportAll());
      return;
    }
    case 'restore': $('import-file').click(); return;
    case 'reset':
      sheet({ title: '처음부터 하기', html: '<p>포인트·기록·설정을 모두 지울까요? 되돌릴 수 없어요.</p>', actions: [
        { label: '모두 지우기', cls: 'danger', onClick: async () => { resetAll(); await syncNative(); render(); toast('지웠어요'); } },
        { label: '취소', cls: 'ghost' }] });
      return;
    default:
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { go(t.dataset.tab); return; }
  const g = e.target.closest('[data-tab-go]');
  if (g) { e.preventDefault(); go(g.dataset.tabGo); return; }
  const s = e.target.closest('[data-setup]');
  if (s) { permAction(s.dataset.setup); return; }
  const a = e.target.closest('[data-action]');
  if (a && a.tagName !== 'INPUT') onAction(a);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'lock-toggle') { onAction(el); return; }
  if (el.dataset.set) {
    const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && /^-?\d+$/.test(el.value) ? Number(el.value) : el.value;
    changeSettings((s) => setPath(s, el.dataset.set, v));
    return;
  }
  if (el.dataset.win != null) {
    const v = el.value;
    if (/^\d\d:\d\d$/.test(v)) changeSettings((s) => { s.lock.schedule.windows[Number(el.dataset.win)][el.dataset.k] = v; });
    return;
  }
  if (el.dataset.truth) setTruth(el.dataset.truth, el.value === '' ? null : Number(el.value));
});
$('import-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    importAll(await f.text());
    await syncNative();
    render();
    toast('불러왔어요');
  } catch (err) { toast(err.message || '불러오지 못했어요'); }
  e.target.value = '';
});

/* ================= 시작 ================= */

async function refreshAll() {
  await drainNative();
  await refreshStatus();
  await syncNative();
  render();
  refreshSetup();
}

async function init() {
  tab = tabFromHash();
  render();
  if (FitLock) {
    try { info = await FitLock.getInfo(); } catch { info = null; }
  }
  await refreshAll();
  onExternalChange(() => render());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
  if (NativeApp) {
    NativeApp.addListener('resume', () => refreshAll());
    NativeApp.addListener('backButton', () => {
      const open = document.querySelector('.sheet-back');
      if (open) { (open._close || (() => open.remove()))(); return; }
      if (tab !== 'home') { go('home'); return; }
      NativeApp.minimizeApp?.().catch(() => NativeApp.exitApp());
    });
  }
  setInterval(() => { if (tab === 'home' && document.visibilityState === 'visible') refreshStatus().then(render); }, 30000);
}

window.addEventListener('hashchange', () => {
  const next = tabFromHash();
  if (next !== tab) go(next);
});

window.__fitlockApp = { refreshAll, syncNative, status: () => status, info: () => info, openSetup, go, FitLock };

init();
