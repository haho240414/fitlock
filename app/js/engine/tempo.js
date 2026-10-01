// 템포·속도: 반복 1회를 '힘주는 구간(당기기·밀기·일어서기)'과 '돌아오는 구간(풀기·내리기·앉기)'으로 나눠
// 각각 몇 초 걸렸는지, 얼마나 빨랐는지 잰다 (테크노짐·VBT 장비가 보여주는 그 숫자).
//
// 카운터 신호는 '힘주는 자세가 낮은 값'이라 반복 1회는 위(시작 자세) → 아래 → 위다.
// 앞 구간이 힘주기인지(컬·랫풀다운·프레스) 돌아오기인지(스쿼트·푸시업)는 운동마다 다르다 → exercises.js 의 tempo.first.
// 구간 경계 = 그 움직임의 양 끝 5% 띠를 벗어나고 들어오는 순간(프레임 사이 보간). 위·아래에서 멈춘 시간은 빼고 '움직인 시간'만 잰다.
// 띠 때문에 양 끝 5%씩 덜 재므로 /0.9 로 늘린다(일정한 속도면 정확, 끝에서 천천히 멈추는 실제 동작은 조금 짧게 나온다).

const BAND = 0.05;
const fin = Number.isFinite;

// 시각 t 에서 key 값(선형 보간, 한쪽만 있으면 그 값)
function at(pts, key, t) {
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t >= t) {
      const a = pts[i - 1][key], b = pts[i][key];
      if (!fin(a) || !fin(b)) return fin(b) ? b : a;
      const k = pts[i].t > pts[i - 1].t ? (t - pts[i - 1].t) / (pts[i].t - pts[i - 1].t) : 0;
      return a + (b - a) * k;
    }
  }
  return pts.length ? pts[pts.length - 1][key] : NaN;
}
// pts[i] → pts[i+1] 사이에서 s 가 level 을 지나는 시각
function cross(pts, i, level) {
  const a = pts[i], b = pts[i + 1];
  if (!b || a.s === b.s) return a.t;
  const k = Math.max(0, Math.min(1, (level - a.s) / (b.s - a.s)));
  return a.t + (b.t - a.t) * k;
}

// a 에서 dir(+1 앞으로 / -1 거꾸로) 방향으로, 신호가 sign(+1 커짐 / -1 작아짐) 쪽으로 이어서 움직이는 동안 따라간다.
// 멈추면(STEP 이상 더 못 나아간 채 시간이 흐르면) 끝: 예상 폭(expect)의 70% 이상 왔으면 0.3초, 아니면 0.8초.
// (반쯤 가다 잠깐 주춤한 것과, 덤벨을 어깨에 올려 놓고 쉰 뒤 밀어 올린 것처럼 '다른 동작 사이에 쉰 것'을 가른다)
// 출발점에서 settle 만큼 움직이기 전의 멈춤(바닥·꼭대기에서 버티기)은 끝으로 치지 않는다.
function walk(pts, a, dir, sign, step, settle, expect) {
  let e = a;
  for (let i = a + dir; i >= 0 && i < pts.length; i += dir) {
    if (sign * (pts[i].s - pts[e].s) > step) { e = i; continue; }
    const moved = sign * (pts[e].s - pts[a].s);
    if (moved < settle) continue;
    if (Math.abs(pts[i].t - pts[e].t) >= (moved >= 0.7 * expect ? 0.3 : 0.8)) return { i: e, done: true };
  }
  return { i: e, done: false };
}

// 구간 [i0, i1] 안에서 위 띠(hi)를 벗어나 아래 띠(lo)에 들어가는 시각(내려가는 구간) — 오르는 구간은 sign=-1 로 거꾸로
function phase(pts, i0, i1, falling) {
  let hi = -Infinity, lo = Infinity;
  for (let i = i0; i <= i1; i++) { hi = Math.max(hi, pts[i].s); lo = Math.min(lo, pts[i].s); }
  const r = hi - lo;
  const from = falling ? hi - BAND * r : lo + BAND * r; // 출발 띠 경계
  const to = falling ? lo + BAND * r : hi - BAND * r;   // 도착 띠 경계
  const past = (v, lvl) => (falling ? v < lvl : v > lvl);
  let a = i0;
  for (let i = i0; i <= i1; i++) if (!past(pts[i].s, from)) a = i; // 마지막으로 출발 띠 안에 있던 점
  let b = a + 1;
  while (b < i1 && !(falling ? pts[b].s <= to : pts[b].s >= to)) b++;
  b = Math.min(b, i1);
  const t0 = cross(pts, a, from), t1 = cross(pts, Math.max(a, b - 1), to);
  return { t0, t1, range: r };
}

/**
 * @param {Array<{t:number, s:number, d?:number}>} pts 시간순. s = 카운터 신호, d = 거리 신호(m, 없으면 NaN)
 * @param {{tStart:number, tBottom:number, top:number, bottom:number, lead?:boolean}} rep 카운터가 낸 반복
 * @param {{final?:boolean, minRange?:number}} [o] final = 세트가 끝나 더 기다릴 수 없음, minRange = 이보다 작게 움직인 구간은 안 잼
 * @returns {null | object} null = 아직 다 올라오지 않음(final 이면 잴 수 없음).
 *   down·up = 초, hold = 바닥 근처에 머문 초, *Rate = 신호단위/초, *Speed = m/s, rom = m
 *
 * 구간은 '이어진 움직임'만 본다: 덤벨을 어깨에 올리고(1) 쉰 뒤 밀어 올리면(2) 카운터는 (1)+(2)를 한 반복의 앞 구간으로
 * 보지만 템포는 (2)만 잰다. 바닥에서 버틴 시간은 어느 구간에도 넣지 않고 hold 로 따로 준다.
 */
export function measureRep(pts, rep, { final = false, minRange = 0 } = {}) {
  pts = pts.filter((p) => fin(p.s));
  if (pts.length < 4) return null;
  // 바닥 = tBottom 근처 최저점
  let iB = -1;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i].t - rep.tBottom) <= 0.35 && (iB < 0 || pts[i].s < pts[iB].s)) iB = i;
  }
  if (iB < 0) return null;
  const bot = pts[iB].s;
  const full = Math.max(rep.top - bot, 1e-9);
  const step = 0.03 * full;
  const settle = Math.max(minRange, 3 * step); // 이만큼 움직인 뒤의 멈춤만 '동작 끝'으로 본다

  // 앞 구간(위 → 아래): 바닥에서 거슬러 올라가 시작점, 거기서 다시 내려와 끝점
  let down = null, tD1 = null, downRate = null, downSpeed = null, r1 = 0;
  if (!rep.lead) {
    const iS = walk(pts, iB, -1, +1, step, settle, full).i;
    const iE = walk(pts, iS, +1, -1, step, settle, pts[iS].s - bot).i;
    if (iE > iS) {
      const ph = phase(pts, iS, iE, true);
      if (ph.range > minRange && ph.t1 - ph.t0 > 0.05) {
        const dt = ph.t1 - ph.t0;
        r1 = ph.range;
        tD1 = ph.t1;
        down = dt / 0.9;
        downRate = (0.9 * ph.range) / dt;
        const dd = Math.abs(at(pts, 'd', ph.t1) - at(pts, 'd', ph.t0));
        if (fin(dd)) downSpeed = dd / dt;
      }
    }
  }

  // 뒤 구간(아래 → 위): 바닥에서 올라가 멈춘 곳(위에서 쉼 또는 다음 반복 시작)이 끝점, 거기서 거슬러 내려와 시작점
  const U = walk(pts, iB, +1, +1, step, settle, r1 || full);
  const iT = U.i;
  if (!U.done && !(final && pts[iT].s - bot > minRange)) return null;
  const iU = walk(pts, iT, -1, -1, step, settle, pts[iT].s - bot).i;
  if (!(iT > iU)) return null;
  const ph2 = phase(pts, iU, iT, false);
  const dt2 = ph2.t1 - ph2.t0;
  if (!(ph2.range > minRange) || !(dt2 > 0.05)) return null;
  const du = Math.abs(at(pts, 'd', ph2.t1) - at(pts, 'd', ph2.t0));
  const rom = Math.abs(at(pts, 'd', pts[iT].t) - at(pts, 'd', pts[iB].t));
  return {
    down,
    up: dt2 / 0.9,
    hold: tD1 == null ? null : Math.max(0, ph2.t0 - tD1),
    downRate,
    upRate: (0.9 * ph2.range) / dt2,
    downSpeed,
    upSpeed: fin(du) ? du / dt2 : null,
    rom: fin(rom) ? rom : null,
    tTop: pts[iT].t,
  };
}

const r2d = (x) => (x == null || !fin(x) ? null : Math.round(x * 100) / 100);

/** 앞/뒤 구간 → 힘주기(con)/돌아오기(ecc) 로 바꿔 화면·기록용으로 정리 */
export function toPhases(m, first) {
  if (!m) return null;
  const c = first === 'con';
  return {
    con: r2d(c ? m.down : m.up),          // 힘주는 구간(초)
    ecc: r2d(c ? m.up : m.down),          // 돌아오는 구간(초)
    hold: r2d(m.hold),
    conSpeed: r2d(c ? m.downSpeed : m.upSpeed), // m/s (거리 신호가 있을 때)
    eccSpeed: r2d(c ? m.upSpeed : m.downSpeed),
    conRate: r2d(c ? m.downRate : m.upRate),    // 신호단위/초 (같은 세트 안 상대 비교용)
    rom: r2d(m.rom),
  };
}

/**
 * 세트 요약: 평균 템포, 속도(가능하면 m/s), 속도 저하율(처음 빠른 반복 대비 마지막 2회).
 * 속도 저하가 20~30%를 넘으면 '거의 한계'라는 게 VBT(속도 기반 훈련)의 흔한 기준.
 */
export function summarize(list) {
  const xs = (list || []).filter(Boolean);
  if (!xs.length) return null;
  const avg = (k) => {
    const v = xs.map((x) => x[k]).filter((v) => v != null && fin(v));
    return v.length ? r2d(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const sp = speeds(xs);
  let loss = null;
  if (sp.vals.length >= 4) {
    const best = Math.max(...sp.vals.slice(0, 3));
    const end = (sp.vals[sp.vals.length - 1] + sp.vals[sp.vals.length - 2]) / 2;
    if (best > 0) loss = Math.max(0, Math.round((1 - end / best) * 100));
  }
  return { con: avg('con'), ecc: avg('ecc'), speed: sp.metric ? avg('conSpeed') : null, loss, n: xs.length };
}

/** 그래프용 반복별 힘주기 속도: 모든 반복에 m/s 가 있으면 m/s, 아니면 신호단위(상대 비교만) */
export function speeds(list) {
  const xs = (list || []).filter(Boolean);
  const metric = xs.length > 0 && xs.every((x) => x.conSpeed != null);
  return { metric, vals: xs.map((x) => (metric ? x.conSpeed : x.conRate)).filter((v) => v != null && fin(v)) };
}
