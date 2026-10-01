// 폰을 들고 하는 동작의 가짜 센서 값을 물리 모델로 만든다 (DeviceMotionEvent 와 같은 모양).
// 단위 테스트(test/unit/motion.test.mjs)와 에뮬레이터 점검(가짜 센서 주입)에 쓴다.
// 실제 폰 기록(설정 → 센서 기록 보내기)을 받으면 그걸로 다시 맞춘다 — 이건 그 전까지의 출발점이다.
//
// 좌표: 세상 X = 사람 오른쪽, Y = 사람이 보는 쪽(앞), Z = 위.
// 폰 좌표(안드로이드·W3C): x = 화면 오른쪽, y = 화면 위쪽, z = 화면 밖(보는 사람 쪽).
// 가속도계는 '위로 받치는 힘'을 잰다: 가만히 있으면 위쪽으로 +9.81 (accelerationIncludingGravity).
// acceleration(중력 뺀 값)은 폰이 추정한 중력을 뺀 값이라, 폰이 빨리 기울면 추정이 늦어 조금 샌다(fusionLag).

export const G = 9.81;

/** 재현 가능한 난수 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG = Math.PI / 180;
const minJerk = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));
const lerp = (a, b, u) => a + (b - a) * u;

// 3x3 행렬 (행 우선 배열 9칸)
const mul = (A, B) => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j];
  return C;
};
const tmul = (A, v) => [ // Aᵀ·v
  A[0] * v[0] + A[3] * v[1] + A[6] * v[2],
  A[1] * v[0] + A[4] * v[1] + A[7] * v[2],
  A[2] * v[0] + A[5] * v[1] + A[8] * v[2],
];
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
// 폰 좌표 → 세상 좌표 (열 = 폰 x·y·z 축이 세상에서 가리키는 방향)
const fromCols = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
export const HOLDS = {
  portrait: fromCols([1, 0, 0], [0, 0, 1], [0, -1, 0]),          // 세로로 들고 화면이 얼굴 쪽
  reading: mul(rotX(-35 * DEG), fromCols([1, 0, 0], [0, 0, 1], [0, -1, 0])), // 화면을 비스듬히 위로(읽는 각도)
  landscape: fromCols([0, 0, 1], [-1, 0, 0], [0, -1, 0]),       // 가로로 들기
  flat: fromCols([1, 0, 0], [0, 1, 0], [0, 0, 1]),              // 가슴 앞에 눕혀 들기(화면 위)
};

/** 부드러운 손 흔들림: 여러 주파수 사인파의 합 (진폭 amp, 주파수 f0~f1 Hz) */
function wobble(rnd, amp, f0 = 0.3, f1 = 3, n = 5) {
  const parts = Array.from({ length: n }, () => ({
    f: f0 + (f1 - f0) * rnd(), ph: rnd() * 2 * Math.PI, a: amp * (0.4 + 0.6 * rnd()) / Math.sqrt(n),
  }));
  return (t) => parts.reduce((s, p) => s + p.a * Math.sin(2 * Math.PI * p.f * t + p.ph), 0);
}

const pick = (rnd, r) => (Array.isArray(r) ? r[0] + (r[1] - r[0]) * rnd() : r);

/**
 * 동작 구간들을 이어 붙여 시간 → {pos:[x,y,z] m, pitch(앞으로 숙임, rad), roll, yaw} 함수를 만든다.
 * 반복 운동은 truth 에 정답 횟수와 각 회가 끝난 시각을 남긴다.
 */
function buildTimeline(segments, rnd) {
  const parts = []; // {t0, t1, f(t-t0) → state}
  const truth = { reps: 0, repEnds: [] };
  let t = 0;
  let base = { pos: [0, 0, 0], pitch: 0 };
  const push = (dur, f) => {
    const t0 = t;
    parts.push({ t0, t1: t0 + dur, f });
    t += dur;
    base = f(dur);
  };
  for (const s of segments) {
    const b = { pos: base.pos.slice(), pitch: base.pitch };
    switch (s.type) {
      case 'still': { // pitch(°)를 주면 그 각도로 놓인 채 (예: 90 = 책상에 눕혀 둔 폰)
        const pitch = s.pitch != null ? s.pitch * DEG : b.pitch;
        push(s.sec, () => ({ pos: b.pos.slice(), pitch }));
        break;
      }
      case 'squat':
      case 'lunge': {
        const lunge = s.type === 'lunge';
        for (let i = 0; i < s.reps; i++) {
          const d = pick(rnd, s.depth ?? (lunge ? [0.25, 0.38] : [0.3, 0.45]));
          const Td = pick(rnd, s.down ?? [0.8, 1.2]);
          const Tb = pick(rnd, s.bottom ?? [0, 0.25]);
          const Tu = pick(rnd, s.up ?? [0.6, 0.95]);
          const Th = pick(rnd, s.top ?? [0.25, 0.7]);
          const th = pick(rnd, s.pitch ?? (lunge ? [5, 15] : [15, 35])) * DEG;
          const fwd = lunge ? pick(rnd, [0.25, 0.4]) : 0.06; // 런지는 발을 내디뎌 몸이 앞뒤로 움직인다
          const side = lunge ? (i % 2 ? 0.05 : -0.05) : 0;
          const z0 = b.pos[2];
          const dur = Td + Tb + Tu + Th;
          const bb = { pos: b.pos.slice(), pitch: b.pitch };
          push(dur, (u) => {
            let k; // 0 = 선 자세, 1 = 가장 낮은 자세
            if (u < Td) k = minJerk(u / Td);
            else if (u < Td + Tb) k = 1;
            else if (u < Td + Tb + Tu) k = 1 - minJerk((u - Td - Tb) / Tu);
            else k = 0;
            return {
              pos: [bb.pos[0] + side * k, bb.pos[1] + fwd * k, z0 - d * k],
              pitch: bb.pitch + th * k,
            };
          });
          truth.reps += 1;
          truth.repEnds.push(t - Th);
        }
        break;
      }
      case 'walk':
      case 'jog': {
        const f = s.freq ?? (s.type === 'jog' ? 2.7 : 1.9);
        const bounce = s.bounce ?? (s.type === 'jog' ? 0.07 : 0.03);
        const v = s.speed ?? (s.type === 'jog' ? 2.2 : 1.3);
        const ph = rnd() * 2 * Math.PI;
        push(s.sec, (u) => ({
          pos: [b.pos[0] + 0.02 * (Math.sin(Math.PI * f * u + ph) - Math.sin(ph)), b.pos[1] + v * u + 0.015 * Math.sin(2 * Math.PI * f * u),
            b.pos[2] + bounce * Math.sin(2 * Math.PI * f * u + ph) * Math.min(1, u / 0.6)],
          pitch: b.pitch + 3 * DEG * (Math.sin(2 * Math.PI * f * u + 1) - Math.sin(1)),
        }));
        break;
      }
      case 'stairs': { // 계단 오르기: 0.6초마다 17cm
        const step = 0.17, per = s.per ?? 0.6, n = s.steps ?? 20;
        push(per * n, (u) => {
          const i = Math.floor(u / per);
          const k = i + minJerk((u - i * per) / (per * 0.6));
          return { pos: [b.pos[0], b.pos[1] + 0.3 * u / per, b.pos[2] + step * Math.min(n, k)], pitch: b.pitch };
        });
        break;
      }
      case 'bus': { // 버스·지하철: 위아래로 0.5~3Hz 흔들림 + 느린 앞뒤 가감속
        const parts = Array.from({ length: 8 }, () => {
          const fq = 0.5 + 2.5 * rnd();
          return { fq, ph: rnd() * 6.28, A: (s.rms ?? 0.6) * 0.5 / (2 * Math.PI * fq) ** 2 };
        });
        const horiz = Array.from({ length: 3 }, () => {
          const fq = 0.08 + 0.2 * rnd();
          return { fq, ph: rnd() * 6.28, A: 1.2 / (2 * Math.PI * fq) ** 2 };
        });
        push(s.sec, (u) => ({
          pos: [b.pos[0], b.pos[1] + horiz.reduce((a, p) => a + p.A * (Math.sin(2 * Math.PI * p.fq * u + p.ph) - Math.sin(p.ph)), 0),
            b.pos[2] + parts.reduce((a, p) => a + p.A * (Math.sin(2 * Math.PI * p.fq * u + p.ph) - Math.sin(p.ph)), 0)],
          pitch: b.pitch,
        }));
        break;
      }
      case 'pickup': { // 책상에 눕혀 둔 폰을 들어 가슴 앞으로: rise(m) 만큼 올리며 지금 각도 → 세움(0°)
        const rise = s.rise ?? 0.45;
        const T = s.sec ?? 0.9;
        push(T, (u) => {
          const k = minJerk(u / T);
          return { pos: [b.pos[0], b.pos[1] - 0.25 * k, b.pos[2] + rise * k], pitch: b.pitch * (1 - k) };
        });
        break;
      }
      case 'sit': { // 의자에 앉기 (stand: 다시 일어서기)
        const d = s.depth ?? 0.45, T = s.sec ?? 1.2, H = s.hold ?? 8;
        const z0 = b.pos[2];
        push(T + H, (u) => {
          const k = minJerk(u / T);
          return { pos: [b.pos[0], b.pos[1] + 0.1 * k, z0 - d * k], pitch: b.pitch + 10 * DEG * k };
        });
        if (s.stand) {
          const z1 = z0 - d;
          push(1.0 + 1.5, (u) => {
            const k = minJerk(u / 1.0);
            return { pos: [b.pos[0], b.pos[1] + 0.1 * (1 - k), z1 + d * k], pitch: b.pitch + 10 * DEG * (1 - k) };
          });
        }
        break;
      }
      case 'elevator': { // 엘리베이터: 1.2초 가속 → 정속 → 1.2초 감속 (아래로)
        const a = 0.8, Ta = 1.2, Tc = s.cruise ?? 6;
        const z0 = b.pos[2];
        push(2 * Ta + Tc + 1, (u) => {
          let z;
          if (u < Ta) z = -0.5 * a * u * u;
          else if (u < Ta + Tc) z = -0.5 * a * Ta * Ta - a * Ta * (u - Ta);
          else if (u < 2 * Ta + Tc) { const w = u - Ta - Tc; z = -0.5 * a * Ta * Ta - a * Ta * Tc - a * Ta * w + 0.5 * a * w * w; }
          else z = -a * Ta * Ta - a * Ta * Tc;
          return { pos: [b.pos[0], b.pos[1], z0 + z], pitch: b.pitch };
        });
        break;
      }
      case 'handle': { // 폰 만지작: 크게 돌리고 뒤집고 다시 쥐기 (위치는 조금만)
        const T = s.sec ?? 6;
        const rot = wobble(rnd, 70 * DEG, 0.3, 1.5, 4);
        const roll = wobble(rnd, 60 * DEG, 0.3, 1.5, 4);
        const pz = wobble(rnd, 0.05, 0.2, 1.2, 3);
        push(T, (u) => ({ pos: [b.pos[0], b.pos[1], b.pos[2] + pz(u) - pz(0)], pitch: b.pitch + rot(u) - rot(0), roll: roll(u) - roll(0) }));
        break;
      }
      case 'wave': { // 팔로 폰만 위아래로 흔들기 (속임수) — depth 만큼
        const n = s.reps ?? 10, d = s.depth ?? 0.35, per = s.per ?? 1.6;
        const z0 = b.pos[2];
        push(n * per, (u) => ({ pos: [b.pos[0], b.pos[1], z0 - d * 0.5 * (1 - Math.cos(2 * Math.PI * u / per))], pitch: b.pitch }));
        truth.reps += n;
        break;
      }
      default:
        throw new Error(`알 수 없는 동작: ${s.type}`);
    }
  }
  const at = (tt) => {
    const p = parts.find((q) => tt < q.t1) || parts[parts.length - 1];
    return p.f(Math.min(Math.max(0, tt - p.t0), p.t1 - p.t0));
  };
  return { at, duration: t, truth };
}

/**
 * 가짜 센서 기록 만들기.
 * @returns {{samples: {t:number, aig:number[], acc:number[]|null, rot:number[]|null}[], truth:{reps:number, repEnds:number[]}, duration:number}}
 *   aig = accelerationIncludingGravity [x,y,z] m/s², acc = acceleration(중력 뺀 값) 또는 null,
 *   rot = rotationRate [alpha(z축), beta(x축), gamma(y축)] °/s 또는 null
 */
export function synthMotion({
  seed = 1, rate = 60, jitterMs = 2, dropRate = 0.01,
  noise = 0.04, bias = null, fusionLag = 0.08, linear = true, rotation = true,
  hold = 'portrait', handShake = 1, segments = [{ type: 'still', sec: 2 }],
} = {}) {
  const rnd = mulberry32(seed);
  const tl = buildTimeline(segments, rnd);
  const R0 = HOLDS[hold] || HOLDS.portrait;
  // 손 흔들림: 느린 흔들림(0.1~0.6Hz, 수 mm·1~2°) + 잔떨림(1~5Hz, 1mm 안팎·0.3°).
  // 들고 가만히 있을 때 중력 뺀 가속도가 0.1m/s² 안팎으로 출렁이는 정도 (handShake 배)
  const both = (slow, fast) => { const a = wobble(rnd, slow, 0.1, 0.6), b = wobble(rnd, fast, 1, 5); return (t) => a(t) + b(t); };
  const wx = both(0.006 * handShake, 0.0008 * handShake), wy = both(0.006 * handShake, 0.0008 * handShake);
  const wz = both(0.005 * handShake, 0.0006 * handShake);
  const wp = both(1.5 * DEG * handShake, 0.3 * DEG * handShake), wr = both(1.5 * DEG * handShake, 0.3 * DEG * handShake);
  const wyaw = wobble(rnd, 2 * DEG * handShake, 0.1, 1);
  const b = bias || [(rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1];
  const gauss = () => { // 박스-뮬러
    const u = Math.max(1e-12, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const h = 1 / 1000; // 미분용 촘촘한 간격
  const state = (t) => {
    const s = tl.at(t);
    return {
      pos: [s.pos[0] + wx(t), s.pos[1] + wy(t), s.pos[2] + wz(t)],
      // pitch + = 폰 위쪽이 앞으로 기욺(상체를 숙일 때) = 세상 X 축으로 -회전
      R: mul(rotZ(wyaw(t) + (s.yaw || 0)), mul(rotX(-((s.pitch || 0) + wp(t))), mul(rotY((s.roll || 0) + wr(t)), R0))),
    };
  };
  const samples = [];
  let gEst = null; // 폰이 추정한 중력 (폰 좌표)
  let lastT = 0;
  const step = 1 / rate;
  for (let k = 0, t = 0; t < tl.duration - 2 * h; k++) {
    t = k * step + (k ? (rnd() - 0.5) * 2 * jitterMs / 1000 : 0);
    if (t >= tl.duration - 2 * h) break;
    if (k && rnd() < dropRate) continue; // 가끔 빠지는 표본
    const s0 = state(t - h), s1 = state(t), s2 = state(t + h);
    const aW = [0, 1, 2].map((i) => (s2.pos[i] - 2 * s1.pos[i] + s0.pos[i]) / (h * h));
    const R = s1.R;
    const f = tmul(R, [aW[0], aW[1], aW[2] + G]); // 가속도계가 재는 값 (폰 좌표)
    const gTrue = tmul(R, [0, 0, G]);
    const dt = Math.max(1e-3, t - lastT);
    lastT = t;
    gEst = gEst ? gEst.map((x, i) => x + (1 - Math.exp(-dt / Math.max(1e-3, fusionLag))) * (gTrue[i] - x)) : gTrue.slice();
    const aig = f.map((x) => x + noise * gauss());
    const acc = linear ? f.map((x, i) => x - gEst[i] + b[i] + noise * gauss()) : null;
    let rot = null;
    if (rotation) {
      // R(t+h)·R(t)ᵀ ≈ I + [ω]× h  → 세상 좌표 각속도 → 폰 좌표
      const Rn = s2.R;
      const M = mul(Rn, [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
      const wW = [(M[7] - M[5]) / (2 * h), (M[2] - M[6]) / (2 * h), (M[3] - M[1]) / (2 * h)];
      const wD = tmul(R, wW).map((x) => (x * 180) / Math.PI + 0.3 * gauss());
      rot = [wD[2], wD[0], wD[1]]; // alpha(z), beta(x), gamma(y)
    }
    samples.push({ t: Math.max(0, t), aig, acc, rot });
  }
  return { samples, truth: tl.truth, duration: tl.duration };
}

/** 정해 둔 시나리오 모음 (테스트·에뮬레이터 점검·개발 화면에서 같이 쓴다) */
export const SCENARIOS = {
  squat10: { segments: [{ type: 'still', sec: 1.5 }, { type: 'squat', reps: 10 }, { type: 'still', sec: 1.5 }] },
  squat10fast: { segments: [{ type: 'still', sec: 1.5 }, { type: 'squat', reps: 10, down: [0.45, 0.6], up: [0.4, 0.55], bottom: 0, top: [0.05, 0.2] }, { type: 'still', sec: 1 }] },
  squat10slow: { segments: [{ type: 'still', sec: 1.5 }, { type: 'squat', reps: 10, down: [1.8, 2.4], up: [1.4, 2.0], bottom: [0.3, 0.8], top: [0.5, 1.2] }, { type: 'still', sec: 1 }] },
  squat10shallow: { segments: [{ type: 'still', sec: 1.5 }, { type: 'squat', reps: 10, depth: [0.19, 0.24] }, { type: 'still', sec: 1 }] },
  squat10deep: { segments: [{ type: 'still', sec: 1.5 }, { type: 'squat', reps: 10, depth: [0.5, 0.65], pitch: [30, 50] }, { type: 'still', sec: 1 }] },
  lunge10: { segments: [{ type: 'still', sec: 1.5 }, { type: 'lunge', reps: 10 }, { type: 'still', sec: 1 }] },
  pickupThenSquat: { segments: [{ type: 'still', sec: 0.5, pitch: 90 }, { type: 'pickup' }, { type: 'still', sec: 1.2 }, { type: 'squat', reps: 10 }, { type: 'still', sec: 1 }] },
  still60: { segments: [{ type: 'still', sec: 60 }] },
  walk60: { segments: [{ type: 'walk', sec: 60 }] },
  jog30: { segments: [{ type: 'jog', sec: 30 }] },
  bus60: { segments: [{ type: 'bus', sec: 60 }] },
  handle20: { segments: [{ type: 'still', sec: 1 }, { type: 'handle', sec: 20 }] },
  sitStay: { segments: [{ type: 'still', sec: 2 }, { type: 'sit', hold: 12 }] },
  sitStand: { segments: [{ type: 'still', sec: 2 }, { type: 'sit', hold: 6, stand: true }] },
  elevator: { segments: [{ type: 'still', sec: 2 }, { type: 'elevator' }, { type: 'still', sec: 4 }] },
  stairs: { segments: [{ type: 'still', sec: 1 }, { type: 'stairs', steps: 24 }, { type: 'still', sec: 2 }] },
  quarter10: { segments: [{ type: 'still', sec: 1.5 }, { type: 'squat', reps: 10, depth: [0.07, 0.1] }, { type: 'still', sec: 1 }] },
};
