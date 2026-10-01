// 기록·설정 저장 (이 폰의 앱 저장소 localStorage).
// 앱 화면과 잠금 화면은 서로 다른 WebView 지만 같은 저장소를 같이 쓴다. 그래서 오래 들고 있지 않고
// 바꿀 때마다 '읽고 → 고치고 → 쓰기'를 한 번에 한다(다른 화면이 그사이 쓴 것을 덮지 않게).

import { normalize } from './rewards.js';

const K_STATE = 'fitlock.state.v1';
const K_SET = 'fitlock.settings.v1';

export const DEFAULT_SETTINGS = {
  mode: 'sensor',        // 세는 방법: sensor(폰 들고) | camera(세워 두고)
  exercise: 'squat',     // 폰 들고 할 운동: squat | lunge
  camExercise: 'squat',  // 카메라로 할 운동 (핸즈프리 PT 엔진의 운동 id)
  target: 10,            // 목표 횟수
  voice: true,           // 숫자 음성 (무음·진동 모드면 자동으로 안 함)
  vibrate: true,
  gpu: true,             // 카메라 모드 AI 가속
  lock: {
    enabled: false,
    freeMinutes: 60,     // 한 번 하면 이만큼 그냥 열림. 0 = 매번, -1 = 하루 한 번
    skipsPerDay: 3,      // 기록 손해 없는 건너뛰기
    schedule: { enabled: true, windows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '07:00', end: '23:00' }] },
    places: { enabled: false, mode: 'only', list: [] }, // only = 이 장소에서만 잠금, except = 이 장소에선 잠금 안 함
  },
  ackNotSecurity: false, // '보안 잠금이 아니다' 안내를 봤는지
};

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/** 기본값 위에 저장값 덮기 (안쪽 객체까지, 배열은 통째로) */
export function mergeDeep(base, over) {
  if (!isObj(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(base[k]) ? mergeDeep(base[k], v) : v;
  }
  return out;
}

export function loadState() { return normalize(read(K_STATE)); }
/** fn(state) 이 상태를 고치고 돌려준 값을 그대로 돌려준다 */
export function updateState(fn) {
  const s = loadState();
  const r = fn(s);
  write(K_STATE, s);
  return r;
}

export function loadSettings() { return mergeDeep(DEFAULT_SETTINGS, read(K_SET)); }
export function updateSettings(fn) {
  const s = loadSettings();
  const r = fn(s);
  write(K_SET, s);
  return r ?? s;
}

/** 다른 WebView(잠금 화면 ↔ 앱)가 저장소를 바꾸면 알려 준다 */
export function onExternalChange(cb) {
  window.addEventListener('storage', (e) => { if (e.key === K_STATE || e.key === K_SET) cb(e.key); });
}

/** 백업 파일 (기록 + 설정) */
export function exportAll() {
  return JSON.stringify({ app: 'fitlock', v: 1, at: new Date().toISOString(), state: loadState(), settings: loadSettings() });
}
export function importAll(text) {
  const d = JSON.parse(text);
  if (d?.app !== 'fitlock') throw new Error('핏락 백업 파일이 아니에요');
  write(K_STATE, normalize(d.state));
  write(K_SET, mergeDeep(DEFAULT_SETTINGS, d.settings));
}
export function resetAll() {
  try { localStorage.removeItem(K_STATE); localStorage.removeItem(K_SET); } catch { /* 무시 */ }
}
