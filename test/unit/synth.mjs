// 합성 스켈레톤: 관절각 파라미터로 MediaPipe 형식(정규화 33점 + 월드 33점)의 포즈를 만든다.
// 실제 영상 검증(test/eval.mjs) 전에 카운터/세트 로직을 빠르게 확인하는 용도.

const N = 33;

function blank() {
  return Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, visibility: 0.99 }));
}

/**
 * 서 있는 사람(정면). squat: 0~1 (1 = 허벅지 수평), arms: 팔 벌림 0(차렷)~1(만세), legs: 다리 벌림 0~1
 */
export function standingPose({ squat = 0, arms = 0, legs = 0, jitter = 0, rnd = Math.random } = {}) {
  const w = blank();
  const j = () => (rnd() - 0.5) * 2 * jitter;
  const phi = squat * Math.PI / 4; // 정강이/허벅지 기울기 (0 → 45°, 무릎각 180 → 90)
  const lean = 0.5 * phi;
  const ankleX = 0.1 + 0.25 * legs;
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const hip = { x: 0.1 * s, y: 0, z: 0 };
    const knee = { x: (0.1 + 0.12 * legs) * s, y: 0.45 * Math.cos(phi), z: -0.45 * Math.sin(phi) };
    const ankle = { x: ankleX * s, y: 0.9 * Math.cos(phi), z: 0 };
    const sh = { x: 0.18 * s, y: -0.5 * Math.cos(lean), z: -0.5 * Math.sin(lean) };
    // 팔: 어깨 기준으로 옆으로 회전 (arms 0 → 아래, 1 → 위)
    const a = (15 + 155 * arms) * Math.PI / 180;
    const elbow = { x: sh.x + 0.28 * Math.sin(a) * s, y: sh.y + 0.28 * Math.cos(a), z: sh.z };
    const wrist = { x: sh.x + 0.53 * Math.sin(a) * s, y: sh.y + 0.53 * Math.cos(a), z: sh.z };
    const idx = side === 'L'
      ? { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ankle: 27 }
      : { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ankle: 28 };
    for (const [k, p] of [['sh', sh], ['el', elbow], ['wr', wrist], ['hip', hip], ['knee', knee], ['ankle', ankle]]) {
      w[idx[k]] = { x: p.x + j(), y: p.y + j(), z: p.z + j(), visibility: 0.99 };
    }
  }
  w[0] = { x: 0, y: -0.65 * Math.cos(lean), z: -0.1, visibility: 0.99 };
  return toFrame(w, 0.9 * Math.cos(phi));
}

/** 엎드려 팔굽혀펴기 자세(옆에서 본 모습 기준 좌표). down: 0(팔 폄)~1(바닥) */
export function pushupPose({ down = 0, jitter = 0, rnd = Math.random } = {}) {
  const w = blank();
  const j = () => (rnd() - 0.5) * 2 * jitter;
  const armLen = 0.55;
  const shH = armLen * (1 - 0.7 * down); // 어깨 높이(바닥 위)
  const bodyAng = Math.asin(Math.min(1, shH / 1.45)); // 발끝~어깨 1.45m 가 이루는 경사
  // 엉덩이 원점, x = 머리 방향, y 아래
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const z = 0.18 * s;
    const hip = { x: 0, y: 0, z: 0.1 * s };
    const sh = { x: 0.5 * Math.cos(bodyAng), y: -0.5 * Math.sin(bodyAng), z };
    const wrist = { x: sh.x, y: sh.y + shH, z: 0.25 * s };
    const elbowOut = 0.12 + 0.18 * down;
    const elbow = { x: sh.x - 0.05 * down, y: (sh.y + wrist.y) / 2 - 0.05 * down, z: z + elbowOut * s };
    const knee = { x: -0.45 * Math.cos(bodyAng), y: 0.45 * Math.sin(bodyAng), z: 0.1 * s };
    const ankle = { x: -0.9 * Math.cos(bodyAng), y: 0.9 * Math.sin(bodyAng), z: 0.1 * s };
    const idx = side === 'L'
      ? { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ankle: 27 }
      : { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ankle: 28 };
    for (const [k, p] of [['sh', sh], ['el', elbow], ['wr', wrist], ['hip', hip], ['knee', knee], ['ankle', ankle]]) {
      w[idx[k]] = { x: p.x + j(), y: p.y + j(), z: p.z + j(), visibility: 0.99 };
    }
  }
  w[0] = { x: 0.7 * Math.cos(bodyAng), y: -0.7 * Math.sin(bodyAng), z: 0, visibility: 0.99 };
  return toFrame(w, 0.9 * Math.sin(bodyAng));
}

// 월드 좌표 → 대충 투영한 정규화 좌표 (가시성·화면 박스 계산용)
function toFrame(wl, hipAboveAnkle) {
  const lm = wl.map((p) => ({
    x: 0.5 + p.x * 0.25,
    y: 0.55 + (p.y - hipAboveAnkle / 2) * 0.25,
    z: p.z,
    visibility: p.visibility,
  }));
  return { lm, wl };
}

/** 결정적 난수 (테스트 재현용) */
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 부드러운 반복 파형 0→1→0 */
export const wave = (phase) => 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
