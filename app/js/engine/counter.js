// 1차원 신호에서 반복 1회(위 → 아래 → 다시 위)를 찾는 히스테리시스 극값 검출기.
// 신호는 '힘주는 구간이 낮은 값'이 되도록 방향을 맞춰 넣는다 (예: 스쿼트의 엉덩이 높이).
// 최고점에서 prom 이상 내려가면 '내려감' 확정, 최저점에서 prom 이상 올라오면 1회 완료 → 올라오는 도중에 바로 센다.

export function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export class RepCounter {
  /**
   * @param {object} o
   * @param {number} o.prom        최소 진폭(신호 단위). 이보다 작은 흔들림은 무시
   * @param {number} [o.minDur]    1회 최소 시간(초) — 이보다 빠르면 잡음으로 본다
   * @param {number} [o.maxDur]    1회 최대 시간(초) — 이보다 길면 반복이 아니라 자세 변경으로 본다
   * @param {number} [o.adaptFrac] 최근 정상 반복 진폭의 이 비율보다 작은 움직임은 무시(세트 중 반동 억제)
   * @param {number} [o.gapReset]  신호가 이 시간(초) 이상 끊기면 상태 초기화
   */
  constructor({ prom, minDur = 0.3, maxDur = 10, adaptFrac = 0.35, gapReset = 1.5, leadIn = false }) {
    this.prom = prom;
    this.leadIn = leadIn; // 힘주는 자세(바닥)에서 시작하는 운동(데드리프트): 첫 '올라오기'도 1회로 센다
    this.minDur = minDur;
    this.maxDur = maxDur;
    this.adaptFrac = adaptFrac;
    this.gapReset = gapReset;
    this.amps = [];
    this.reset();
  }

  reset() {
    this.mode = 'peak';
    this.hi = -Infinity; // 현재 구간 최고값
    this.hiT = NaN;      // 최고값이 나온 시각
    this.topT = NaN;     // 꼭대기 근처에 마지막으로 머문 시각(= 내려가기 시작한 시각)
    this.lo = Infinity;
    this.loT = NaN;
    this.peak = null;
    this.lastT = NaN;
    this.hist = [];      // 최근 3초 (오래된 최고값 갱신용)
    this.fresh = true;   // 초기화 뒤 아직 한 번도 내려간 적 없음
    this.lo0 = Infinity; // 초기화 뒤 최저값 (leadIn 용)
    this.lo0T = NaN;
    this.t0 = NaN;
    this.leadPending = null;
  }

  /** 정상으로 인정된 반복의 진폭을 알려주면 이후 반동 억제 기준이 된다 */
  accept(amp) {
    this.amps.push(amp);
    if (this.amps.length > 6) this.amps.shift();
  }

  clearAdapt() { this.amps = []; }

  effProm() {
    if (this.amps.length < 2) return this.prom;
    return Math.max(this.prom, this.adaptFrac * median(this.amps));
  }

  /** @returns {null | {tStart, tBottom, tEnd, top, bottom, amp}} */
  update(t, v) {
    if (!Number.isFinite(v)) return null;
    if (t - this.lastT > this.gapReset) this.reset();
    this.lastT = t;
    this.hist.push([t, v]);
    while (this.hist[0][0] < t - 3) this.hist.shift();
    const p = this.effProm();

    if (!Number.isFinite(this.t0)) this.t0 = t;
    if (this.mode === 'peak') {
      if (this.leadIn && this.fresh) {
        if (v < this.lo0) { this.lo0 = v; this.lo0T = t; }
        if (!this.leadPending && v > this.lo0 + p) {
          // fresh 인 동안은 한 번도 p 이상 내려간 적 없음 = 바닥 자세에서 출발 → 다 올라오면 첫 반복으로 센다
          this.leadPending = { tStart: Math.max(this.t0, this.lo0T - 1.5), tBottom: this.lo0T, bottom: this.lo0 };
        }
      }
      if (this.leadPending) {
        if (v > this.hi) { this.hi = v; this.hiT = t; }
        // 꼭대기에서 멈췄거나(0.4초) 다시 내려가기 시작하면 확정 → 꼭대기 자세까지 구간에 포함
        if (t - this.hiT > 0.4 || v < this.hi - 0.3 * p) {
          const L = this.leadPending;
          this.leadPending = null;
          this.fresh = false;
          const rep = { ...L, tEnd: t, top: this.hi, amp: this.hi - L.bottom, lead: true };
          this.topT = t;
          if (rep.tEnd - rep.tStart >= this.minDur && rep.tEnd - rep.tStart <= this.maxDur) return rep;
        }
        return null;
      }
      if (v > this.hi) { this.hi = v; this.hiT = t; }
      else if (t - this.hiT > 2.5) {
        // 오래전 최고값(걸어오거나 자세를 바꾸던 중의 값)에 묶이지 않도록 최근 3초 최고값으로 갱신
        this.hi = -Infinity;
        for (const [ht, hv] of this.hist) if (hv >= this.hi) { this.hi = hv; this.hiT = ht; }
      }
      if (v >= this.hi - 0.2 * p) this.topT = t; // 꼭대기에서 버티는 동안은 시작 시각을 늦춘다
      if (v < this.hi - p) {
        this.fresh = false;
        this.peak = { t: Number.isFinite(this.topT) ? Math.max(this.topT, t - 3) : t - 3, v: this.hi };
        this.mode = 'valley';
        this.lo = v; this.loT = t;
      }
      return null;
    }

    if (v < this.lo) { this.lo = v; this.loT = t; }
    if (v > this.lo + p) {
      const rep = {
        tStart: this.peak.t, tBottom: this.loT, tEnd: t,
        top: this.peak.v, bottom: this.lo, amp: this.peak.v - this.lo,
      };
      this.mode = 'peak';
      this.hi = v; this.hiT = t; this.topT = t;
      this.peak = null;
      const dur = rep.tEnd - rep.tStart;
      if (dur < this.minDur || dur > this.maxDur) return null;
      return rep;
    }
    return null;
  }
}
