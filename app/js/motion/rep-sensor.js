// 폰을 들고 하는 스쿼트·런지 세기 (가속도·회전 센서, 브라우저·Node 공용 순수 로직).
//
// 원리
// 1) 중력 방향(위)으로 본 가속도 a 를 구한다. 폰을 어떻게 들든(세로·가로·눕혀서) 같은 값이 나온다.
// 2) a 를 두 번 '새는 적분'(오래된 값은 잊음)해서 폰 높이 변화 p 를 어림한다. 센서 치우침 때문에
//    그냥 적분하면 몇 초 만에 수십 cm 씩 떠내려가서, 몇 초 전 일은 잊게 만든 것이다.
//    (반 동작마다 속도를 0으로 맞추며 그냥 적분하는 방식도 시험했는데, 치우침이 조금만 있어도 오차가 회마다 쌓여 버렸다)
// 3) p 가 위 → 아래(깊이 minDepth 이상) → 다시 위로 돌아오면 1회.
//    이어서 하는 스쿼트는 p 가 0 을 가운데 두고 출렁여서 깊이가 실제와 비슷하게 나오지만, 가만히 서 있다가 하는
//    첫 회는 절반 남짓으로 작게 나온다 → 가만히 있다 시작한 회는 minDepthFirst 로 본다.
// 4) 새는 적분은 '앉아서 가만히 있기'도 천천히 원래 높이로 돌아온 것처럼 보이게 만들고, 폰을 들어 올린 뒤
//    가만히 있어도 천천히 내려가는 것처럼 보이게 만든다. 그래서 동작의 '모양'도 본다:
//    - 내려가기: 1초 안에 아래로 빨라진 적이 있어야 한다 (속도가 1초 안에 vMove 이상 줄어듦)
//    - 올라오기: 일어선 끝에서 1초 안에 멈춰 선 적이 있어야 한다 (위로 가던 속도가 1초 안에 vStop 이상 줄어듦)
//    1초 안의 변화만 보므로 센서 치우침으로 떠내려가는 속도에 속지 않는다.
// 5) 폰을 크게 돌리는 중(만지작·뒤집기)엔 세지 않는다.
//
// 수치는 물리 모델로 만든 가짜 센서 값(motion/synth.js, tools/motion-eval.mjs)으로 맞춘 출발점이다.
// 실제 폰 기록(설정 → 센서 기록 보내기)으로 다시 맞춰야 한다.

export const SENSOR_EXERCISES = {
  squat: {
    id: 'squat', name: '스쿼트', minDepth: 0.13,
    hint: '폰을 두 손으로 가슴에 대고, 엉덩이를 뒤로 빼며 앉았다 일어나세요',
  },
  lunge: {
    id: 'lunge', name: '런지', minDepth: 0.12,
    hint: '폰을 가슴에 대고 한 발씩 크게 내디디며 앉았다 일어나세요 (한 번 = 1회)',
  },
};

export const COUNTER_DEFAULTS = {
  tauGNorm: 8,      // 중력 크기 어림(중력 뺀 값이 없을 때) 시간 상수(초)
  tauBias: 6,       // 위쪽 가속도 치우침 고치는 시간 상수(초)
  biasClip: 0.15,   // 한 표본이 치우침을 끌어당기는 최대 차이(m/s²)
  biasAGate: 0.6,   // 부드럽게 한 가속도가 이보다 크면(스쿼트의 세게 미는 구간) 치우침을 고치지 않는다
  biasRotGate: 40,  // 회전이 이보다 느릴 때(°/s)만 치우침을 고친다
  smooth: 0.05,     // 가속도 살짝 부드럽게(초)
  tauV: 1.5,        // 속도 새는 적분
  tauP: 2.0,        // 높이 새는 적분
  hyst: 0.05,       // 극값 확인 여유(m)
  minDepth: 0.13,   // 이만큼 내려가야 1회(m, 새는 적분 기준) — 이어서 하는 회
  minDepthFirst: 0.095, // 가만히 서 있다 시작한 회
  restSec: 0.4,     // 이만큼(초) 거의 안 움직이면 '가만히 서 있음'
  restV: 0.06,      //   새는 속도가 이보다 작고
  restA: 0.35,      //   가속도가 이보다 작은 채로
  restP: 0.03,      //   그리고 높이 어림이 이보다 낮게 가라앉았을 때(m)
  maxDepth: 1.3,
  riseFrac: 0.5,    // 바닥에서 깊이의 이만큼 올라와야 셈
  minDown: 0.25, maxDown: 5,  // 내려가는 데 걸린 시간(초)
  minUp: 0.15, maxUp: 5,      // 바닥에서 셀 때까지
  minGap: 0.55,     // 연속 두 회 사이 최소(초)
  win: 1.0,         // 동작 모양을 볼 창(초)
  vMove: 0.2,       // 내려가기: 창 안에서 아래로 이만큼(m/s) 빨라져야
  vStop: 0.2,       // 올라오기: 창 안에서 위로 가던 속도가 이만큼 줄어야(멈춰 섬)
  warmup: 0.6,      // 시작 직후 이만큼(초)은 필터가 자리 잡는 시간
  handleDps: 250,   // 폰을 이보다 빨리 돌리면(°/s) 만지작으로 보고 세지 않는다 (빠른 스쿼트 상체 숙임 ≈ 150°/s)
  handleHold: 0.5,
  maxGap: 0.3,      // 표본 사이가 이보다 멀면(초) 이어진 걸로 보지 않고 새로 시작
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

export class PhoneRepCounter {
  /** @param {Partial<typeof COUNTER_DEFAULTS> & {exercise?: string}} opts */
  constructor(opts = {}) {
    const ex = SENSOR_EXERCISES[opts.exercise] || SENSOR_EXERCISES.squat;
    this.o = { ...COUNTER_DEFAULTS, minDepth: ex.minDepth, ...opts };
    this.exercise = ex.id;
    this.count = 0;
    this.samples = 0;
    this.lastT = null;
    this.lastCountT = -Infinity;
    this.reps = [];     // {t, depth, downSec, upSec, first}
    this.shallow = 0;   // 덜 앉은 횟수
    this._resetFilters(0);
  }

  _resetFilters(t) {
    this.t0 = t;
    this.gNorm = null;
    this.up = null;
    this.bias = 0;
    this.biasN = 0;
    this.aS = 0;
    this.v = 0;
    this.p = 0;
    this.V = 0;        // 그냥(새지 않게) 적분한 속도 — 1초 창 안의 변화만 쓴다
    this.hist = [];    // 최근 win 초의 [t, V]
    this.restFor = 0;
    this.lastRestT = -Infinity; // 마지막으로 '가만히 서 있음'이었던 시각
    this.handleUntil = -Infinity;
    this._seek(t);
  }

  // 위쪽 극값 찾기부터 다시
  _seek(t) {
    this.phase = 'top';
    this.maxP = this.p;
    this.maxT = t;
    this.minP = this.p;
    this.minT = t;
    this.drive = false; // 이번 내려가기에서 아래로 빨라진 적이 있나
    this.stop = false;  // 바닥 이후 위로 가다 멈춰 선 적이 있나
  }

  /** 지금 위 기준에서 얼마나 내려와 있는지(m) — 화면의 깊이 막대용 */
  get depthNow() { return Math.max(0, this.maxP - this.p); }

  /** 센서 값이 들어오고 있는지 */
  get alive() { return this.samples > 0; }

  _winMax(from = -Infinity) {
    let m = -Infinity;
    for (const h of this.hist) if (h[0] >= from && h[1] > m) m = h[1];
    return m;
  }

  /**
   * 표본 하나 넣기. s = {t 초, aig:[x,y,z] (중력 포함, 필수), acc:[x,y,z]|null (중력 뺀 값), rot:[α,β,γ] °/s | null}
   * @returns {{type:'rep'|'shallow'|'down', t:number, count?:number, depth?:number}[]}
   */
  push(s) {
    const o = this.o;
    const ev = [];
    const { t, aig } = s;
    if (!aig || !Number.isFinite(aig[0]) || !Number.isFinite(t)) return ev;
    this.samples++;
    if (this.lastT == null) this._resetFilters(t);
    let dt = this.lastT == null ? 1 / 60 : t - this.lastT;
    if (dt <= 0) return ev;
    if (dt > o.maxGap) { // 끊겼다 이어짐 → 새로 시작 (치우침은 남긴다)
      const { bias, biasN } = this;
      this._resetFilters(t);
      Object.assign(this, { bias, biasN });
      dt = 1 / 60;
    }
    this.lastT = t;
    const acc = s.acc && Number.isFinite(s.acc[0]) ? s.acc : null;
    const rot = s.rot && Number.isFinite(s.rot[0]) ? norm(s.rot) : 0;

    // 1) 위쪽 가속도
    let av;
    if (acc) { // 폰이 계산한 '중력 뺀 가속도'를 폰이 추정한 중력 방향(위)으로
      const g = [aig[0] - acc[0], aig[1] - acc[1], aig[2] - acc[2]];
      const gm = norm(g);
      if (gm > 6.5 && gm < 13) this.up = g.map((x) => x / gm);
      if (!this.up) return ev;
      av = dot(acc, this.up);
    } else { // 중력 뺀 값이 없는 폰: 가속도 크기 - 중력 크기 (위아래 움직임이 대부분일 때 위쪽 가속도와 거의 같다)
      const am = norm(aig);
      this.gNorm = this.gNorm == null ? am : this.gNorm + (1 - Math.exp(-dt / o.tauGNorm)) * (am - this.gNorm);
      av = am - this.gNorm;
    }

    // 2) 치우침: 처음엔 평균으로 빨리, 그다음은 천천히. 한 번에 고치는 양은 biasClip 까지만(움직임에 끌려가지 않게),
    //    세게 미는 구간·폰을 돌리는 중엔 고치지 않는다.
    if (rot < o.biasRotGate && Math.abs(this.aS) < o.biasAGate) {
      this.biasN++;
      const k = Math.max(1 / this.biasN, 1 - Math.exp(-dt / o.tauBias));
      const c = this.biasN < 30 ? 1 : o.biasClip;
      this.bias += k * Math.max(-c, Math.min(c, av - this.bias));
    }
    const a = av - this.bias;
    this.aS += (1 - Math.exp(-dt / o.smooth)) * (a - this.aS);
    this.v = this.v * Math.exp(-dt / o.tauV) + a * dt;
    this.p = this.p * Math.exp(-dt / o.tauP) + this.v * dt;
    this.v = Math.max(-3, Math.min(3, this.v));
    this.p = Math.max(-2, Math.min(2, this.p));
    this.V += a * dt;
    this.hist.push([t, this.V]);
    while (this.hist.length && this.hist[0][0] < t - o.win) this.hist.shift();
    // 가만히 서 있음
    if (Math.abs(this.v) < o.restV && Math.abs(this.aS) < o.restA) this.restFor += dt;
    else this.restFor = 0;
    if (this.restFor >= o.restSec) this.lastRestT = t;

    // 폰을 크게 돌리는 중이면 세지 않는다
    if (rot > o.handleDps) this.handleUntil = t + o.handleHold;
    if (t - this.t0 < o.warmup || t < this.handleUntil) {
      this._seek(t);
      return ev;
    }

    // 3) 위 → 아래 → 위
    const p = this.p;
    if (this.phase === 'top') {
      if (p >= this.maxP) {
        this.maxP = p;
        this.maxT = t;
        this.drive = false;
      } else {
        if (this._winMax(this.maxT) - this.V >= o.vMove) this.drive = true; // 위 극값 뒤 1초 안에 아래로 빨라짐
        if (this.maxP - p > o.hyst) {
          this.phase = 'down';
          this.minP = p;
          this.minT = t;
          // 가만히 서 있다가 내려가기 시작: 잠깐 멈춤이 아니라 높이 어림이 0 근처로 가라앉은 뒤여야 한다
          // (이어서 하는 회는 위 극값이 0 보다 꽤 위에 있다)
          this.fromRest = this.maxT - this.lastRestT <= 1.0 && this.maxP < o.restP;
          ev.push({ type: 'down', t });
        }
      }
    } else if (this.phase === 'down') {
      if (this._winMax(this.maxT) - this.V >= o.vMove) this.drive = true;
      if (p < this.minP) {
        this.minP = p;
        this.minT = t;
      } else if (p - this.minP > o.hyst) { // 바닥을 찍고 올라오기 시작
        const depth = this.maxP - this.minP;
        const downSec = this.minT - this.maxT;
        const need = this.fromRest ? o.minDepthFirst : o.minDepth;
        if (this.drive && depth >= need && depth <= o.maxDepth && downSec >= o.minDown && downSec <= o.maxDown) {
          this.phase = 'up';
          this.depth = depth;
          this.downSec = downSec;
          this.stop = false;
          this.upStart = t; // 이때부터 '멈춰 섬'을 본다(바닥의 감속은 빼려고)
        } else {
          if (this.drive && depth >= 0.05 && depth < need) {
            this.shallow++;
            ev.push({ type: 'shallow', t, depth });
          }
          this._seek(t);
        }
      }
    } else if (this.phase === 'up') {
      // 위로 가던 속도가 1초 안에 vStop 이상 줄었다 = 일어서서 멈춤 (올라오기 시작한 뒤만 본다)
      if (this._winMax(this.upStart) - this.V >= o.vStop) this.stop = true;
      if (p < this.minP) { // 다시 내려감 → 아직 바닥이 아니었다
        this.phase = 'down';
        this.minP = p;
        this.minT = t;
      } else if (t - this.minT > o.maxUp) {
        this._seek(t);
      } else if (this.stop && p - this.minP >= Math.max(o.riseFrac * this.depth, o.hyst + 0.02)
        && t - this.minT >= o.minUp && t - this.lastCountT >= o.minGap) {
        this.count++;
        this.lastCountT = t;
        const rep = {
          t, depth: +this.depth.toFixed(3), downSec: +this.downSec.toFixed(2), upSec: +(t - this.minT).toFixed(2), first: !!this.fromRest,
        };
        this.reps.push(rep);
        ev.push({ type: 'rep', count: this.count, ...rep });
        this._seek(t);
      }
    }
    return ev;
  }
}

/** DeviceMotionEvent → 표본 (t 는 초) */
export function sampleFromEvent(e, tSec) {
  const g = e.accelerationIncludingGravity;
  const a = e.acceleration;
  const r = e.rotationRate;
  return {
    t: tSec,
    aig: g && g.x != null ? [g.x, g.y, g.z] : null,
    acc: a && a.x != null ? [a.x, a.y, a.z] : null,
    rot: r && r.alpha != null ? [r.alpha, r.beta, r.gamma] : null,
  };
}
