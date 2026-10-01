// 캐시워크 느낌의 '적립되는 재미': 포인트·출석·연속 기록·레벨·오늘의 미션·상점 (앱 안 가상 포인트).
// 순수 계산 — 상태(state) 객체를 받아 고치고 결과를 돌려준다. 저장은 store.js 가 한다.
// 실제 현금·기프티콘은 광고 SDK·사업자·약관이 필요해서 지금은 하지 않는다.

export const POINTS = {
  perRep: 1,        // 1회당
  unlockBonus: 5,   // 운동으로 잠금을 열 때마다
  attendance: 10,   // 그날 첫 운동(출석)
};

// 연속 기록 달성 보너스
export const STREAK_BONUS = { 3: 20, 7: 50, 14: 100, 30: 300, 50: 500, 100: 1000 };

const TITLES = ['새싹', '운동 입문', '꾸준러', '허벅지 단련생', '스쿼트 장인', '철벽 하체', '운동 중독', '핏 마스터', '레전드', '핏락 신'];

export const SHOP = [
  { id: 'skip', name: '건너뛰기권', price: 50, max: 5, desc: '오늘 무료 건너뛰기를 다 쓴 뒤에 한 번 더 기록 없이 넘겨요' },
  { id: 'freeze', name: '연속 기록 보호권', price: 150, max: 2, desc: '운동을 못 한 날, 연속 기록이 끊기지 않게 하루를 지켜 줘요' },
  { id: 'theme:ocean', name: '바다 테마', price: 200, desc: '잠금화면 색을 시원한 바다색으로' },
  { id: 'theme:sunset', name: '노을 테마', price: 200, desc: '잠금화면 색을 따뜻한 노을색으로' },
  { id: 'theme:forest', name: '숲 테마', price: 300, desc: '잠금화면 색을 차분한 숲색으로' },
];

export const THEMES = { basic: '기본', ocean: '바다', sunset: '노을', forest: '숲' };

const totalReps = (d) => Object.values(d.reps || {}).reduce((a, b) => a + b, 0);

// 오늘의 미션 후보. metric(그날 기록) → 진행 값
export const MISSIONS = [
  { id: 'reps30', group: 'reps', title: '오늘 30개 하기', goal: 30, reward: 20, metric: totalReps },
  { id: 'reps60', group: 'reps', title: '오늘 60개 하기', goal: 60, reward: 40, metric: totalReps },
  { id: 'reps100', group: 'reps', title: '오늘 100개 하기', goal: 100, reward: 70, metric: totalReps },
  { id: 'unlock3', title: '운동으로 잠금 3번 열기', goal: 3, reward: 20, metric: (d) => d.unlocks || 0 },
  { id: 'unlock5', title: '운동으로 잠금 5번 열기', goal: 5, reward: 35, metric: (d) => d.unlocks || 0 },
  { id: 'morning', title: '아침 9시 전에 한 번 운동하기', goal: 1, reward: 20, metric: (d) => (d.morning ? 1 : 0) },
  { id: 'noskip', title: '건너뛰지 않고 잠금 2번 열기', goal: 2, reward: 25, metric: (d) => (d.skips ? 0 : d.unlocks || 0), failed: (d) => !!d.skips },
  { id: 'extra', title: '한 번에 목표보다 5개 더 하기', goal: 1, reward: 15, metric: (d) => (d.extra ? 1 : 0) },
  { id: 'camera', title: '카메라 모드로 한 번 하기', goal: 1, reward: 20, metric: (d) => d.camera || 0 },
  { id: 'practice', title: '잠금이 아닐 때 스스로 한 번 운동하기', goal: 1, reward: 15, metric: (d) => d.practice || 0 },
];
const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

/* ---------- 날짜 ---------- */

const pad = (n) => String(n).padStart(2, '0');
/** 이 기기 시간대의 날짜 'YYYY-MM-DD' */
export function dayKey(at = Date.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return dayKey(dt.getTime());
}
export function daysBetween(a, b) { // b - a (일)
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/* ---------- 상태 ---------- */

export function emptyState() {
  return {
    v: 1,
    points: 0,     // 지금 가진 포인트
    earned: 0,     // 지금까지 모은 포인트 (레벨 기준, 써도 안 줄어듦)
    days: {},      // 'YYYY-MM-DD' → 그날 기록
    streak: { count: 0, last: null, best: 0, frozen: [] },
    inv: { skipTickets: 0, freezes: 0, themes: ['basic'], theme: 'basic' },
    log: [],       // 최근 기록 (최대 300)
    ingested: [],  // 네이티브에서 받아 반영한 이벤트 id (중복 방지)
  };
}

/** 저장된 값이 깨졌거나 예전 모양이어도 쓸 수 있게 채운다 */
export function normalize(s) {
  const e = emptyState();
  if (!s || typeof s !== 'object') return e;
  return {
    ...e, ...s,
    streak: { ...e.streak, ...(s.streak || {}) },
    inv: { ...e.inv, ...(s.inv || {}) },
    days: s.days && typeof s.days === 'object' ? s.days : {},
    log: Array.isArray(s.log) ? s.log : [],
    ingested: Array.isArray(s.ingested) ? s.ingested : [],
  };
}

const blankDay = () => ({ reps: {}, sessions: 0, unlocks: 0, practice: 0, camera: 0, skips: 0, freeSkips: 0, pts: 0, claimed: [] });
export function dayOf(state, key) {
  return { ...blankDay(), ...(state.days[key] || {}) };
}
function ensureDay(state, key) {
  state.days[key] = dayOf(state, key);
  return state.days[key];
}

function pushLog(state, entry) {
  state.log.push(entry);
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

function addPoints(state, key, pts) {
  state.points += pts;
  state.earned += pts;
  ensureDay(state, key).pts += pts;
}

/* ---------- 레벨 ---------- */

/** n 레벨이 되는 데 필요한 누적 포인트: 0, 100, 300, 600, 1000, 1500 … */
export const levelThreshold = (n) => 50 * n * (n - 1);

export function levelInfo(earned) {
  let level = 1;
  while (earned >= levelThreshold(level + 1)) level++;
  const cur = levelThreshold(level);
  const next = levelThreshold(level + 1);
  return {
    level, title: TITLES[Math.min(level, TITLES.length) - 1],
    cur, next, frac: (earned - cur) / (next - cur), toNext: next - earned,
  };
}

/* ---------- 연속 기록 ---------- */

/** 오늘 기준 연속 기록 상태. alive = 오늘 했거나 어제까지 이어짐 */
export function streakInfo(state, today = dayKey()) {
  const s = state.streak;
  if (!s.last) return { count: 0, best: s.best || 0, doneToday: false, alive: false, atRisk: false };
  const gap = daysBetween(s.last, today);
  const doneToday = gap === 0;
  const alive = gap <= 1 || gap - 1 <= state.inv.freezes; // 놓친 날을 보호권으로 지킬 수 있으면 살아 있음
  return { count: alive ? s.count : 0, best: s.best || 0, doneToday, alive, atRisk: alive && !doneToday };
}

function extendStreak(state, key) {
  const s = state.streak;
  const res = { before: s.count, count: s.count, extended: false, frozeDays: 0, bonus: 0 };
  if (s.last === key) return res;
  const gap = s.last ? daysBetween(s.last, key) : null;
  if (gap == null || gap < 0) s.count = 1;
  else if (gap === 1) s.count += 1;
  else {
    const missed = gap - 1;
    if (missed <= state.inv.freezes) { // 보호권으로 놓친 날을 메운다
      state.inv.freezes -= missed;
      for (let i = 1; i <= missed; i++) s.frozen.push(addDays(s.last, i));
      s.frozen = s.frozen.slice(-30);
      s.count += 1;
      res.frozeDays = missed;
    } else s.count = 1;
  }
  s.last = key;
  s.best = Math.max(s.best || 0, s.count);
  res.count = s.count;
  res.extended = true;
  res.bonus = STREAK_BONUS[s.count] || 0;
  return res;
}

/* ---------- 운동 기록 ---------- */

/**
 * 운동 한 번 기록 (잠금 해제 또는 스스로 연습).
 * @param {{kind:'unlock'|'practice', exercise:string, mode:'sensor'|'camera', reps:number, target?:number, at?:number}} s
 * @returns {{gains:{label:string,pts:number}[], total:number, levelUp:{from:number,to:number}|null, streak:object, day:object}}
 */
export function recordSession(state, { kind = 'unlock', exercise = 'squat', mode = 'sensor', reps = 0, target = 0, at = Date.now(), name = '' }) {
  const key = dayKey(at);
  reps = Math.max(0, Math.round(reps) || 0);
  if (!reps) { // 하나도 못 했으면 기록만 (출석·연속 기록은 실제로 한 운동만)
    pushLog(state, { at, kind, exercise, mode, reps: 0, target, pts: 0 });
    return { gains: [], total: 0, levelUp: null, streak: { count: state.streak.count, extended: false, bonus: 0 }, day: dayOf(state, key) };
  }
  const d = ensureDay(state, key);
  const before = levelInfo(state.earned).level;
  const gains = [];
  const firstToday = d.sessions === 0;
  d.reps = { ...d.reps, [exercise]: (d.reps[exercise] || 0) + reps };
  d.sessions += 1;
  if (kind === 'unlock') d.unlocks += 1;
  else d.practice += 1;
  if (mode === 'camera') d.camera += 1;
  const h = new Date(at).getHours();
  if (h < 9) d.morning = true;
  if (target && reps >= target + 5) d.extra = true;
  if (!d.firstAt) d.firstAt = `${pad(h)}:${pad(new Date(at).getMinutes())}`;

  gains.push({ label: `${name || '운동'} ${reps}개`, pts: reps * POINTS.perRep });
  if (kind === 'unlock' && reps >= target) gains.push({ label: '운동으로 잠금 해제', pts: POINTS.unlockBonus });
  if (firstToday) gains.push({ label: '오늘 첫 운동 (출석)', pts: POINTS.attendance });
  const streak = extendStreak(state, key);
  if (streak.bonus) gains.push({ label: `${streak.count}일 연속 달성`, pts: streak.bonus });

  const total = gains.reduce((a, g) => a + g.pts, 0);
  addPoints(state, key, total);
  pushLog(state, { at, kind, exercise, mode, reps, target, pts: total });
  const after = levelInfo(state.earned).level;
  return { gains, total, levelUp: after > before ? { from: before, to: after } : null, streak, day: d };
}

/**
 * 건너뛰기 기록. 그날 무료 횟수(freeLimit) 안이면 '무료', 넘으면 건너뛰기권이 있으면 그걸 쓰고,
 * 없으면 그냥 '건너뜀'으로만 남는다 (열리는 건 언제나 열린다 — 사람을 가두지 않는다).
 * @returns {{free:boolean, ticketUsed:boolean, used:number}}
 */
export function recordSkip(state, { at = Date.now(), reason = 'button', freeLimit = 3 } = {}) {
  const key = dayKey(at);
  const d = ensureDay(state, key);
  d.skips += 1;
  let free = d.freeSkips < freeLimit;
  let ticketUsed = false;
  if (!free && state.inv.skipTickets > 0) {
    state.inv.skipTickets -= 1;
    free = true;
    ticketUsed = true;
  }
  if (free) d.freeSkips += 1;
  pushLog(state, { at, kind: 'skip', reason, free, ticketUsed, pts: 0 });
  return { free, ticketUsed, used: d.skips };
}

/** 남은 무료 건너뛰기 (건너뛰기권 포함) */
export function skipsLeft(state, freeLimit = 3, at = Date.now()) {
  const d = dayOf(state, dayKey(at));
  return Math.max(0, freeLimit - (d.freeSkips || 0)) + state.inv.skipTickets;
}

/** 운동은 못 했지만 비켜 준 경우(전화·센서 없음·앱 오류) — 기록만 */
export function recordPass(state, { at = Date.now(), reason = 'pass' } = {}) {
  pushLog(state, { at, kind: 'pass', reason, pts: 0 });
}

/* ---------- 오늘의 미션 ---------- */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 그날의 미션 3개 (날짜로 정해져서 하루 동안 안 바뀜): 횟수 미션 1 + 나머지 2 */
export function missionIds(key) {
  const reps = MISSIONS.filter((m) => m.group === 'reps');
  const rest = MISSIONS.filter((m) => m.group !== 'reps');
  const h = hash(key);
  const a = rest[h % rest.length];
  let b = rest[(h >>> 8) % rest.length];
  if (b === a) b = rest[(rest.indexOf(a) + 1) % rest.length];
  return [reps[(h >>> 16) % reps.length].id, a.id, b.id];
}

export function missionsFor(state, key = dayKey()) {
  const d = dayOf(state, key);
  return missionIds(key).map((id) => {
    const m = MISSION_BY_ID[id];
    const progress = Math.min(m.goal, m.metric(d));
    const claimed = (d.claimed || []).includes(id);
    return {
      id, title: m.title, goal: m.goal, reward: m.reward, progress,
      done: progress >= m.goal, claimed, failed: !!m.failed?.(d) && progress < m.goal,
    };
  });
}

/** 미션 보상 받기 */
export function claimMission(state, id, { at = Date.now() } = {}) {
  const key = dayKey(at);
  const m = missionsFor(state, key).find((x) => x.id === id);
  if (!m) return { ok: false, error: '오늘의 미션이 아니에요' };
  if (m.claimed) return { ok: false, error: '이미 받았어요' };
  if (!m.done) return { ok: false, error: '아직 다 못 했어요' };
  const d = ensureDay(state, key);
  d.claimed = [...(d.claimed || []), id];
  const before = levelInfo(state.earned).level;
  addPoints(state, key, m.reward);
  pushLog(state, { at, kind: 'mission', id, pts: m.reward });
  const after = levelInfo(state.earned).level;
  return { ok: true, pts: m.reward, levelUp: after > before ? { from: before, to: after } : null };
}

/* ---------- 상점 ---------- */

export function buy(state, itemId, { at = Date.now() } = {}) {
  const item = SHOP.find((x) => x.id === itemId);
  if (!item) return { ok: false, error: '없는 상품이에요' };
  if (state.points < item.price) return { ok: false, error: `${item.price - state.points}P 더 모아야 해요` };
  if (item.id === 'skip') {
    if (state.inv.skipTickets >= item.max) return { ok: false, error: `최대 ${item.max}장까지 가질 수 있어요` };
    state.inv.skipTickets += 1;
  } else if (item.id === 'freeze') {
    if (state.inv.freezes >= item.max) return { ok: false, error: `최대 ${item.max}장까지 가질 수 있어요` };
    state.inv.freezes += 1;
  } else if (item.id.startsWith('theme:')) {
    const th = item.id.slice(6);
    if (state.inv.themes.includes(th)) return { ok: false, error: '이미 가지고 있어요' };
    state.inv.themes = [...state.inv.themes, th];
    state.inv.theme = th;
  }
  state.points -= item.price;
  pushLog(state, { at, kind: 'buy', id: item.id, pts: -item.price });
  return { ok: true, item };
}

export function setTheme(state, th) {
  if (!state.inv.themes.includes(th)) return false;
  state.inv.theme = th;
  return true;
}

/* ---------- 네이티브에서 온 이벤트 반영 ---------- */

/**
 * 잠금 화면의 네이티브 버튼(급할 때 그냥 열기)·홈 버튼·전화·자동 통과 같은 일은 웹 화면이 못 볼 수도 있어서
 * 네이티브가 줄을 세워 두고, 앱이 열릴 때 여기서 한 번만 반영한다.
 * @param {{id:string, type:'skip'|'home'|'pass'|'call'|'error', at:number}[]} events
 */
export function ingestNativeEvents(state, events, { freeLimit = 3 } = {}) {
  const seen = new Set(state.ingested);
  const applied = [];
  for (const e of events || []) {
    if (!e || !e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    if (e.type === 'skip' || e.type === 'home') applied.push({ e, r: recordSkip(state, { at: e.at, reason: e.type, freeLimit }) });
    else recordPass(state, { at: e.at, reason: e.type });
  }
  state.ingested = [...seen].slice(-300);
  return applied;
}

/* ---------- 보기용 요약 ---------- */

/** 이번 주(월~일) 매일 운동했는지 — 홈 화면 점 7개 */
export function weekDots(state, today = dayKey()) {
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // 월=0
  const monday = addDays(today, -dow);
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(monday, i);
    const day = dayOf(state, key);
    return {
      key, label: '월화수목금토일'[i], today: key === today, future: daysBetween(today, key) > 0,
      done: (day.sessions || 0) > 0, frozen: state.streak.frozen.includes(key), reps: totalReps(day),
    };
  });
}

export function todaySummary(state, today = dayKey()) {
  const d = dayOf(state, today);
  return { reps: totalReps(d), unlocks: d.unlocks || 0, practice: d.practice || 0, skips: d.skips || 0, pts: d.pts || 0 };
}

/** 최근 n일 날짜별 횟수 (기록 화면 막대) */
export function recentDays(state, n = 14, today = dayKey()) {
  return Array.from({ length: n }, (_, i) => {
    const key = addDays(today, i - n + 1);
    const d = dayOf(state, key);
    return { key, reps: totalReps(d), unlocks: d.unlocks || 0, skips: d.skips || 0 };
  });
}

export function totals(state) {
  let reps = 0, unlocks = 0, skips = 0, days = 0;
  for (const d of Object.values(state.days)) {
    const r = totalReps(d);
    reps += r;
    unlocks += d.unlocks || 0;
    skips += d.skips || 0;
    if (d.sessions) days += 1;
  }
  return { reps, unlocks, skips, days };
}

/** 상단 알림에 보일 한 줄 요약 */
export function summaryOf(state, today = dayKey()) {
  const n = (x) => Math.round(x || 0).toLocaleString('ko-KR');
  return `🪙 ${n(state.points)}P · 🔥 ${streakInfo(state, today).count}일 · 오늘 ${n(todaySummary(state, today).reps)}개`;
}
