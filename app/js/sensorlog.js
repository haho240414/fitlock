// 센서 기록: 폰 들고 세기를 실제 폰에 맞추려고, 도전할 때의 센서 값(가속도·회전, 영상 아님)을 최근 5번만 이 폰에 남긴다.
// 사용자가 설정 → '센서 기록 보내기'를 눌러야만 파일로 나간다(자동 전송 없음).
// 값은 100배 해서 16비트 정수로 줄여 base64 로 담는다(60Hz 1분 ≈ 90KB).

const KEY = 'fitlock.sensorlog.v1';
const MAX_KEEP = 5;
const MAX_SEC = 125;
export const FIELDS = ['t', 'gx', 'gy', 'gz', 'ax', 'ay', 'az', 'ra', 'rb', 'rg'];
// 시간 1/250초(최대 131초), 가속도 0.01m/s², 회전 0.01°/s (±327°/s 넘으면 잘림 — 만지작 판정엔 충분)
const SCALES = [250, 100, 100, 100, 100, 100, 100, 100, 100, 100];

const clamp16 = (x) => Math.max(-32768, Math.min(32767, Math.round(x)));

function toB64(i16) {
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Int16Array(u8.buffer);
}

/** 도전 하나를 기록하는 중 */
export class SensorRecorder {
  constructor() {
    this.rows = [];
    this.t0 = null;
  }

  add(s) { // s = {t, aig, acc, rot}
    if (!s.aig) return;
    if (this.t0 == null) this.t0 = s.t;
    const t = s.t - this.t0;
    if (t > MAX_SEC) return;
    const a = s.acc || [NaN, NaN, NaN];
    const r = s.rot || [NaN, NaN, NaN];
    this.rows.push([t, ...s.aig, ...a, ...r]);
  }

  get seconds() { return this.rows.length ? this.rows[this.rows.length - 1][0] : 0; }

  /** 저장할 모양으로 */
  pack(meta) {
    const n = this.rows.length;
    const i16 = new Int16Array(n * FIELDS.length);
    const hasAcc = this.rows.some((r) => Number.isFinite(r[4]));
    const hasRot = this.rows.some((r) => Number.isFinite(r[7]));
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < FIELDS.length; k++) {
        const v = this.rows[i][k];
        i16[i * FIELDS.length + k] = Number.isFinite(v) ? clamp16(v * SCALES[k]) : -32768;
      }
    }
    return { ...meta, n, hasAcc, hasRot, scales: SCALES, fields: FIELDS, data: toB64(i16) };
  }
}

export function listRecordings() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

/** 기록 저장 (최근 MAX_KEEP 개만). 너무 짧은 건(3초 미만) 버린다 */
export function saveRecording(rec, meta) {
  if (!rec || rec.seconds < 3) return false;
  const list = listRecordings();
  list.push(rec.pack({ id: `${Date.now().toString(36)}`, at: Date.now(), ...meta, truth: null }));
  while (list.length > MAX_KEEP) list.shift();
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch { // 저장 공간 부족 → 가장 오래된 것부터 지우고 다시
    while (list.length > 1) {
      list.shift();
      try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { /* 계속 */ }
    }
    return false;
  }
}

/** 실제로 몇 번 했는지 적어 두기 (튜닝 정답) */
export function setTruth(id, n) {
  const list = listRecordings();
  const r = list.find((x) => x.id === id);
  if (!r) return;
  r.truth = Number.isFinite(n) ? n : null;
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function clearRecordings() { localStorage.removeItem(KEY); }

/** 보낼 파일 내용 */
export function exportRecordings(device = {}) {
  return JSON.stringify({ app: 'fitlock-sensorlog', v: 1, at: new Date().toISOString(), device, recordings: listRecordings() });
}

/** 파일 → 표본 배열 (tools/motion-replay.mjs 와 테스트에서 씀) */
export function unpackRecording(r) {
  const i16 = fromB64(r.data);
  const F = r.fields.length;
  const out = [];
  for (let i = 0; i < r.n; i++) {
    const v = Array.from(i16.subarray(i * F, i * F + F), (x, k) => (x === -32768 ? null : x / r.scales[k]));
    out.push({
      t: v[0], aig: [v[1], v[2], v[3]],
      acc: v[4] == null ? null : [v[4], v[5], v[6]],
      rot: v[7] == null ? null : [v[7], v[8], v[9]],
    });
  }
  return out;
}
