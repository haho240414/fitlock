// 핏락 앱 화면: 홈(포인트·연속 기록·잠금 상태·오늘의 미션) / 미션(미션·상점) / 기록 / 설정(잠금·시간대·장소·권한).
// 잠금 자체는 네이티브(LockService·LockActivity)가 하고, 이 화면은 설정을 네이티브에 넘긴다(FitLock.setConfig).

import { $, fmt, hhmm, toast, sheet, coinBurst, esc } from './ui.js';
import { FitLock, NativeApp, canShareFile, shareTextFile, downloadText } from './native.js';
import { loadSettings, updateSettings, loadState, updateState, onExternalChange, exportAll, importAll, resetAll } from './store.js';
import {
  levelInfo, streakInfo, weekDots, todaySummary, missionsFor, claimMission, SHOP, THEMES, buy, setTheme,
  recentDays, totals, skipsLeft, ingestNativeEvents, levelThreshold,
} from './rewards.js';
import { SENSOR_EXERCISES } from './motion/rep-sensor.js';
import { listRecordings, exportRecordings, clearRecordings, setTruth } from './sensorlog.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';

const CAM_EXERCISES = ['squat', 'pushup', 'lunge', 'jumpingjack', 'burpee', 'climber', 'situp', 'bridge', 'sidelunge', 'press', 'curl', 'highknees']
  .filter((id) => EXERCISE_BY_ID[id]);
const FREE_OPTIONS = [[0, '매번'], [15, '15분'], [30, '30분'], [60, '1시간'], [120, '2시간'], [180, '3시간'], [-1, '하루 한 번']];
const DAY_NAMES = ['', '월', '화', '수', '목', '금', '토', '일']; // 1=월 … 7=일 (네이티브와 같게)

let tab = 'home';
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
  const sk = streakInfo(s);
  const today = todaySummary(s);
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
        summary: `🪙 ${fmt(s.points)}P · 🔥 ${sk.count}일 · 오늘 ${fmt(today.reps)}개`,
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
    return `<section class="card lockcard"><div class="state">🔒 잠금 미리 보기</div>
      <div class="why">잠금화면은 안드로이드 앱에서 켜져요. 여기선 운동 화면만 해 볼 수 있어요.</div></section>`;
  }
  if (!st.lock.enabled) {
    return `<section class="card lockcard"><div class="row between"><div>
      <div class="state">🔓 잠금 꺼짐</div><div class="why">켜면 화면을 켤 때마다 ${esc(exNameOf(st))} ${st.target}개를 해야 열려요</div></div>
      <button class="btn primary sm" data-action="setup">켜기</button></div></section>`;
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
    <div class="row between"><div class="state">🔒 잠금 켜짐</div><span class="badge ${warns.length ? 'warn' : 'ok'}">${warns.length ? '확인 필요' : '정상'}</span></div>
    <div class="why">${why}</div>
    <div class="why">오늘 건너뛰기 ${today.skips}번 · 기록 손해 없이 ${left}번 더 가능</div>
    ${warns.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('')}
    ${warns.length ? '<button class="btn sm" style="margin-top:10px" data-action="setup">고치기</button>' : ''}
  </section>`;
}

function missionRowHtml(m) {
  const icons = { reps30: '💪', reps60: '💪', reps100: '🏋️', unlock3: '🔓', unlock5: '🔓', morning: '🌅', noskip: '🙅', extra: '➕', camera: '📷', practice: '🏃' };
  const pct = Math.round((m.progress / m.goal) * 100);
  const btn = m.claimed ? '<span class="badge off">받음</span>'
    : m.done ? `<button class="btn coin sm" data-action="claim" data-id="${m.id}">+${m.reward}P 받기</button>`
      : m.failed ? '<span class="badge bad">실패</span>' : `<span class="muted small">+${m.reward}P</span>`;
  return `<div class="mission ${m.claimed ? 'claimed' : ''} ${m.failed ? 'failed' : ''}">
    <div class="ic">${icons[m.id] || '🎯'}</div>
    <div class="grow"><div class="t">${esc(m.title)}</div>
      <div class="row small muted"><span class="num">${m.progress}/${m.goal}</span></div>
      <div class="bar coin"><i style="width:${pct}%"></i></div></div>
    ${btn}</div>`;
}

function renderHome() {
  const s = loadState();
  const lv = levelInfo(s.earned);
  const sk = streakInfo(s);
  const today = todaySummary(s);
  const week = weekDots(s);
  const ms = missionsFor(s);
  return `
  <section class="card hero">
    <div class="muted small">내 포인트</div>
    <div class="pts num"><span id="h-points">${fmt(s.points)}</span><small>P</small></div>
    <div class="today">오늘 +${fmt(today.pts)}P · ${fmt(today.reps)}개 운동</div>
    <div class="lvline"><span>Lv.${lv.level} ${esc(lv.title)}</span><span>Lv.${lv.level + 1}까지 ${fmt(lv.toNext)}P</span></div>
    <div class="bar coin"><i style="width:${Math.round(lv.frac * 100)}%"></i></div>
  </section>
  <section class="card">
    <div class="row between"><h2 style="margin:0">🔥 ${sk.count}일 연속${sk.atRisk ? ' <span class="badge warn">오늘 하면 이어져요</span>' : ''}</h2>
      <span class="muted small">최고 ${sk.best}일${s.inv.freezes ? ` · 보호권 ${s.inv.freezes}장` : ''}</span></div>
    <div class="week">${week.map((d) => `<div>${d.label}<i class="${d.done ? 'done' : d.frozen ? 'frozen' : ''} ${d.today ? 'today' : ''}">${d.done ? '✓' : d.frozen ? '❄' : ''}</i></div>`).join('')}</div>
  </section>
  ${lockCardHtml()}
  <div class="big-actions">
    <button class="btn primary" data-action="practice">💪 지금 운동하기<small>하는 만큼 포인트</small></button>
    <button class="btn" data-action="preview">🔒 잠금화면 보기<small>미리 해 보기</small></button>
  </div>
  <section class="card"><div class="row between"><h2 style="margin:0">오늘의 미션</h2><button class="btn ghost sm" data-tab-go="missions">전체 ›</button></div>
    ${ms.map(missionRowHtml).join('')}</section>`;
}

/* ================= 미션·상점 ================= */

function renderMissions() {
  const s = loadState();
  const lv = levelInfo(s.earned);
  const items = SHOP.map((it) => {
    let own = '';
    if (it.id === 'skip') own = `가진 것 ${s.inv.skipTickets}장`;
    else if (it.id === 'freeze') own = `가진 것 ${s.inv.freezes}장`;
    else if (s.inv.themes.includes(it.id.slice(6))) own = '가지고 있어요';
    const owned = it.id.startsWith('theme:') && s.inv.themes.includes(it.id.slice(6));
    return `<div class="shopitem"><div class="grow"><div class="t" style="font-weight:700">${esc(it.name)}</div>
      <div class="small muted">${esc(it.desc)}</div><div class="small dim">${own}</div></div>
      <button class="btn ${owned ? '' : 'coin'} sm" data-action="buy" data-id="${it.id}" ${owned || s.points < it.price ? 'disabled' : ''}>${owned ? '보유' : `${it.price}P`}</button></div>`;
  }).join('');
  const themes = s.inv.themes.map((th) => `<button class="${s.inv.theme === th ? 'on' : ''}" data-action="theme" data-id="${th}">${THEMES[th] || th}</button>`).join('');
  const ladder = Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
    const t = levelInfo(levelThreshold(n)).title;
    return `<div class="logrow"><span>${n <= lv.level ? '✅' : '⬜'} Lv.${n} ${esc(t)}</span><span class="muted num">${fmt(levelThreshold(n))}P</span></div>`;
  }).join('');
  return `
  <section class="card"><h2>오늘의 미션</h2><p class="small muted" style="margin:-4px 0 6px">날마다 바뀌어요. 다 하면 포인트를 받으세요.</p>
    ${missionsFor(s).map(missionRowHtml).join('')}</section>
  <section class="card"><div class="row between"><h2 style="margin:0">상점</h2><span class="chip coin">🪙 <b>${fmt(s.points)}</b>P</span></div>
    <p class="small muted">포인트는 앱 안에서만 써요 (현금·기프티콘 아님)</p>${items}</section>
  <section class="card"><h2>잠금화면 테마</h2><div class="seg">${themes}</div></section>
  <section class="card"><h2>레벨</h2><p class="small muted" style="margin:-4px 0 6px">지금까지 모은 포인트로 올라가요 (써도 안 내려가요)</p>${ladder}</section>`;
}

/* ================= 기록 ================= */

function renderRecords() {
  const s = loadState();
  const t = totals(s);
  const days = recentDays(s, 14);
  const max = Math.max(10, ...days.map((d) => d.reps));
  const today = days[days.length - 1].key;
  const chart = days.map((d) => `<div class="${d.key === today ? 'today' : ''}" title="${d.key} ${d.reps}개"><i style="height:${Math.round((d.reps / max) * 100)}%"></i>${Number(d.key.slice(8))}</div>`).join('');
  const kindLabel = { unlock: '🔓 잠금 해제', practice: '💪 운동', skip: '⏭️ 건너뜀', pass: '↪️ 그냥 열림', mission: '🎯 미션', buy: '🛒 구매' };
  const passWhy = { call: '전화', 'no-sensor': '센서 없음', 'no-camera': '카메라 못 씀', error: '앱 오류', watchdog: '화면 오류', home: '홈 버튼' };
  const log = [...s.log].reverse().slice(0, 40).map((l) => {
    const d = new Date(l.at);
    let what = kindLabel[l.kind] || l.kind;
    if (l.kind === 'unlock' || l.kind === 'practice') what += ` · ${EXERCISE_BY_ID[l.exercise]?.name || SENSOR_EXERCISES[l.exercise]?.name || l.exercise} ${l.reps}개${l.mode === 'camera' ? ' (카메라)' : ''}`;
    if (l.kind === 'skip') what += l.free ? ' (무료)' : '';
    if (l.kind === 'pass') what += ` (${passWhy[l.reason] || l.reason})`;
    if (l.kind === 'buy') what += ` · ${SHOP.find((x) => x.id === l.id)?.name || l.id}`;
    return `<div class="logrow"><span>${d.getMonth() + 1}/${d.getDate()} ${hhmm(l.at)} ${esc(what)}</span><span class="num ${l.pts > 0 ? '' : 'muted'}">${l.pts > 0 ? '+' : ''}${l.pts || 0}P</span></div>`;
  }).join('') || '<p class="muted">아직 기록이 없어요</p>';
  return `
  <section class="card"><div class="stats">
    <div class="stat"><b class="num">${fmt(t.reps)}</b><span>지금까지 한 개수</span></div>
    <div class="stat"><b class="num">${fmt(t.unlocks)}</b><span>운동으로 연 잠금</span></div>
    <div class="stat"><b class="num">${fmt(t.days)}</b><span>운동한 날</span></div>
    <div class="stat"><b class="num">${fmt(s.streak.best)}</b><span>최장 연속(일)</span></div>
  </div></section>
  <section class="card"><h2>최근 2주</h2><div class="chart">${chart}</div></section>
  <section class="card"><h2>최근 기록</h2>${log}</section>`;
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
  <section class="card"><h2>잠금</h2>
    <div class="field"><div><div class="label">잠금 켜기</div><div class="help">화면을 켜면 운동 화면이 먼저 떠요</div></div>
      <label class="switch"><input type="checkbox" data-action="lock-toggle" ${L.enabled ? 'checked' : ''}><i></i></label></div>
    <div class="field"><div><div class="label">세는 방법</div><div class="help">${st.mode === 'sensor' ? '폰을 가슴에 대고 하면 센서로 세요' : '폰을 2~3m 앞에 세워 두면 카메라로 세요'}</div></div>
      <div class="seg"><button class="${st.mode === 'sensor' ? 'on' : ''}" data-action="mode" data-id="sensor">📱 폰 들고</button><button class="${st.mode === 'camera' ? 'on' : ''}" data-action="mode" data-id="camera">📷 카메라</button></div></div>
    <div class="field"><div><div class="label">운동</div></div>${exSeg}</div>
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
      ${places}<button class="btn sm" data-action="place-add" style="margin-top:8px" ${FitLock ? '' : 'disabled'}>📍 지금 있는 곳 추가</button>
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
  const s = loadState();
  const lv = levelInfo(s.earned);
  $('top-level').innerHTML = `Lv.<b>${lv.level}</b> ${esc(lv.title)}`;
  const views = { home: renderHome, missions: renderMissions, records: renderRecords, settings: renderSettings };
  $('view').innerHTML = (views[tab] || renderHome)();
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
}

function go(t) {
  tab = t;
  if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`);
  render();
  window.scrollTo(0, 0);
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
  const row = (ok, title, help, action, btn) => `<div class="perm"><div class="grow"><div style="font-weight:700">${ok ? '✅' : '⬜'} ${title}</div><div class="help">${help}</div></div>
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
          title: '잠금이 켜졌어요 🎉',
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
    case 'setup': return openSetup();
    case 'practice': location.href = 'lock.html?practice=1'; return;
    case 'preview':
      if (FitLock) await FitLock.previewLock().catch((e) => toast(`미리 보기를 못 띄웠어요: ${e.message || e}`));
      else location.href = 'lock.html';
      return;
    case 'claim': {
      const r = updateState((s) => claimMission(s, id));
      if (!r.ok) { toast(r.error); return; }
      const from = el;
      render();
      coinBurst(from, $('h-points') || $('top-level'));
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
    case 'lock-toggle':
      if (el.checked) { el.checked = false; return openSetup(); }
      return changeSettings((s) => { s.lock.enabled = false; });
    case 'mode':
      await changeSettings((s) => { s.mode = id; });
      if (id === 'camera' && FitLock && status && !status.camera) await permAction('perm-camera');
      return;
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
  if (g) { go(g.dataset.tabGo); return; }
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
  tab = (location.hash || '#home').slice(1) || 'home';
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
      if (open) { open.remove(); return; }
      if (tab !== 'home') { go('home'); return; }
      NativeApp.minimizeApp?.().catch(() => NativeApp.exitApp());
    });
  }
  setInterval(() => { if (tab === 'home' && document.visibilityState === 'visible') refreshStatus().then(render); }, 30000);
}

window.__fitlockApp = { refreshAll, syncNative, status: () => status, info: () => info, openSetup, go };

init();
