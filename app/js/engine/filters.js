// 특징값 스무딩: 3프레임 중앙값(한 프레임짜리 튐 제거) → 시간상수 기반 EMA(프레임레이트 무관).

export class ScalarSmoother {
  constructor(tau = 0.07, resetGap = 0.6) {
    this.tau = tau;
    this.resetGap = resetGap;
    this.hist = [];
    this.y = NaN;
    this.t = NaN;
  }

  update(t, x) {
    if (!Number.isFinite(x)) return NaN;
    if (!(t - this.t <= this.resetGap)) { // 첫 값이거나 오래 끊겼으면 새로 시작
      this.hist = [];
      this.y = NaN;
    }
    this.hist.push(x);
    if (this.hist.length > 3) this.hist.shift();
    const m = this.hist.length === 3 ? median3(this.hist[0], this.hist[1], this.hist[2]) : x;
    if (!Number.isFinite(this.y)) this.y = m;
    else {
      const a = 1 - Math.exp(-(t - this.t) / this.tau);
      this.y += a * (m - this.y);
    }
    this.t = t;
    return this.y;
  }
}

function median3(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

export class FeatureSmoother {
  constructor(keys, tau) {
    this.s = Object.fromEntries(keys.map((k) => [k, new ScalarSmoother(tau)]));
  }

  update(t, f) {
    const out = { ...f };
    for (const k in this.s) out[k] = this.s[k].update(t, f[k]);
    return out;
  }
}
