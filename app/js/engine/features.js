// 포즈 랜드마크(MediaPipe 33점) → 운동 판별용 특징값.
// 각도는 월드 좌표(미터, 엉덩이 중심 원점, y축 아래 방향)로 계산해 카메라 거리·줌에 덜 민감하게 한다.
// 월드 좌표는 '카메라 기준'이라 폰을 기울여 세우면 위아래가 틀어진다 → 추적기가 선 자세로 진짜 '위'를 추정해
// toGravityFrame() 으로 돌려 넣는다.
// 계산할 수 없는 값(관절이 안 보임)은 NaN — 판정 쪽에서 '모름'으로 다룬다(탈락이 아님).

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

export const KEY_JOINTS = [
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
];

export const VIS_MIN = 0.5;
const DEG = 180 / Math.PI;

const vis = (p) => (p ? (p.visibility ?? 1) : 0);

function angle3(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const nu = Math.hypot(ux, uy, uz), nv = Math.hypot(vx, vy, vz);
  if (!nu || !nv) return NaN;
  const cos = (ux * vx + uy * vy + uz * vz) / (nu * nv);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
}

// 좌/우 값을 가시성으로 합친다. 옆모습이면 보이는 쪽만 쓴다.
function sided(a, wa, b, wb) {
  const okA = wa >= VIS_MIN && Number.isFinite(a);
  const okB = wb >= VIS_MIN && Number.isFinite(b);
  if (okA && okB) {
    return { L: a, R: b, avg: (a * wa + b * wb) / (wa + wb), min: Math.min(a, b), max: Math.max(a, b) };
  }
  if (okA) return { L: a, R: NaN, avg: a, min: a, max: a };
  if (okB) return { L: NaN, R: b, avg: b, min: b, max: b };
  return { L: NaN, R: NaN, avg: NaN, min: NaN, max: NaN };
}

const minVis = (lm, ...idx) => Math.min(...idx.map((i) => vis(lm[i])));

const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n ? [v[0] / n, v[1] / n, v[2] / n] : null;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * 측정한 선 자세 축(est)을 기준 축(ref)으로 돌리는 회전. 규칙의 숫자가 맞춰진 시범 영상들도 선 자세 축이
 * 카메라 위쪽에서 약 7° 기울어 있었다(test/robust.mjs 측정) → 0°가 아니라 그 '평소 모습'으로 맞춘다.
 */
export const REF_UP = (() => { const v = [0, -0.99, -0.13]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
export function rotationTo(est, ref = REF_UP) {
  const k = cross(est, ref);
  const sin = Math.hypot(...k), cos = dot(est, ref);
  if (sin < 1e-6) return null;
  const [x, y, z] = k.map((v) => v / sin);
  const C = 1 - cos;
  return [
    [cos + x * x * C, x * y * C - z * sin, x * z * C + y * sin],
    [y * x * C + z * sin, cos + y * y * C, y * z * C - x * sin],
    [z * x * C - y * sin, z * y * C + x * sin, cos + z * z * C],
  ];
}
export function rotatePoints(wl, m) {
  if (!m) return wl;
  return wl.map((p) => ({
    x: m[0][0] * p.x + m[0][1] * p.y + m[0][2] * p.z,
    y: m[1][0] * p.x + m[1][1] * p.y + m[1][2] * p.z,
    z: m[2][0] * p.x + m[2][1] * p.y + m[2][2] * p.z,
    visibility: p.visibility,
  }));
}

/** 위쪽 단위벡터(카메라 좌표) → 중력 기준 좌표계 (오른쪽 R, 아래 D, 앞 F). 기울기 0이면 원래 축과 같다 */
export function gravityBasis(up) {
  const D = norm([-up[0], -up[1], -up[2]]);
  let R = [1, 0, 0];
  R = norm([R[0] - dot(R, D) * D[0], R[1] - dot(R, D) * D[1], R[2] - dot(R, D) * D[2]]) || [1, 0, 0];
  const F = cross(R, D);
  return { R, D, F };
}

/** 월드 좌표를 중력 기준으로 돌린다 (x=오른쪽, y=아래, z=앞) */
export function toGravityFrame(wl, basis) {
  if (!basis) return wl;
  const { R, D, F } = basis;
  return wl.map((p) => {
    const v = [p.x, p.y, p.z];
    return { x: dot(v, R), y: dot(v, D), z: dot(v, F), visibility: p.visibility };
  });
}

/**
 * 똑바로 선 자세면 몸의 축(발목→어깨, 카메라 좌표)을 돌려준다 = 진짜 '위쪽' 표본. 아니면 null.
 * 각도는 회전과 무관하므로 카메라 좌표 그대로 판단할 수 있다. 옆모습이면 잘 보이는 쪽만 쓴다.
 * 실측: 선 자세의 무릎·엉덩이 각도는 160~172° 근처라 기준은 155°
 */
export function uprightAxis(lm, wl) {
  const side = (s, h, k, a) => {
    const v = minVis(lm, s, h, k, a);
    if (v < 0.5) return null;
    const ok = angle3(wl[h], wl[k], wl[a]) > 155 && angle3(wl[s], wl[h], wl[k]) > 155;
    return { v, ok, axis: [wl[s].x - wl[a].x, wl[s].y - wl[a].y, wl[s].z - wl[a].z] };
  };
  const sides = [side(11, 23, 25, 27), side(12, 24, 26, 28)].filter(Boolean);
  if (!sides.length || sides.some((c) => !c.ok)) return null;
  const ax = norm(sides.reduce((acc, c) => acc.map((x, i) => x + c.axis[i] * c.v), [0, 0, 0]));
  if (ax && sides.length === 2) {
    // 두 발이 앞뒤로 벌어졌거나(걷는 중·런지) 한 발을 들었으면 몸 축이 기울어 있다.
    // 카메라 축이 아니라 몸 기준(골반 좌우 방향 × 몸 축 = 앞뒤 방향)으로 재야 폰이 기울어도 같은 판정이 나온다
    const A = [wl[27].x - wl[28].x, wl[27].y - wl[28].y, wl[27].z - wl[28].z];
    const H = [wl[23].x - wl[24].x, wl[23].y - wl[24].y, wl[23].z - wl[24].z];
    const fwd = norm(cross(H, ax));
    if (fwd && Math.abs(dot(A, fwd)) > 0.2) return null;
    if (Math.abs(dot(A, ax)) > 0.08) return null;
  }
  return ax;
}

/**
 * @param {Array<{x,y,z,visibility}>} lm  정규화 이미지 좌표 33점
 * @param {Array<{x,y,z,visibility}>} wl  월드 좌표 33점 (미터, 가능하면 toGravityFrame 을 거친 것)
 */
export function computeFeatures(lm, wl) {
  const f = {};
  const L = LM;

  const visKey = KEY_JOINTS.map((i) => vis(lm[i]));
  f.visAll = visKey.reduce((s, v) => s + v, 0) / visKey.length;
  f.visLegs = (vis(lm[L.L_HIP]) + vis(lm[L.R_HIP]) + vis(lm[L.L_KNEE]) + vis(lm[L.R_KNEE])
    + vis(lm[L.L_ANKLE]) + vis(lm[L.R_ANKLE])) / 6;
  f.visArms = (vis(lm[L.L_SHOULDER]) + vis(lm[L.R_SHOULDER]) + vis(lm[L.L_ELBOW]) + vis(lm[L.R_ELBOW])
    + vis(lm[L.L_WRIST]) + vis(lm[L.R_WRIST])) / 6;

  const knee = sided(
    angle3(wl[L.L_HIP], wl[L.L_KNEE], wl[L.L_ANKLE]), minVis(lm, L.L_HIP, L.L_KNEE, L.L_ANKLE),
    angle3(wl[L.R_HIP], wl[L.R_KNEE], wl[L.R_ANKLE]), minVis(lm, L.R_HIP, L.R_KNEE, L.R_ANKLE));
  f.knee = knee.avg; f.kneeMin = knee.min; f.kneeL = knee.L; f.kneeR = knee.R;

  const hip = sided(
    angle3(wl[L.L_SHOULDER], wl[L.L_HIP], wl[L.L_KNEE]), minVis(lm, L.L_SHOULDER, L.L_HIP, L.L_KNEE),
    angle3(wl[L.R_SHOULDER], wl[L.R_HIP], wl[L.R_KNEE]), minVis(lm, L.R_SHOULDER, L.R_HIP, L.R_KNEE));
  f.hip = hip.avg; f.hipMin = hip.min;

  const elbow = sided(
    angle3(wl[L.L_SHOULDER], wl[L.L_ELBOW], wl[L.L_WRIST]), minVis(lm, L.L_SHOULDER, L.L_ELBOW, L.L_WRIST),
    angle3(wl[L.R_SHOULDER], wl[L.R_ELBOW], wl[L.R_WRIST]), minVis(lm, L.R_SHOULDER, L.R_ELBOW, L.R_WRIST));
  f.elbow = elbow.avg; f.elbowMin = elbow.min; f.elbowL = elbow.L; f.elbowR = elbow.R;

  // 팔 들어올림 각도(몸통-위팔): 차렷 ≈ 15°, 수평 ≈ 90°, 만세 ≈ 170°
  const arm = sided(
    angle3(wl[L.L_HIP], wl[L.L_SHOULDER], wl[L.L_ELBOW]), minVis(lm, L.L_HIP, L.L_SHOULDER, L.L_ELBOW),
    angle3(wl[L.R_HIP], wl[L.R_SHOULDER], wl[L.R_ELBOW]), minVis(lm, L.R_HIP, L.R_SHOULDER, L.R_ELBOW));
  f.arm = arm.avg; f.armMax = arm.max;

  // 몸통 기울기: 엉덩이 중심→어깨 중심 벡터와 '위쪽'의 각도. 0 = 똑바로 섬, 90 = 수평, >90 = 엉덩이가 어깨보다 높음
  const sL = wl[L.L_SHOULDER], sR = wl[L.R_SHOULDER], hL = wl[L.L_HIP], hR = wl[L.R_HIP];
  const torsoVis = Math.max(minVis(lm, L.L_SHOULDER, L.L_HIP), minVis(lm, L.R_SHOULDER, L.R_HIP));
  if (torsoVis >= VIS_MIN) {
    const vx = (sL.x + sR.x - hL.x - hR.x) / 2;
    const vy = (sL.y + sR.y - hL.y - hR.y) / 2;
    const vz = (sL.z + sR.z - hL.z - hR.z) / 2;
    const n = Math.hypot(vx, vy, vz);
    f.torsoTilt = n ? Math.acos(Math.max(-1, Math.min(1, -vy / n))) * DEG : NaN;
  } else f.torsoTilt = NaN;

  // 엉덩이 높이(발목 기준, m). 서 있으면 ≈ 0.8, 스쿼트 바닥 ≈ 0.4~0.5, 바닥에 누우면 ≈ 0
  const hipH = sided(
    wl[L.L_ANKLE].y - wl[L.L_HIP].y, minVis(lm, L.L_ANKLE, L.L_HIP),
    wl[L.R_ANKLE].y - wl[L.R_HIP].y, minVis(lm, L.R_ANKLE, L.R_HIP));
  f.hipH = hipH.avg;
  f.hipHAbs = Math.abs(hipH.avg);
  // 손목 높이(발목 기준, m): 데드리프트 바벨 높이 → 들어 올리는 속도(m/s)
  const handH = sided(
    wl[L.L_ANKLE].y - wl[L.L_WRIST].y, minVis(lm, L.L_ANKLE, L.L_WRIST),
    wl[L.R_ANKLE].y - wl[L.R_WRIST].y, minVis(lm, L.R_ANKLE, L.R_WRIST));
  f.handH = handH.avg;

  // 손목 높이(어깨 기준, m, 위가 +). 차렷 ≈ -0.5, 어깨높이 ≈ 0, 머리 위 ≈ +0.4
  const wristH = sided(
    wl[L.L_SHOULDER].y - wl[L.L_WRIST].y, minVis(lm, L.L_SHOULDER, L.L_WRIST),
    wl[L.R_SHOULDER].y - wl[L.R_WRIST].y, minVis(lm, L.R_SHOULDER, L.R_WRIST));
  f.wristH = wristH.avg; f.wristHMax = wristH.max;
  f.wristHMin = wristH.L != null && Number.isFinite(wristH.L) && Number.isFinite(wristH.R) ? wristH.min : NaN; // 두 손이 다 보일 때 낮은 쪽(손 제스처용)
  f.shoulderOverWrist = -wristH.avg; // 푸시업: 팔 편 상태 ≈ 0.5, 내려가면 ≈ 0.15

  // 코가 어깨보다 얼마나 아래인지(m): 엎드린 푸시업은 ≥ 0 근처, 서거나 앉아 있으면 -0.15 안팎
  const shMidY = (sL.y + sR.y) / 2;
  f.noseDrop = vis(lm[L.NOSE]) >= VIS_MIN && torsoVis >= VIS_MIN ? wl[L.NOSE].y - shMidY : NaN;

  // 무릎 높이 차(m): 스쿼트는 두 무릎 높이가 같고, 런지는 뒷무릎이 바닥 가까이 내려간다
  const kneeVisBoth = Math.min(vis(lm[L.L_KNEE]), vis(lm[L.R_KNEE]));
  f.kneeYDiff = kneeVisBoth >= 0.3 ? Math.abs(wl[L.L_KNEE].y - wl[L.R_KNEE].y) : NaN;

  const ankleVisBoth = Math.min(vis(lm[L.L_ANKLE]), vis(lm[L.R_ANKLE]));
  f.ankleDX = ankleVisBoth >= 0.3 ? Math.abs(wl[L.L_ANKLE].x - wl[L.R_ANKLE].x) : NaN;
  f.ankleDZ = ankleVisBoth >= 0.3 ? Math.abs(wl[L.L_ANKLE].z - wl[L.R_ANKLE].z) : NaN;
  // 무릎 간격(m): 정면에서 스쿼트할 때 무릎이 안으로 모이는지(발목 간격 대비) 판단
  f.kneeDX = kneeVisBoth >= 0.3 ? Math.abs(wl[L.L_KNEE].x - wl[L.R_KNEE].x) : NaN;
  // 정면을 보고 있는지: 어깨가 좌우(x)로 넓게 보이면 정면, 앞뒤(z)로 벌어지면 옆모습
  const sdx = Math.abs(sL.x - sR.x), sdz = Math.abs(sL.z - sR.z);
  f.frontal = sdx / (sdz + 1e-3);

  // 몸 일직선(어깨-엉덩이-발목) 각도와 엉덩이 처짐(+)/들림(-) (m): 플랭크·푸시업 자세 교정용
  const ankleVis = Math.max(vis(lm[L.L_ANKLE]), vis(lm[L.R_ANKLE]));
  if (torsoVis >= VIS_MIN && ankleVis >= VIS_MIN) {
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    const S = mid(sL, sR), H = mid(hL, hR), A = mid(wl[L.L_ANKLE], wl[L.R_ANKLE]);
    f.bodyLine = angle3(S, H, A);
    const ax = A.x - S.x, ay = A.y - S.y, az = A.z - S.z;
    const len2 = ax * ax + ay * ay + az * az;
    const k = len2 ? ((H.x - S.x) * ax + (H.y - S.y) * ay + (H.z - S.z) * az) / len2 : 0;
    f.hipSag = H.y - (S.y + k * ay); // 월드 y는 아래가 + → 양수면 엉덩이가 선보다 아래(처짐)
  } else {
    f.bodyLine = NaN;
    f.hipSag = NaN;
  }

  const wristVisBoth = Math.min(vis(lm[L.L_WRIST]), vis(lm[L.R_WRIST]));
  f.wristDX = wristVisBoth >= 0.3 ? Math.abs(wl[L.L_WRIST].x - wl[L.R_WRIST].x) : NaN;

  // 화면(2D) 정보: 사람이 화면 안에 다 들어왔는지 안내용
  let minX = 1, maxX = 0, minY = 1, maxY = 0, n2d = 0;
  for (const i of [L.NOSE, ...KEY_JOINTS]) {
    const p = lm[i];
    if (vis(p) < VIS_MIN) continue;
    n2d++;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  f.box = n2d ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  // 화면상 어깨 높이(0=위, 1=아래): 풀업처럼 몸 전체가 오르내리는지 보는 용도 (월드 좌표는 엉덩이 기준이라 안 보임)
  const shVis = Math.min(vis(lm[L.L_SHOULDER]), vis(lm[L.R_SHOULDER]));
  f.shY = shVis >= VIS_MIN ? (lm[L.L_SHOULDER].y + lm[L.R_SHOULDER].y) / 2 : NaN;
  // 발뒤꿈치 들림(m): 발끝보다 뒤꿈치가 높을수록 + (카프 레이즈)
  const heel = sided(
    wl[31].y - wl[29].y, minVis(lm, 29, 31),
    wl[32].y - wl[30].y, minVis(lm, 30, 32));
  f.heelLift = heel.avg;
  const edge = 0.02;
  f.cutoff = !!f.box && (minX < edge || maxX > 1 - edge || minY < edge || maxY > 1 - edge);
  // 화면에서 몸통이 차지하는 길이(화면 높이 비율): 말하려고 폰 앞에 바짝 다가오면 0.4 이상(실측 0.46), 운동 중 0.2~0.34
  if (torsoVis >= VIS_MIN) {
    const sx = (lm[11].x + lm[12].x) / 2, sy = (lm[11].y + lm[12].y) / 2;
    const hx = (lm[23].x + lm[24].x) / 2, hy = (lm[23].y + lm[24].y) / 2;
    f.torsoFrac = Math.hypot(sx - hx, sy - hy);
  } else f.torsoFrac = NaN;
  // 부위별로 화면에 보이는지 (안내 문구용)
  const seen = (...idx) => Math.max(...idx.map((i) => vis(lm[i])));
  f.seen = { head: seen(0) >= VIS_MIN, hands: seen(15, 16) >= VIS_MIN, knees: seen(25, 26) >= VIS_MIN, feet: seen(27, 28) >= VIS_MIN };

  // ── 2차 운동(기구·홈트)용 ──
  f.hipMax = hip.max; // 한 다리만 뒤로 차는 동작(동키킥)은 펴진 쪽
  f.kneeMax = knee.max; // 더 펴진 무릎: 네발 자세(동키킥)는 둘 다 굽힘, 마운틴 클라이머는 한쪽이 늘 펴짐
  // 스무딩 안 한 '덜 펴진 엉덩이': 하이니처럼 0.3초마다 다리를 바꾸면 바꾸는 순간(1프레임)이 중앙값 스무딩에 지워진다
  f.hipMinFast = hip.min;
  // 좌우 무릎 굽힘 차이: 사이드 런지·바이시클 크런치는 한쪽만 굽힌다(스쿼트는 양쪽이 같이)
  f.kneeAsym = Number.isFinite(knee.L) && Number.isFinite(knee.R) ? Math.abs(knee.L - knee.R) : NaN;
  // 발 간격을 '몸 기준'으로: 골반 좌우 방향(stanceW, 사이드 런지·와이드 스쿼트)과 앞뒤 방향(stanceD, 런지·스플릿 스쿼트)
  const hAx = norm([hL.x - hR.x, 0, hL.z - hR.z]);
  const hipVis = minVis(lm, L.L_HIP, L.R_HIP);
  if (hAx && hipVis >= 0.3 && ankleVisBoth >= 0.3) {
    const A = [wl[L.L_ANKLE].x - wl[L.R_ANKLE].x, 0, wl[L.L_ANKLE].z - wl[L.R_ANKLE].z];
    f.stanceW = Math.abs(dot(A, hAx));
    f.stanceD = Math.abs(dot(A, [-hAx[2], 0, hAx[0]]));
  } else {
    f.stanceW = NaN;
    f.stanceD = NaN;
  }
  // 두 발목 높이 차(m): 불가리안 스플릿 스쿼트는 뒷발을 벤치에 올린다
  f.ankleYDiff = ankleVisBoth >= 0.3 ? Math.abs(wl[L.L_ANKLE].y - wl[L.R_ANKLE].y) : NaN;
  // 두 손목 사이 3D 거리(m): 플라이(모으기·벌리기)는 보는 방향과 상관없이 이걸로
  f.wristDist = wristVisBoth >= 0.3
    ? Math.hypot(wl[L.L_WRIST].x - wl[L.R_WRIST].x, wl[L.L_WRIST].y - wl[L.R_WRIST].y, wl[L.L_WRIST].z - wl[L.R_WRIST].z) : NaN;
  // 어깨→손목 수평 거리(m): 로우는 손이 높이는 그대로 몸 쪽으로 당겨진다
  const reach = sided(
    Math.hypot(wl[L.L_WRIST].x - sL.x, wl[L.L_WRIST].z - sL.z), minVis(lm, L.L_SHOULDER, L.L_WRIST),
    Math.hypot(wl[L.R_WRIST].x - sR.x, wl[L.R_WRIST].z - sR.z), minVis(lm, L.R_SHOULDER, L.R_WRIST));
  f.reach = reach.avg;
  // 손이 골반 중심에서 좌우로 얼마나 갔는지(m, 부호 있음): 러시안 트위스트
  if (hAx && hipVis >= 0.3 && Math.max(vis(lm[L.L_WRIST]), vis(lm[L.R_WRIST])) >= 0.3) {
    const wv = [vis(lm[L.L_WRIST]), vis(lm[L.R_WRIST])];
    const wx = (wl[L.L_WRIST].x * wv[0] + wl[L.R_WRIST].x * wv[1]) / (wv[0] + wv[1]);
    const wz = (wl[L.L_WRIST].z * wv[0] + wl[L.R_WRIST].z * wv[1]) / (wv[0] + wv[1]);
    f.handSide = dot([wx - (hL.x + hR.x) / 2, 0, wz - (hL.z + hR.z) / 2], hAx);
  } else f.handSide = NaN;
  // 가슴이 향하는 방향의 위아래 성분: +1 = 천장(누움), -1 = 바닥(엎드림), 0 = 서 있음·옆으로 누움.
  // 코 위치(noseDrop)는 크런치처럼 고개를 들면 틀어져서, 몸통 면의 방향으로 본다(왼어깨-오른어깨 × 엉덩이→어깨)
  if (torsoVis >= VIS_MIN) {
    const across = [sL.x - sR.x, sL.y - sR.y, sL.z - sR.z];
    const along = [(sL.x + sR.x - hL.x - hR.x) / 2, (sL.y + sR.y - hL.y - hR.y) / 2, (sL.z + sR.z - hL.z - hR.z) / 2];
    const fwd = norm(cross(across, along));
    f.chestUp = fwd ? -fwd[1] : NaN;
  } else f.chestUp = NaN;
  // 어깨선이 수평에서 얼마나 섰는지(도): 사이드 플랭크는 어깨가 위아래로 포개진다(플랭크·서 있기는 0 근처)
  const shLen = Math.hypot(sL.x - sR.x, sL.y - sR.y, sL.z - sR.z);
  f.shRoll = torsoVis >= VIS_MIN && shLen ? Math.asin(Math.min(1, Math.abs(sL.y - sR.y) / shLen)) * DEG : NaN;

  return f;
}

/** 두 손을 머리 위로 쭉 뻗고 서 있는지 (휴식 끝내기 손 제스처) */
export const isHandsUp = (f) => !!f && f.wristHMin > 0.12 && f.elbow > 135 && !(f.torsoTilt > 35);

// 스무딩 대상 특징 (나머지는 원본 그대로)
export const SMOOTH_KEYS = [
  'knee', 'kneeMin', 'kneeL', 'kneeR', 'hip', 'hipMin', 'elbow', 'elbowMin', 'elbowL', 'elbowR', 'arm', 'armMax', 'torsoTilt', 'hipH', 'hipHAbs', 'handH',
  'wristH', 'wristHMax', 'shoulderOverWrist', 'kneeYDiff', 'ankleDX', 'ankleDZ', 'wristDX',
  'kneeDX', 'frontal', 'bodyLine', 'hipSag', 'shY', 'heelLift', 'noseDrop', 'torsoFrac',
  'hipMax', 'kneeMax', 'kneeAsym', 'stanceW', 'stanceD', 'ankleYDiff', 'wristDist', 'reach', 'handSide', 'shRoll', 'chestUp',
];
