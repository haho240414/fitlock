// 운동 정의 (판정 규칙표).
// - signal: 반복 카운터에 넣을 1차원 신호. 힘주는 구간이 '낮은 값'이 되도록 부호를 맞춘다.
// - prom: 1회로 인정할 최소 진폭 (신호 단위: 미터 또는 도)
// - check(w, b, rep): 반복 1회 구간(w)·최저점 부근(b) 프레임·반복 정보(rep.top/bottom)로 '이 운동이 맞는지' 검사.
//   [이름, 결과, 종류] — 결과는 true(통과)/false(탈락)/null(모름: 그 부위가 화면에 안 보임)
//   종류 'core' = 이 운동이라고 볼 핵심 조건. 자동 인식에선 반드시 '통과'여야 하고, 운동을 직접 고르면 '탈락'만 아니면 된다.
//   종류 'soft' = 비슷한 운동끼리 가르는 보조 조건. 자동 인식에서만 쓴다.
//   종류 없음  = 보통 조건. 자동 인식에서 '탈락'이면 막고 '모름'은 넘어간다. 운동을 직접 고르면 안 본다.
//   (실사용에서 발·무릎이 화면 밖이거나 폰이 기울어도 세도록: '모름'을 탈락으로 치지 않는다 — test/robust.mjs)
// - form(w, b): 자세 교정. [코드, 문제있음?, 짧은 음성 신호, 설명]. 값을 모르면 문제로 보지 않는다.
// - tempo: 템포·속도 그래프용. first = 반복의 앞 구간(신호가 내려가는 쪽)이 힘주기('con')인지 돌아오기('ecc')인지,
//   con/ecc = 화면에 쓸 구간 이름, dist = 속도를 m/s 로 잴 거리 신호(m). 없으면 템포를 재지 않는다(점핑잭 등).
// - verified: 실제 영상으로 횟수를 확인한 운동인지 (false 면 화면에 '베타' 표시)
// 숫자는 실제 영상 측정값으로 조정한다 (test/eval.mjs, README '검증' 참고).

const vals = (w, k) => w.map((f) => f[k]).filter(Number.isFinite).sort((a, b) => a - b);

/** 백분위수 (자료가 3개 미만이면 NaN = 모름) */
export function P(w, k, q) {
  const a = vals(w, k);
  if (a.length < 3) return NaN;
  const i = (a.length - 1) * q / 100;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
export const M = (w, k) => P(w, k, 50);
export const R = (w, k) => P(w, k, 90) - P(w, k, 10);
// 한 팔씩 하는 동작도 잡도록 좌우 중 더 크게 움직인 쪽의 범위 (한쪽이 안 보이면 보이는 쪽)
const RS = (w, a, b) => {
  const ra = R(w, a), rb = R(w, b);
  return Number.isFinite(ra) && Number.isFinite(rb) ? Math.max(ra, rb) : Number.isFinite(ra) ? ra : rb;
};

// 3단 논리 (true / false / null=모름)
const fin = Number.isFinite;
export const gt = (a, b) => (fin(a) ? a > b : null);
export const lt = (a, b) => (fin(a) ? a < b : null);
export const between = (a, lo, hi) => (fin(a) ? a > lo && a < hi : null);
export const and = (...xs) => (xs.includes(false) ? false : xs.includes(null) ? null : true);
export const or = (...xs) => (xs.includes(true) ? true : xs.includes(null) ? null : false);
export const not = (x) => (x === null ? null : !x);

// 다리가 고정인지 (점핑잭이 아닌지)
const legsStill = (w) => not(gt(R(w, 'ankleDX'), 0.2));
// 가까이서 말하며 손짓하는 것과 구분: 하체가 보이거나, 몸통이 화면 높이의 40% 미만(실측: 말할 때 46%, 운동 중 20~34%)
const atDistance = (w) => or(gt(M(w, 'visLegs'), 0.55), lt(M(w, 'torsoFrac'), 0.4));
// 엎드린 자세(얼굴이 바닥 쪽): 푸시업·플랭크 계열. 앉거나 누운 자세와 구분
const faceDown = (w) => gt(M(w, 'noseDrop'), -0.1);
// 서 있는 동작: 발목이 보이면 엉덩이 높이로(힙 쓰러스트 아래 자세도 상체는 25°만 기울어 '서 있음'처럼 보인다),
// 안 보일 때만 위쪽 끝에서 상체가 서 있는지로
const standing = (w) => (fin(P(w, 'hipH', 90)) ? gt(P(w, 'hipH', 90), 0.55) : lt(P(w, 'torsoTilt', 10), 30));
// 팔을 가장 높이 든 순간들(손목 높이 상위 25%)의 값 — 위에서 잡은 손 간격(바 vs 덤벨) 판단용
const atTop = (w, key) => {
  const t = P(w, 'wristH', 75);
  if (!fin(t)) return NaN;
  const xs = w.filter((f) => f.wristH >= t).map((f) => f[key]).filter(fin).sort((a, b) => a - b);
  return xs.length >= 2 ? xs[xs.length >> 1] : NaN;
};
// 실측: 바를 잡는 랫풀다운·풀업은 위에서 손 간격 0.48~0.60m, 덤벨 숄더 프레스 0.33~0.37m, 한 팔 프레스·트라이셉 0.03~0.17m
const barGrip = (w) => gt(atTop(w, 'wristDX'), 0.45);

export const GROUPS = ['하체', '가슴·어깨', '등', '팔', '코어', '유산소'];

export const EXERCISES = [
  // ───────── 하체 ─────────
  {
    id: 'squat', name: '스쿼트', group: '하체', unit: '회', kind: 'reps', priority: 9, verified: true,
    tip: '정면 또는 옆에서 무릎까지는 꼭 보이게',
    // 신호: 엉덩이 관절 각도(어깨-엉덩이-무릎). 발목이 화면 밖이어도 무릎까지만 보이면 센다.
    // 실측: 선 자세 160~166°, 바닥 33(측면)~93°(정면)
    signal: (f) => f.hip, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '앉기', con: '일어서기', dist: (f) => f.hipH },
    check: (w, b) => [
      ['서서 하는 동작', standing(w), 'core'],
      ['상체가 너무 숙여지지 않음', lt(M(w, 'torsoTilt'), 55)],
      ['무릎을 굽힘', and(lt(P(w, 'knee', 10), 130), gt(R(w, 'knee'), 25))],
      ['엉덩이만 접는 동작 아님(데드리프트 아님)', not(and(gt(P(w, 'torsoTilt', 90), 60), gt(P(w, 'knee', 10), 90))), 'soft'],
      ['두 무릎 높이가 비슷(런지 아님)', lt(M(b, 'kneeYDiff'), 0.2), 'soft'],
      // 실측: 스쿼트는 좌우 무릎 차 25° 이하·몸 기준 발 간격 0.3~0.6m, 사이드 런지는 77°까지·0.73~0.85m
      ['바에 매달리지 않음(행잉 레그 레이즈 아님)', not(gt(P(w, 'wristH', 10), 0.2)), 'soft'],
      ['양쪽 무릎을 같이 굽힘(사이드 런지 아님)', not(and(gt(M(b, 'kneeAsym'), 35), gt(M(b, 'stanceW'), 0.55))), 'soft'],
      ['팔을 머리 위로 흔들지 않음', not(and(gt(P(w, 'wristH', 90), 0.15), gt(R(w, 'wristH'), 0.5))), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    // 실측: 제대로 앉은 스쿼트는 바닥에서 무릎각 55~71°, 엉덩이각 33~93°, 정면 무릎/발목 간격비 1.09~1.24
    form: (w, b) => [
      ['shallow', fin(P(w, 'knee', 10)) ? P(w, 'knee', 10) > 100 : P(w, 'hip', 10) > 125, '더 깊게', '허벅지가 바닥과 평행해질 때까지 앉아 보세요'],
      ['kneesIn', M(b, 'frontal') > 4 && M(b, 'kneeDX') / M(b, 'ankleDX') < 0.85, '무릎 바깥으로', '무릎이 안쪽으로 모였어요. 발끝 방향으로 밀어주세요'],
      ['lean', M(b, 'torsoTilt') > 60, '가슴 펴기', '상체가 많이 숙여졌어요. 가슴을 세우고 앉으세요'],
    ],
  },
  {
    id: 'lunge', name: '런지', group: '하체', unit: '회', kind: 'reps', priority: 8, verified: true,
    tip: '옆이나 대각선에서 두 무릎이 다 보이게',
    // 신호: 앞다리 엉덩이 각도(좌우 중 작은 쪽)
    signal: (f) => f.hipMin, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '내려가기', con: '올라오기', dist: (f) => f.hipH },
    check: (w, b) => [
      ['서서 하는 동작', standing(w), 'core'],
      ['앞뒤로 다리를 벌림(뒷무릎이 내려감)', gt(M(b, 'kneeYDiff'), 0.2), 'core'],
      ['상체를 세움', lt(M(w, 'torsoTilt'), 45)],
      ['무릎을 굽힘', lt(P(w, 'knee', 10), 140)],
      ['뒷발을 올리지 않음(불가리안 스플릿 스쿼트 아님)', not(gt(P(w, 'ankleYDiff', 90), 0.22)), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    // 실측: 바닥에서 무릎각 60~96°, 상체 기울기 7~24°
    form: (w, b) => [
      ['shallow', M(b, 'kneeMin') > 110, '더 깊게', '뒷무릎이 바닥에 가까워질 때까지 내려가세요'],
      ['lean', M(b, 'torsoTilt') > 35, '상체 세우기', '상체를 세우고 내려가세요'],
    ],
  },
  {
    id: 'deadlift', name: '데드리프트', group: '하체', unit: '회', kind: 'reps', priority: 8, verified: true,
    tip: '옆에서 머리~무릎이 보이게 (루마니안 포함)',
    // 엉덩이를 접는 동작(힌지). 바닥에서 시작하므로 첫 '들어올리기'도 1회로 센다(leadIn)
    // 실측: 바닥 무릎각 컨벤셔널 100~108°·루마니안 137~146°, 몸통 기울기 68~88°, 엉덩이 높이 0.48(컨벤셔널)~0.69m
    signal: (f) => -f.torsoTilt, prom: 25, minDur: 0.6, maxDur: 10, leadIn: true,
    tempo: { first: 'ecc', ecc: '내리기', con: '들기', dist: (f) => f.handH },
    check: (w) => [
      ['엉덩이를 접었다 폄', and(gt(R(w, 'hip'), 45), gt(P(w, 'torsoTilt', 90), 40)), 'core'],
      ['끝까지 일어섬', lt(P(w, 'torsoTilt', 10), 30)],
      ['서서 하는 동작(엉덩이가 바닥까지 안 내려감)', gt(P(w, 'hipH', 10), 0.35)],
      ['무릎은 조금만 굽힘(스쿼트 아님)', gt(P(w, 'knee', 10), 90)],
      ['상체가 수평을 넘지 않음(버피 아님)', lt(P(w, 'torsoTilt', 90), 105)],
      ['팔은 아래로(케틀벨 스윙 아님)', lt(P(w, 'wristH', 90), -0.25), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    // 끝까지 섰는지(록아웃)는 횟수를 세는 순간(올라오는 도중)엔 아직 알 수 없어 교정 규칙에서 뺐다 — 실측 오경보 2/3회
  },
  {
    id: 'calf', name: '카프 레이즈', group: '하체', unit: '회', kind: 'reps', priority: 3, verified: false,
    tip: '옆에서 발끝·뒤꿈치가 잘 보이게',
    // 실측: 뒤꿈치가 발끝보다 약 3cm 올라감 → 작은 움직임이라 잡음에 약함(베타)
    signal: (f) => -f.heelLift, prom: 0.02, minDur: 0.5, maxDur: 6,
    tempo: { first: 'con', con: '올리기', ecc: '내리기', dist: (f) => f.heelLift },
    check: (w) => [
      ['서서 무릎을 폄', gt(P(w, 'knee', 10), 150), 'core'],
      ['상체를 세움', lt(M(w, 'torsoTilt'), 25)],
      ['몸 전체가 위로 올라감', gt(R(w, 'shY'), 0.012), 'soft'],
      ['팔은 고정', lt(R(w, 'wristH'), 0.15), 'soft'],
    ],
  },

  {
    id: 'legpress', name: '레그 프레스', group: '하체', unit: '회', kind: 'reps', priority: 5, verified: false,
    tip: '옆에서 엉덩이~발끝이 보이게 (기구에 다리가 덜 가리는 쪽)',
    // 등을 기대고 누운 자세로 발판을 밀어냄. 기구에 다리가 가려 관절이 자주 튀어서 베타.
    // 실측: 몸통 63~77°(기댐), 발이 엉덩이보다 0.15~0.55m 위, 무릎 92~103° ↔ 150~157°
    signal: (f) => f.knee, prom: 35, minDur: 0.6, maxDur: 8,
    tempo: { first: 'ecc', ecc: '내리기', con: '밀기', dist: (f) => f.hipH },
    check: (w) => [
      ['등을 기대고 발이 엉덩이보다 위', and(between(M(w, 'torsoTilt'), 35, 85), lt(M(w, 'hipH'), -0.1)), 'core'],
      ['무릎을 굽혔다 폄', and(lt(P(w, 'knee', 10), 115), gt(P(w, 'knee', 90), 135)), 'core'],
      ['엉덩이도 같이 접힘', gt(R(w, 'hip'), 25)],
      ['얼굴이 위(엎드린 자세 아님)', not(faceDown(w))],
    ],
  },
  {
    id: 'legext', name: '레그 익스텐션', group: '하체', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆이나 대각선에서 무릎~발끝이 보이게',
    // 기구에 앉아 무릎만 폈다 굽힘. 실측: 무릎 87~97° → 150~160°, 엉덩이 각 91~109°(앉음), 몸통 9~15°, 발이 0.35m 올라옴
    signal: (f) => -f.knee, prom: 35, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '펴기', ecc: '내리기', dist: (f) => f.hipH },
    check: (w) => [
      ['앉은 자세', and(between(M(w, 'hip'), 70, 130), lt(M(w, 'torsoTilt'), 40)), 'core'],
      ['무릎을 굽힌 상태에서 폄', and(lt(P(w, 'knee', 10), 115), gt(P(w, 'knee', 90), 135)), 'core'],
      ['발이 앞으로 올라옴', gt(R(w, 'hipH'), 0.15)],
      ['엉덩이는 고정(스쿼트 아님)', lt(R(w, 'hip'), 30)],
      ['팔은 고정', lt(R(w, 'wristH'), 0.15), 'soft'],
    ],
  },
  {
    id: 'legcurl', name: '레그 컬', group: '하체', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆에서 엉덩이~발끝이 보이게 (엎드려 하는 기구)',
    // 엎드려 발뒤꿈치를 엉덩이 쪽으로 당김. 실측: 무릎 160~169° → 60~70°, 몸통 95~100°, 엉덩이 각 140~150° 유지
    signal: (f) => f.knee, prom: 40, minDur: 0.6, maxDur: 8,
    tempo: { first: 'con', con: '당기기', ecc: '펴기', dist: (f) => f.hipH },
    check: (w) => [
      ['엎드린 자세', and(gt(M(w, 'torsoTilt'), 65), faceDown(w)), 'core'],
      ['무릎을 깊게 굽힘', and(lt(P(w, 'knee', 10), 100), gt(R(w, 'knee'), 50)), 'core'],
      ['엉덩이는 펴진 채(마운틴 클라이머 아님)', gt(P(w, 'hip', 10), 115)],
      ['팔로 몸을 밀지 않음(푸시업 아님)', lt(R(w, 'shoulderOverWrist'), 0.1), 'soft'],
    ],
  },
  {
    id: 'sidelunge', name: '사이드 런지', group: '하체', unit: '회', kind: 'reps', priority: 7, verified: true,
    tip: '정면에서 양발 끝까지 보이게',
    // 발을 옆으로 넓게 벌리고 한쪽 무릎만 굽혀 앉음 — 한쪽 1회.
    // 실측: 굽힌 무릎 69~109°·반대 무릎 145~171°(차이 46~87°), 몸 기준 좌우 발 간격 0.7~0.85m (스쿼트 0.3~0.6m)
    signal: (f) => f.kneeMin, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '앉기', con: '일어서기', dist: (f) => f.hipH },
    check: (w, b) => [
      ['서서 하는 동작', standing(w), 'core'],
      ['발을 옆으로 넓게 벌림', gt(M(b, 'stanceW'), 0.55), 'core'],
      ['한쪽 무릎만 굽힘', gt(M(b, 'kneeAsym'), 35), 'core'],
      ['앞뒤로 벌리지 않음(런지 아님)', lt(M(b, 'stanceD'), 0.35), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
  },
  {
    id: 'bulgarian', name: '불가리안 스플릿 스쿼트', group: '하체', unit: '회', kind: 'reps', priority: 7, verified: false,
    tip: '옆이나 대각선에서 두 다리가 다 보이게',
    // 뒷발을 벤치에 올리고 앞다리로 앉았다 일어섬. 실측: 선 자세 두 발목 높이 차 0.43~0.47m(런지 0.18 이하),
    // 앉으면 뒷발이 가려져 0.1대로 작게 잡히므로 반복 구간의 최댓값(P90)으로 본다. 앞다리 엉덩이 각 160° → 67°
    signal: (f) => f.hipMin, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '내려가기', con: '올라오기', dist: (f) => f.hipH },
    check: (w) => [
      // 실측(옆모습): AI가 좌우 다리를 바꿔 잡아 0.25~0.31m로 작게 나옴 → 런지(0.18 이하)와의 사이로
      ['뒷발을 높이 올림', gt(P(w, 'ankleYDiff', 90), 0.22), 'core'],
      ['앞무릎을 굽힘', lt(P(w, 'kneeMin', 10), 110), 'core'],
      ['엉덩이가 내려갔다 올라옴', gt(R(w, 'hipH'), 0.08)],
      ['상체가 수평까지 숙여지지 않음', lt(M(w, 'torsoTilt'), 60)],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
  },
  {
    id: 'wallsit', name: '벽 스쿼트(월 싯)', group: '하체', unit: '초', kind: 'hold', priority: 3, verified: false, auto: false,
    tip: '옆에서 머리~발끝이 보이게',
    // 의자·벤치에 앉아 쉬는 자세와 구별이 안 돼서 자동 인식에선 빼고, 골라서 시작할 때만 잰다
    // 실측: 무릎 109~117°(정면은 덜 굽게 보임), 엉덩이 각 101~119°, 몸통 1~13°, 엉덩이 높이 0.38~0.53m
    pose: (f) => f.torsoTilt < 30 && f.knee > 70 && f.knee < 135 && f.hip > 70 && f.hip < 135
      && !(f.hipH >= 0.62) && !(f.hipH <= 0.2),
    still: (w) => R(w, 'hip') < 15 && !(R(w, 'knee') >= 15),
  },
  {
    id: 'donkey', name: '동키킥', group: '하체', unit: '회', kind: 'reps', priority: 5, verified: false,
    tip: '옆에서 머리~발끝이 보이게',
    // 네발 자세에서 한 다리를 뒤로 차올림. 실측: 차는 다리 엉덩이 각 92~98° → 131~142°, 몸통 82~86°, 팔은 편 채
    // 처음 본 영상(donkey_puregym)은 쉬는 자세가 113~118° → 156~164°: 사람마다 달라서 절대값 대신 차올린 폭으로
    signal: (f) => -f.hipMax, prom: 25, minDur: 0.5, maxDur: 6,
    tempo: { first: 'con', con: '차올리기', ecc: '내리기' },
    check: (w) => [
      ['네발 자세(엎드려 팔로 지탱)', and(gt(M(w, 'torsoTilt'), 60), gt(P(w, 'shoulderOverWrist', 10), 0.3), faceDown(w)), 'core'],
      ['다리를 뒤로 차올림', and(gt(P(w, 'hipMax', 90), 128), gt(R(w, 'hipMax'), 28)), 'core'],
      // 실측: 더 펴진 무릎 중앙값 동키킥 88~115° / 마운틴 클라이머 151°(한 다리는 늘 펴짐)
      ['무릎을 꿇은 채(마운틴 클라이머 아님)', lt(M(w, 'kneeMax'), 140)],
      ['팔은 편 채 유지(푸시업 아님)', lt(R(w, 'shoulderOverWrist'), 0.1)],
    ],
  },

  // ───────── 가슴·어깨 ─────────
  {
    id: 'pushup', name: '푸시업', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 9, verified: true,
    tip: '옆이나 대각선에서 머리~발끝이 한 화면에',
    signal: (f) => f.shoulderOverWrist, prom: 0.08, minDur: 0.4, maxDur: 8,
    tempo: { first: 'ecc', ecc: '내려가기', con: '밀기', dist: (f) => f.shoulderOverWrist },
    check: (w) => [
      ['엎드린 자세', gt(M(w, 'torsoTilt'), 45), 'core'],
      ['손으로 바닥을 짚음', gt(P(w, 'shoulderOverWrist', 90), 0.2), 'core'],
      ['얼굴이 바닥 쪽', faceDown(w)],
      ['몸을 일직선으로 유지(힙 쓰러스트 아님)', and(lt(R(w, 'torsoTilt'), 25), gt(P(w, 'hip', 10), 130))],
      ['몸이 바닥 가까이', lt(M(w, 'hipH'), 0.5)],
      ['팔을 굽혔다 폄', and(gt(R(w, 'elbow'), 25), lt(P(w, 'elbow', 10), 140)), 'soft'],
    ],
    form: (w) => [
      ['shallow', P(w, 'elbow', 10) > 115, '더 깊게', '가슴이 바닥 가까이 가도록 내려가세요'],
      ['sag', M(w, 'hipSag') > 0.08, '엉덩이 올리기', '허리가 처졌어요. 배에 힘을 주고 몸을 일직선으로'],
      ['pike', M(w, 'hipSag') < -0.12, '엉덩이 내리기', '엉덩이가 너무 높아요. 머리부터 발끝까지 일직선으로'],
    ],
  },
  {
    id: 'bench', name: '벤치 프레스', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '벤치 옆에서 팔과 몸통이 보이게',
    // 누워서 손을 위로 밀어올림 → 손목이 어깨보다 위(+). 가슴까지 내리면 작아짐
    signal: (f) => f.wristH, prom: 0.15, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '내리기', con: '밀기', dist: (f) => f.wristH },
    check: (w) => [
      ['누운 자세', between(M(w, 'torsoTilt'), 60, 120), 'core'],
      ['팔을 위로 밀어올림', gt(P(w, 'wristH', 90), 0.3), 'core'],
      ['팔꿈치를 굽혔다 폄', gt(RS(w, 'elbowL', 'elbowR'), 30)],
      ['엉덩이는 고정(브릿지 아님)', lt(R(w, 'hip'), 25), 'soft'],
    ],
    form: (w) => [
      ['lockout', P(w, 'wristH', 90) < 0.35, '끝까지 밀기', '팔을 끝까지 펴서 밀어올리세요'],
    ],
  },
  {
    id: 'press', name: '숄더 프레스', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '정면에서 머리 위 손끝까지 보이게',
    signal: (f) => -f.wristH, prom: 0.18, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '밀기', ecc: '내리기', dist: (f) => f.wristH },
    check: (w, b) => [
      ['상체를 세움', lt(M(w, 'torsoTilt'), 35), 'core'],
      ['머리 위로 밀어올림', gt(P(w, 'wristH', 90), 0.12), 'core'],
      // 점핑잭(팔 편 채 엉덩이~머리 위)과 구분: 팔꿈치를 굽혔다 펴거나, 어깨 높이에서 밀어올림
      ['어깨 높이에서 밀어올림', or(gt(RS(w, 'elbowL', 'elbowR'), 30), gt(P(w, 'wristH', 10), -0.3))],
      ['몸은 제자리(풀업 아님)', not(gt(R(w, 'shY'), 0.1))],
      ['팔꿈치가 어깨 높이까지 내려옴(트라이셉 아님)', lt(P(w, 'arm', 10), 125), 'soft'],
      ['위에서 팔을 폄(업라이트 로우 아님)', not(lt(M(b, 'elbow'), 130)), 'soft'],
      // 바를 넓게 잡고 앉아서 당기면 랫풀다운 (서서 하는 바벨 프레스는 무릎이 펴져 있어 통과)
      // 바 간격인데 '선 자세'가 확인 안 되면(무릎이 기구에 가려진 경우 포함) 랫풀다운으로 본다
      ['덤벨 간격이거나 선 자세(랫풀다운 아님)', !(barGrip(w) === true && gt(M(w, 'knee'), 150) !== true), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    // 실측: 끝까지 밀면 손목이 어깨보다 0.42~0.44m 위
    form: (w) => [
      ['lockout', P(w, 'wristH', 90) < 0.3, '끝까지 밀기', '팔을 머리 위로 끝까지 뻗으세요'],
    ],
  },
  {
    id: 'lateral', name: '사이드 레터럴 레이즈', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면에서 양팔 끝까지 보이게',
    signal: (f) => -f.wristH, prom: 0.18, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '올리기', ecc: '내리기', dist: (f) => f.wristH },
    check: (w, b) => [
      ['상체를 세움', lt(M(w, 'torsoTilt'), 35), 'core'],
      ['팔을 내린 상태에서 시작', lt(P(w, 'wristH', 10), -0.3), 'core'],
      ['어깨 높이까지 들어올림', between(P(w, 'wristH', 90), -0.3, 0.2), 'soft'],
      ['팔을 옆으로 벌림(프론트 레이즈 아님)', gt(M(b, 'wristDX'), 0.7), 'soft'],
      ['팔꿈치를 거의 폄', gt(P(w, 'elbow', 10), 110), 'soft'],
      ['다리는 고정', legsStill(w), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    // 실측: 어깨 높이까지 올리면 손목이 어깨보다 0.08~0.11m 위, 양 손목 간격 1.05~1.11m
    form: (w) => [
      ['low', P(w, 'wristH', 90) < -0.15, '어깨 높이까지', '팔을 어깨 높이까지 들어올리세요'],
      ['high', P(w, 'wristH', 90) > 0.25, '너무 높아요', '어깨보다 높이 올리면 승모근이 개입해요'],
    ],
  },
  {
    id: 'frontraise', name: '프론트 레이즈', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆이나 대각선에서 팔 전체가 보이게',
    // 실측: 위에서 양 손목 간격 0.05~0.47m (옆으로 벌리는 레터럴은 1m 이상)
    signal: (f) => -f.wristH, prom: 0.15, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '올리기', ecc: '내리기', dist: (f) => f.wristH },
    check: (w, b) => [
      ['상체를 세움', lt(M(w, 'torsoTilt'), 35), 'core'],
      ['팔을 내린 상태에서 시작', lt(P(w, 'wristH', 10), -0.3), 'core'],
      ['팔을 앞으로 듦', and(lt(M(b, 'wristDX'), 0.7), gt(P(w, 'wristHMax', 90), -0.3))],
      ['상체 고정(케틀벨 스윙 아님)', lt(R(w, 'torsoTilt'), 20)],
      ['팔꿈치를 거의 폄', gt(P(w, 'elbow', 10), 110), 'soft'],
      ['다리는 고정', legsStill(w), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
  },

  {
    id: 'fly', name: '체스트 플라이', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면이나 대각선에서 양팔 끝까지 보이게 (덤벨·펙덱·케이블)',
    // 팔을 몸통과 수직으로 둔 채 양손을 벌렸다 모음. 누워서 하는 덤벨은 모은 채 시작, 펙덱은 벌린 채 시작(leadIn)
    // 실측: 손목 간격 0.18~0.46 ↔ 1.07~1.25m, 팔 각도 63~104°, 팔꿈치 128~157°(살짝 굽힘)
    signal: (f) => -f.wristDist, prom: 0.25, minDur: 0.5, maxDur: 8, leadIn: true,
    tempo: { first: 'ecc', ecc: '벌리기', con: '모으기', dist: (f) => f.wristDist },
    check: (w) => [
      ['양손을 벌렸다 모음', and(gt(R(w, 'wristDist'), 0.3), lt(P(w, 'wristDist', 10), 0.6)), 'core'],
      // 실측: 정면·대각선 63~104°, 발 쪽에서 본 누운 플라이는 원근 때문에 137°까지
      ['팔을 몸통과 수직으로(레이즈·프레스 아님)', and(gt(P(w, 'arm', 10), 45), lt(P(w, 'arm', 90), 145)), 'core'],
      ['팔꿈치는 살짝만 굽힘(프레스 아님)', gt(P(w, 'elbow', 10), 105)],
      ['숙인 자세 아님(리어 델트 플라이 아님)', not(and(between(M(w, 'torsoTilt'), 30, 75), faceDown(w))), 'soft'],
      // 손이 화면 밖이면 AI 가 손목을 지어내 '손 간격'이 출렁인다(매달려 다리를 드는 근접 장면을 플라이로 셌음):
      // 플라이는 다리를 움직이지 않으니 엉덩이 각도가 크게 변하면 아니다(그 장면 85~175°)
      ['하체는 그대로(다리 운동 아님)', lt(R(w, 'hip'), 40)],
    ],
  },
  {
    id: 'uprightrow', name: '업라이트 로우', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면에서 양팔 끝까지 보이게',
    // 팔꿈치를 굽힌 채 어깨 높이 이상으로 끌어올림. 실측: 팔꿈치 145° → 위에서 113~125°, 팔 들림 22 → 117~125°, 손목 간격 0.45~0.5m
    signal: (f) => -f.wristH, prom: 0.25, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '끌어올리기', ecc: '내리기', dist: (f) => f.wristH },
    check: (w, b) => [
      ['상체를 세움', lt(M(w, 'torsoTilt'), 35), 'core'],
      ['팔을 내린 상태에서 시작', lt(P(w, 'wristH', 10), -0.3), 'core'],
      ['팔꿈치를 굽혀 끌어올림', and(lt(M(b, 'elbow'), 130), gt(P(w, 'arm', 90), 75)), 'core'],
      ['손은 몸 가까이(레터럴 레이즈 아님)', lt(M(b, 'wristDX'), 0.75)],
      ['다리는 고정', legsStill(w), 'soft'],
    ],
  },
  {
    id: 'reversefly', name: '리어 델트 플라이', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: false,
    tip: '정면이나 옆에서 숙인 상체와 양팔이 보이게',
    // 상체를 숙인 채 팔을 옆으로 벌려 올림. 실측(정면): 몸통 43~57°, 손목 간격 0.07 → 1.3m, 팔꿈치 150° 이상
    signal: (f) => -f.wristDist, prom: 0.3, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '벌리기', ecc: '모으기', dist: (f) => f.wristDist },
    check: (w) => [
      ['상체를 숙임', between(M(w, 'torsoTilt'), 30, 95), 'core'],
      ['상체 고정(데드리프트 아님)', lt(R(w, 'torsoTilt'), 20), 'core'],
      ['양팔을 벌림', gt(R(w, 'wristDist'), 0.4), 'core'],
      ['팔꿈치를 거의 폄(로우 아님)', gt(P(w, 'elbow', 10), 120)],
      ['서서 하는 동작', gt(P(w, 'hipH', 50), 0.4), 'soft'],
    ],
  },

  // ───────── 등 ─────────
  {
    id: 'pullup', name: '풀업·친업', group: '등', unit: '회', kind: 'reps', priority: 7, verified: true,
    tip: '정면에서 바와 발끝까지 보이게 (멀리 두세요)',
    // 매달린 자세에서 몸을 끌어올림 → 손목-어깨 거리가 줄고, 화면에서 어깨가 위로 올라간다
    // 실측: 매달림 손목 높이 0.46m → 당긴 끝 0.0~0.06m, 화면상 어깨 0.44 → 0.24
    signal: (f) => f.wristH, prom: 0.2, minDur: 0.6, maxDur: 8,
    tempo: { first: 'con', con: '당기기', ecc: '내려가기', dist: (f) => f.wristH },
    check: (w, b) => [
      ['바에 매달림(팔이 머리 위)', gt(P(w, 'wristH', 90), 0.3), 'core'],
      ['몸이 위로 올라감', gt(P(w, 'shY', 90) - M(b, 'shY'), 0.08), 'core'],
      ['팔을 당김', gt(RS(w, 'elbowL', 'elbowR'), 40)],
      ['상체를 세움', lt(M(w, 'torsoTilt'), 40)],
    ],
    form: (w) => [
      ['partial', P(w, 'wristH', 10) > 0.15, '더 높이', '턱이 바 위로 올라오도록 당기세요'],
    ],
  },
  {
    id: 'latpulldown', name: '랫풀다운', group: '등', unit: '회', kind: 'reps', priority: 4, verified: true,
    tip: '앞이나 대각선에서 팔 전체가 보이게',
    // 앉아서 바를 당김 → 풀업과 팔 모양은 같지만 몸은 제자리
    signal: (f) => f.wristH, prom: 0.2, minDur: 0.6, maxDur: 8,
    tempo: { first: 'con', con: '당기기', ecc: '풀기', dist: (f) => f.wristH },
    check: (w, b) => [
      ['팔을 위로 뻗은 자세에서 시작', gt(P(w, 'wristH', 90), 0.3), 'core'],
      ['몸은 제자리(풀업 아님)', not(gt(P(w, 'shY', 90) - M(b, 'shY'), 0.05)), 'core'],
      ['팔을 당김', gt(RS(w, 'elbowL', 'elbowR'), 40)],
      ['상체를 세움', lt(M(w, 'torsoTilt'), 40)],
      ['바를 넓게 잡음(숄더 프레스 아님)', and(barGrip(w), not(gt(M(w, 'knee'), 150))), 'soft'],
    ],
  },
  {
    id: 'row', name: '바벨·덤벨 로우', group: '등', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '옆에서 숙인 상체와 팔이 보이게',
    // 상체를 숙인 채 팔꿈치를 뒤로 당김
    signal: (f) => f.elbowMin, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '당기기', ecc: '풀기' },
    check: (w) => [
      ['상체를 숙임', between(M(w, 'torsoTilt'), 35, 85), 'core'],
      ['상체 고정(데드리프트 아님)', lt(R(w, 'torsoTilt'), 20), 'core'],
      ['팔을 당김', lt(P(w, 'elbowMin', 10), 120)],
      ['서서 하는 동작', gt(P(w, 'hipH', 50), 0.4)],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
  },

  {
    id: 'seatedrow', name: '시티드 로우', group: '등', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆이나 대각선에서 팔과 몸통이 보이게 (케이블·머신)',
    // 앉아서 손잡이를 배 쪽으로 당김 — 손 높이는 그대로, 어깨 쪽으로 가까워짐
    // 실측: 팔꿈치 135~142° → 82~92°, 손목 높이 -0.21~-0.27m(변화 0.04), 어깨-손목 수평 거리 0.42 → 0.25m, 엉덩이 각 103~115°
    signal: (f) => f.elbowMin, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '당기기', ecc: '풀기', dist: (f) => f.reach },
    check: (w) => [
      ['앉은 자세', and(between(M(w, 'hip'), 65, 135), lt(M(w, 'torsoTilt'), 40)), 'core'],
      ['손이 몸 쪽으로 당겨짐(높이는 그대로)', and(lt(R(w, 'wristH'), 0.15), gt(R(w, 'reach'), 0.1)), 'core'],
      ['팔을 당김', lt(P(w, 'elbowMin', 10), 115)],
      ['다리는 고정(레그 익스텐션 아님)', lt(R(w, 'knee'), 25), 'soft'],
    ],
  },

  // ───────── 팔 ─────────
  {
    id: 'curl', name: '덤벨 컬', group: '팔', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면이나 대각선에서 팔 전체가 보이게',
    // 정면에서 보면 AI가 팔꿈치 굽힘을 실제보다 덜 굽힌 것(≈90°)으로 읽는다 → 실측 기준으로 설정
    signal: (f) => f.elbowMin, prom: 35, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '들기', ecc: '내리기', dist: (f) => f.wristHMax },
    check: (w) => [
      ['상체를 세움', lt(M(w, 'torsoTilt'), 35), 'core'],
      // 실측: 컬은 손목이 어깨 아래 0.03~0.06m까지 올라옴, 케이블 푸시다운은 0.20m(가슴)에서 멈춤
      ['손목이 어깨 쪽으로 올라옴', and(gt(R(w, 'wristHMax'), 0.25), gt(P(w, 'wristHMax', 90), -0.14)), 'core'],
      ['팔을 충분히 굽힘', lt(P(w, 'elbowMin', 10), 112)],
      ['팔꿈치를 옆구리 가까이', lt(P(w, 'arm', 90), 70), 'soft'],
      ['손이 어깨보다 아래', lt(P(w, 'wristHMax', 90), 0.12), 'soft'],
      ['몸은 제자리(딥스 아님)', not(gt(R(w, 'shY'), 0.08)), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    // 실측: 팔을 내린 상태 팔꿈치각 138~155°, 몸통 흔들림(기울기 범위) 12~19°
    form: (w) => [
      ['partial', P(w, 'elbowMin', 90) < 125, '끝까지 펴기', '내릴 때 팔을 끝까지 펴 주세요'],
      ['swing', R(w, 'torsoTilt') > 28, '반동 줄이기', '몸을 흔들지 말고 팔만 움직이세요'],
    ],
  },
  {
    id: 'triext', name: '트라이셉 익스텐션', group: '팔', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면이나 옆에서 머리 위 팔까지 보이게',
    // 위팔은 머리 위에 고정, 아래팔만 머리 뒤로 내렸다 폄. 실측: 위팔 각도 141~172°로 유지
    signal: (f) => f.wristH, prom: 0.1, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '굽히기', con: '펴기', dist: (f) => f.wristH },
    check: (w) => [
      ['팔꿈치를 머리 위로 고정', gt(P(w, 'arm', 10), 120), 'core'],
      ['손이 머리 뒤로 내려갔다 올라옴', and(gt(R(w, 'wristH'), 0.1), gt(P(w, 'wristH', 90), 0.3)), 'core'],
      ['상체를 세움', lt(M(w, 'torsoTilt'), 35)],
    ],
  },
  {
    id: 'dips', name: '딥스', group: '팔', unit: '회', kind: 'reps', priority: 4, verified: false,
    tip: '옆에서 팔과 몸통이 보이게',
    // 팔로 몸을 지탱한 채 팔꿈치를 굽혔다 폄 (평행봉·벤치·바닥)
    signal: (f) => f.elbowMin, prom: 30, minDur: 0.5, maxDur: 8,
    tempo: { first: 'ecc', ecc: '내려가기', con: '밀기', dist: (f) => f.shoulderOverWrist },
    check: (w) => [
      ['팔로 몸을 지탱(손목이 어깨 아래)', gt(P(w, 'shoulderOverWrist', 90), 0.25), 'core'],
      // 실측: 바닥 딥스 어깨 오르내림 0.086·몸통 39°, 덤벨 컬은 0.01~0.06·7~13°
      ['몸이 팔 힘으로 오르내림(컬 아님)', and(gt(R(w, 'shY'), 0.05), or(gt(M(w, 'torsoTilt'), 20), gt(R(w, 'shY'), 0.09))), 'core'],
      ['상체가 서 있거나 뒤로 기댐(푸시업 아님)', and(lt(M(w, 'torsoTilt'), 60), not(faceDown(w)))],
      ['팔을 굽혔다 폄', gt(RS(w, 'elbowL', 'elbowR'), 30)],
    ],
  },

  {
    id: 'pushdown', name: '트라이셉 푸시다운', group: '팔', unit: '회', kind: 'reps', priority: 5, verified: false,
    tip: '옆이나 대각선에서 팔 전체가 보이게 (케이블)',
    // 위팔을 옆구리에 붙인 채 아래팔만 내려 폄.
    // 실측: 팔꿈치 78~86° → 150~155°, 손목 높이 -0.20(가슴) → -0.46m, 위팔 각 6~23°, 몸통 23~33°
    signal: (f) => -f.elbow, prom: 35, minDur: 0.4, maxDur: 8,
    tempo: { first: 'con', con: '밀어 내리기', ecc: '올리기', dist: (f) => f.wristH },
    check: (w) => [
      ['상체를 세움', lt(M(w, 'torsoTilt'), 45), 'core'],
      ['서 있음(앉아서 하는 로우 아님)', not(lt(M(w, 'knee'), 140))],
      // 실측: 푸시다운 위팔 각 21~27°·손목 최고 -0.21~-0.25m, 덜 올린 덤벨 컬은 40°·-0.13m
      ['위팔을 옆구리에 붙임', lt(P(w, 'arm', 90), 35), 'core'],
      ['팔꿈치를 굽혔다 끝까지 폄', and(lt(P(w, 'elbow', 10), 105), gt(P(w, 'elbow', 90), 140)), 'core'],
      ['손은 가슴 아래에서 움직임(컬 아님)', lt(P(w, 'wristH', 90), -0.16)],
    ],
  },

  // ───────── 코어 ─────────
  {
    id: 'situp', name: '윗몸일으키기·크런치', group: '코어', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '옆이나 대각선에서 머리~무릎이 보이게',
    // 누우면 몸통 기울기 ≈ 90°. 크런치는 70°대, 윗몸일으키기는 40~50°까지 내려온다
    signal: (f) => f.torsoTilt, prom: 10, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '올라오기', ecc: '내려가기' },
    check: (w) => [
      ['누운 상태에서 시작', gt(P(w, 'torsoTilt', 90), 75), 'core'],
      ['어깨를 들어올림', lt(P(w, 'torsoTilt', 10), 85), 'core'],
      ['앉거나 누운 자세(서서 숙이는 동작 아님)', gt(P(w, 'torsoTilt', 10), 20)],
      ['바닥에 누운 자세', and(lt(M(w, 'hipHAbs'), 0.35), lt(P(w, 'hipHAbs', 90), 0.3))],
      ['무릎을 세움', lt(M(w, 'knee'), 140)],
      ['엉덩이를 들지 않음(브릿지·힙 쓰러스트 아님)', and(lt(P(w, 'torsoTilt', 90), 102), lt(P(w, 'hip', 90), 150))],
    ],
  },
  {
    id: 'bridge', name: '힙 브릿지·힙 쓰러스트', group: '코어', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆에서 어깨~무릎이 보이게',
    // 엉덩이를 들어 어깨-엉덩이-무릎을 일직선으로. 실측: 끝까지 올리면 엉덩이 각도 160~170°
    // 바닥 브릿지는 몸통 기울기 90→115°, 벤치에 등 기댄 힙 쓰러스트는 25→80°
    signal: (f) => -f.hip, prom: 15, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '올리기', ecc: '내리기' },
    check: (w) => [
      ['누웠거나 등을 벤치에 기댐', gt(P(w, 'torsoTilt', 90), 65), 'core'],
      ['엉덩이를 폈다 접음', and(gt(R(w, 'hip'), 25), gt(P(w, 'hip', 90), 150)), 'core'],
      ['상체가 서 있지 않음(데드리프트 아님)', gt(P(w, 'torsoTilt', 10), 20)],
      ['엉덩이가 바닥 가까이', lt(M(w, 'hipH'), 0.55)],
      ['무릎을 세움', lt(M(w, 'knee'), 130), 'soft'],
    ],
    form: (w) => [
      ['low', P(w, 'hip', 90) < 155, '엉덩이 더 높이', '어깨-엉덩이-무릎이 일직선이 될 때까지 올리세요'],
    ],
  },
  {
    id: 'legraise', name: '레그 레이즈', group: '코어', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆에서 머리~발끝이 보이게',
    // 누워서 다리를 편 채 들어올림. 실측: 엉덩이 각도 170° → 72~80°, 무릎 160° 이상 유지
    signal: (f) => f.hip, prom: 40, minDur: 0.6, maxDur: 8,
    tempo: { first: 'con', con: '올리기', ecc: '내리기' },
    check: (w) => [
      // 실측: 바닥에 누우면 몸통 88~100° / 45° 레그 프레스에 기대면 52~68°(legpress_physio 를 레그 레이즈로 셌음)
      ['누운 자세', gt(M(w, 'torsoTilt'), 72), 'core'],
      ['다리를 들어올림', lt(P(w, 'hip', 10), 115), 'core'],
      ['상체는 고정(윗몸일으키기 아님)', lt(R(w, 'torsoTilt'), 20), 'core'],
      ['무릎을 편 채', gt(P(w, 'knee', 10), 130)],
    ],
  },
  {
    id: 'plank', name: '플랭크', group: '코어', unit: '초', kind: 'hold', priority: 4, verified: false,
    tip: '옆에서 머리~발끝이 한 화면에',
    // 매 프레임 자세 조건 (버티는 동작이라 반복 대신 시간을 잰다). 발·무릎이 안 보이면 그 조건은 넘어간다
    pose: (f) => f.torsoTilt > 55 && f.torsoTilt < 120
      && f.hip > 140 && !(f.knee <= 140)
      && !(f.hipH >= 0.5) && f.shoulderOverWrist > 0.12
      && !(f.shRoll > 40), // 어깨가 위아래로 포개지면 사이드 플랭크 (실측 71~75°, 플랭크·푸시업 18° 이하)
    // 최근 구간이 움직이지 않는지 (푸시업과 구분)
    still: (w) => R(w, 'shoulderOverWrist') < 0.06 && !(R(w, 'hipH') >= 0.08) && R(w, 'hip') < 15,
    form: (w) => [
      ['sag', M(w, 'hipSag') > 0.08, '엉덩이 올리기', '허리가 처졌어요. 배에 힘을 주세요'],
      ['pike', M(w, 'hipSag') < -0.12, '엉덩이 내리기', '엉덩이가 너무 높아요. 몸을 일직선으로'],
    ],
  },

  {
    id: 'hanglegraise', name: '행잉 레그 레이즈', group: '코어', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '정면이나 옆에서 바와 발끝까지 보이게',
    // 바에 매달려 다리(무릎)를 들어올림. 실측: 엉덩이 각 165~170° → 28~39°, 팔은 편 채 머리 위(손목 높이 0.4m)
    signal: (f) => f.hip, prom: 50, minDur: 0.5, maxDur: 8,
    tempo: { first: 'con', con: '올리기', ecc: '내리기', dist: (f) => f.hipH },
    check: (w) => [
      ['바에 매달림(팔이 머리 위)', gt(P(w, 'wristH', 50), 0.25), 'core'],
      ['다리를 들어올림', lt(P(w, 'hip', 10), 110), 'core'],
      ['팔은 편 채(풀업 아님)', gt(P(w, 'elbow', 10), 130)],
      ['상체를 세움', lt(M(w, 'torsoTilt'), 40)],
    ],
  },
  {
    id: 'russian', name: '러시안 트위스트', group: '코어', unit: '회', kind: 'reps', priority: 5, verified: false,
    tip: '정면이나 대각선에서 몸통과 손이 보이게',
    // 앉아서 상체를 뒤로 기울인 채 손을 좌우로 — 한쪽 1회. 실측: 손이 골반 중심에서 좌우로 0.17~0.19m, 몸통 39~46°
    signal: (f) => -Math.abs(f.handSide), prom: 0.1, minDur: 0.25, maxDur: 4,
    check: (w) => [
      ['앉아서 상체를 뒤로 기울임', and(between(M(w, 'torsoTilt'), 20, 70), between(M(w, 'hip'), 60, 135)), 'core'],
      ['손을 옆으로 보냄', or(gt(P(w, 'handSide', 90), 0.08), lt(P(w, 'handSide', 10), -0.08)), 'core'],
      // 실측: 바닥에 앉으면 발목이 엉덩이와 비슷한 높이(-0.16~0.07m), 레그 익스텐션 의자는 0.43m 아래,
      // 레그 프레스는 발판이 엉덩이보다 0.25~0.47m 위(안전 손잡이를 풀고 거는 손동작을 러시안 트위스트로 셌음)
      ['바닥에 앉음(기구 의자·레그 프레스 아님)', between(M(w, 'hipH'), -0.22, 0.25)],
      ['가슴이 위·앞을 향함', gt(M(w, 'chestUp'), 0.15)],
      ['상체는 그대로(윗몸일으키기 아님)', lt(R(w, 'torsoTilt'), 20)],
      ['얼굴이 위(엎드린 자세 아님)', not(faceDown(w))],
    ],
  },
  {
    id: 'bicycle', name: '바이시클 크런치', group: '코어', unit: '회', kind: 'reps', priority: 5, verified: false,
    tip: '옆에서 머리~발끝이 보이게',
    // 누워서 무릎을 번갈아 당김 — 한쪽 1회. 실측: 당긴 무릎 52~79°, 편 다리 140~163°(좌우 차 최대 85~97°)
    signal: (f) => -f.kneeAsym, prom: 40, minDur: 0.25, maxDur: 3,
    check: (w) => [
      // 실측: 가슴이 위를 향함 0.27~0.99(비틀 때 작아짐), 엎드린 운동은 -0.95 이하
      ['누운 자세(가슴이 위)', and(gt(M(w, 'torsoTilt'), 60), gt(M(w, 'chestUp'), 0.2)), 'core'],
      ['다리를 번갈아 굽혔다 폄', gt(P(w, 'kneeAsym', 90), 50), 'core'],
      ['다리를 든 채(바닥 브릿지 아님)', lt(M(w, 'hipH'), 0.1)],
      // 실측: 바이시클 손 좌우 이동 0.6m, 한 다리 브릿지는 손이 바닥에 고정
      ['상체를 비틂(팔꿈치를 반대 무릎 쪽으로)', gt(R(w, 'handSide'), 0.15)],
    ],
  },
  {
    id: 'sideplank', name: '사이드 플랭크', group: '코어', unit: '초', kind: 'hold', priority: 4, verified: true,
    tip: '정면에서 머리~발끝이 한 화면에',
    // 옆으로 누워 한 팔로 지탱하고 몸을 일직선으로 들어 올림. 실측: 어깨선이 수평에서 71~75°, 몸 일직선 170~172°
    pose: (f) => f.shRoll > 40 && f.bodyLine > 150 && f.torsoTilt > 55 && f.torsoTilt < 110 && f.hip > 150,
    still: (w) => R(w, 'hip') < 15 && R(w, 'torsoTilt') < 12,
    form: (w) => [
      ['sag', M(w, 'hip') < 160, '엉덩이 올리기', '엉덩이가 내려갔어요. 몸을 일직선으로 들어 올리세요'],
    ],
  },

  // ───────── 유산소 ─────────
  {
    id: 'jumpingjack', name: '점핑잭', group: '유산소', unit: '회', kind: 'reps', priority: 7, verified: false,
    tip: '정면에서 손끝~발끝까지 보이게',
    signal: (f) => -f.wristH, prom: 0.3, minDur: 0.35, maxDur: 4,
    check: (w) => [
      ['서서 하는 동작', lt(M(w, 'torsoTilt'), 35), 'core'],
      ['팔을 머리 위로', gt(P(w, 'wristH', 90), 0.05), 'core'],
      ['팔을 내림', lt(P(w, 'wristH', 10), -0.2), 'core'],
      ['엉덩이 높이(서 있음)', gt(P(w, 'hipH', 90), 0.5)],
      ['다리를 벌렸다 모음', gt(R(w, 'ankleDX'), 0.14), 'soft'],
      ['운동 거리에 서 있음', atDistance(w), 'soft'],
    ],
    form: (w) => [
      ['arms', P(w, 'wristH', 90) < 0.1, '팔 끝까지', '팔을 머리 위까지 올리세요'],
    ],
  },
  {
    id: 'climber', name: '마운틴 클라이머', group: '유산소', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '옆에서 머리~발끝이 한 화면에',
    // 플랭크 자세에서 무릎을 번갈아 당김 — 한 다리 1회. 실측: 당긴 무릎 56~73°, 사이 100°대
    signal: (f) => f.kneeMin, prom: 25, minDur: 0.25, maxDur: 3,
    check: (w) => [
      ['엎드려 팔로 지탱', and(gt(M(w, 'torsoTilt'), 60), gt(P(w, 'shoulderOverWrist', 10), 0.3)), 'core'],
      ['팔은 편 채 유지(푸시업 아님)', lt(R(w, 'shoulderOverWrist'), 0.1), 'core'],
      ['무릎을 가슴 쪽으로 당김', lt(P(w, 'kneeMin', 10), 95)],
      // 실측: 당긴 쪽 엉덩이 56~82° / 엎드려 하는 레그 컬은 무릎만 굽혀 142~159° 그대로(legcurl_yaralla 를 클라이머로 셌음)
      ['엉덩이도 접힘(엎드린 레그 컬 아님)', lt(P(w, 'hipMin', 10), 110)],
      ['반대 다리는 편 채(네발 자세 동키킥 아님)', gt(P(w, 'hipMax', 10), 125), 'soft'],
    ],
  },
  {
    id: 'burpee', name: '버피', group: '유산소', unit: '회', kind: 'reps', priority: 7, verified: true,
    tip: '옆이나 정면에서 멀리 (엎드린 자세까지 보이게)',
    // 서기 → 엎드리기 → 서기(점프). 실측: 엉덩이 높이 0.75m ↔ 바닥 -0.1~0.2m
    signal: (f) => f.hipH, prom: 0.35, minDur: 1, maxDur: 12,
    check: (w, b, rep) => [
      ['서 있다가', gt(rep.top, 0.55), 'core'],
      ['바닥까지 엎드림', and(lt(rep.bottom, 0.3), gt(P(w, 'torsoTilt', 90), 60)), 'core'],
      // 실측: 버피는 엎드린 구간에서 팔로 몸을 받침(0.44~0.46m, 바닥에선 푸시업으로 0.15까지 내려감).
      // 레그 컬 기구에 천천히 엎드리는 준비 동작·손 클로즈업(뒤집힌 자세로 오검출)과 구분
      ['엎드려 팔로 몸을 받침(기구에 엎드리기 아님)', and(gt(P(w, 'shoulderOverWrist', 90), 0.3), lt(P(w, 'torsoTilt', 90), 125))],
    ],
  },
  {
    id: 'kbswing', name: '케틀벨 스윙', group: '유산소', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '옆에서 머리~발끝이 보이게',
    // 엉덩이를 접었다 펴며 팔을 가슴 높이까지 흔들어 올림
    signal: (f) => -f.torsoTilt, prom: 22, minDur: 0.5, maxDur: 4,
    check: (w) => [
      ['엉덩이를 접었다 폄', and(gt(R(w, 'hip'), 35), gt(P(w, 'torsoTilt', 90), 35)), 'core'],
      ['팔을 가슴 높이까지 흔들어 올림', gt(P(w, 'wristH', 90), -0.25), 'core'],
      ['끝까지 일어섬', lt(P(w, 'torsoTilt', 10), 30)],
      ['무릎은 조금만 굽힘(스쿼트 아님)', gt(P(w, 'knee', 10), 95)],
    ],
  },
  {
    id: 'highknees', name: '하이니', group: '유산소', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '정면이나 옆에서 머리~발끝이 보이게',
    // 제자리에서 무릎을 번갈아 높이 — 한쪽 1회
    // 실측: 한 번 0.3~0.9초(사이드 런지·불가리안은 2초 안팎), 발은 몸 아래(좌우 0.25m·앞뒤 간격 작음)
    // 0.33초마다 바꾸면(highknees_puregym) 다리를 바꾸는 순간이 1프레임뿐이라 중앙값 스무딩이 지운다(20회 중 2회만 셌음)
    // → 스무딩 안 한 엉덩이 각도로 센다. 원본은 들 때 67~88°, 바꿀 때 133~147°로 크게 출렁인다
    signal: (f) => f.hipMinFast, prom: 35, minDur: 0.15, maxDur: 1.2,
    check: (w, b) => [
      ['서서 하는 동작', lt(M(w, 'torsoTilt'), 35), 'core'],
      // 실측: 버티는 다리가 펴져 더 펴진 무릎 중앙값 156~158° / 기구에 앉아 다리를 움직이면 90°(legext_jeet 를 하이니로 셌음)
      ['한 다리로 서서(앉은 자세 아님)', gt(M(w, 'kneeMax'), 135), 'core'],
      ['무릎을 높이 듦', lt(P(w, 'hipMin', 10), 115), 'core'],
      ['다리를 번갈아(스쿼트 아님)', gt(P(w, 'kneeAsym', 90), 40)],
      ['발은 몸 아래(런지 아님)', and(lt(M(b, 'stanceW'), 0.45), lt(M(b, 'stanceD'), 0.4))],
    ],
  },
];

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/** 자세 교정 코드 → 설명 (기록 화면용) */
export function formInfo(exId, code) {
  const ex = EXERCISE_BY_ID[exId];
  if (!ex?.form) return null;
  const row = ex.form([], []).find((r) => r[0] === code);
  return row ? { code, cue: row[2], tip: row[3] } : null;
}
