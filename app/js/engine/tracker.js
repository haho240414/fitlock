// 운동 추적기: 매 프레임 포즈를 받아 '어떤 운동인지 판별 → 횟수 세기 → 세트 나누기'를 한다.
// 모든 운동의 카운터를 동시에 돌리고, 조건을 통과한 반복이 같은 운동으로 연속 N회 나오면 그 운동으로 확정한다.
// 브라우저/Node 공용 순수 로직 (앱과 test/eval.mjs 가 같은 코드를 쓴다).

import { computeFeatures, SMOOTH_KEYS, uprightAxis, rotationTo, rotatePoints, REF_UP } from './features.js';
import { FeatureSmoother } from './filters.js';
import { RepCounter, median } from './counter.js';
import { EXERCISES, EXERCISE_BY_ID } from './exercises.js';
import { measureRep, toPhases, summarize } from './tempo.js';

export const TRACKER_DEFAULTS = {
  lockReps: 2,      // 자동 인식: 같은 운동의 유효 반복이 이만큼 이어지면 확정
  chainGap: 8,      // 유효 반복 사이가 이보다 멀면(초) 이어진 걸로 보지 않음
  idleFactor: 2.2,  // 세트 종료: 마지막 반복 후 (반복 간격 중앙값 × factor)초 동안 반복이 없으면
  idleMin: 3.5,
  idleMax: 12,
  idleSec: null,    // 사용자가 정한 '멈추면 세트 끝' 초 (null = 위의 자동 계산)
  lostEnd: 4,       // 사람이 화면에서 사라진 채 이만큼 지나면 세트 종료
  minSetReps: 2,    // 이보다 적은 세트는 기록하지 않음
  holdStart: 2.5,   // 플랭크 자세가 이만큼(초) 움직임 없이 유지되면 시작
  holdBreak: 1.5,   // 플랭크 자세가 이만큼 무너지면 종료
  holdMin: 5,       // 이보다 짧은 플랭크는 기록하지 않음
  minVis: 0.45,     // 사람으로 인정할 최소 평균 가시성
  bufferSec: 15,
  smoothTau: 0.07,
  fixed: null,      // 운동을 직접 고른 경우 그 운동 id (1회째부터 셈, soft 조건 생략)
  candidates: null, // 오늘 할 운동 목록 — 이 안에서만 자동 인식 (헬스장 루틴용)
  cueRepeat: 3,     // 같은 자세 지적은 최소 이만큼 반복 뒤에 다시
  logLimit: 3000,
  // 폰 기울기 보정. 앱은 폰의 기울기 센서로 잰 '카메라 좌표의 위쪽'을 cameraUp 으로 넣는다(가장 정확).
  // 몸 자세로 추정하는 방법(calibrate)은 발 깊이 추정이 부정확해 기울지 않은 영상에서도 20~37° 틀려서 기본으로 끈다.
  cameraUp: null,
  calibrate: false, // 가만히 똑바로 선 순간의 몸 방향으로 폰 기울기를 추정해 보정 (실험용)
  maxTiltCorr: 40,  // 이보다 크게 기운 표본은 잘못 본 것으로 보고 버린다(도)
  minCorr: 4,       // 평소 모습(REF_UP)과 이보다 덜 다르면 보정하지 않는다(도)
  calibMinSamples: 15, // 표본이 이만큼(≈1초) 모인 뒤에만 보정
};

const DEG = 180 / Math.PI;

export class Tracker {
  constructor(opts = {}) {
    this.o = { ...TRACKER_DEFAULTS, ...opts };
    if (!this.o.fixed && this.o.candidates?.length === 1) this.o.fixed = this.o.candidates[0];
    const allow = this.o.fixed ? [this.o.fixed] : this.o.candidates;
    // auto: false 운동(벽 스쿼트처럼 쉬는 자세와 구별이 안 되는 것)은 직접 골랐을 때만 본다
    this.specs = EXERCISES.filter((e) => (allow?.length ? allow.includes(e.id) : e.auto !== false));
    this.repSpecs = this.specs.filter((e) => e.kind === 'reps').sort((a, b) => b.priority - a.priority);
    this.holdSpecs = this.specs.filter((e) => e.kind === 'hold');
    this.counters = Object.fromEntries(this.repSpecs.map((e) => [e.id, new RepCounter(e)]));
    this.smoother = new FeatureSmoother(SMOOTH_KEYS, this.o.smoothTau);
    this.buf = [];
    this.valid = {};
    this.state = 'search'; // search | reps | hold
    this.set = null;
    this.sets = [];
    this.log = [];
    this.present = false;
    this.lastSeenT = -Infinity;
    this.lastF = null;
    this.holdSince = null;
    this.holdLastOk = null;
    this.holdId = null;      // 지금 버티는 것 같은 자세 (플랭크·사이드 플랭크·벽 스쿼트)
    this.t = 0;
    this.up = REF_UP.slice(); // 선 자세 몸 축 추정 (처음엔 '평소 모습' = 폰을 똑바로 세웠다고 가정)
    this.rot = null;        // null = 보정 없음 (측정한 선 자세 축 → 평소 모습으로 돌리는 회전)
    this.upSamples = 0;
    this.upBuf = [];
    this.hipHist = [];      // 최근 0.6초 화면상 엉덩이 위치 (가만히 서 있는지)
    if (this.o.cameraUp) this.setCameraUp(this.o.cameraUp);
    if (this.o.initialUp) { // 이전에 잰 기울기로 시작 (같은 자리에서 이어서 운동할 때)
      this.up = this.o.initialUp.slice();
      this.upBuf = Array.from({ length: this.o.calibMinSamples }, () => this.up.slice());
      this.rot = this.tiltDeg > this.o.minCorr ? rotationTo(this.up) : null;
    }
  }

  /**
   * 폰 기울기 센서 값으로 보정: up = 카메라 좌표(x 오른쪽, y 아래, z 화면 안쪽)에서 본 진짜 위쪽 단위벡터.
   * 3° 미만이면 보정하지 않는다.
   */
  setCameraUp(up) {
    const n = Math.hypot(...up);
    if (!n) return;
    this.sensorUp = up.map((v) => v / n);
    const deg = Math.acos(Math.max(-1, Math.min(1, -this.sensorUp[1]))) * DEG;
    this.rot = deg > 3 ? rotationTo(this.sensorUp, [0, -1, 0]) : null;
  }

  /** 폰이 몇 도 기울어 있다고 보는지 (센서 값이 있으면 센서, 아니면 몸 자세 추정 vs 시범 영상의 평소 모습) */
  get tiltDeg() {
    if (this.sensorUp) return Math.acos(Math.max(-1, Math.min(1, -this.sensorUp[1]))) * DEG;
    const d = this.up[0] * REF_UP[0] + this.up[1] * REF_UP[1] + this.up[2] * REF_UP[2];
    return Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
  }

  // 가만히 똑바로 선 순간들의 몸 축을 모아(최근 60개) 성분별 중앙값으로 위쪽을 추정한다 — 튀는 프레임에 강하다.
  // 걸어오는 중(실측: 덤벨 컬 영상에서 37° 오추정)은 화면상 엉덩이가 움직이므로 뺀다.
  _calibrate(t, lm, wl) {
    const hx = (lm[23].x + lm[24].x) / 2, hy = (lm[23].y + lm[24].y) / 2;
    const tor = Math.hypot((lm[11].x + lm[12].x) / 2 - hx, (lm[11].y + lm[12].y) / 2 - hy);
    this.hipHist.push([t, hx, hy]);
    while (this.hipHist.length && this.hipHist[0][0] < t - 0.6) this.hipHist.shift();
    const xs = this.hipHist.map((h) => h[1]), ys = this.hipHist.map((h) => h[2]);
    const moved = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (this.hipHist.length < 4 || !(moved < 0.12 * tor)) return;
    const axis = uprightAxis(lm, wl);
    if (!axis) return;
    const offCam = Math.acos(Math.max(-1, Math.min(1, -axis[1]))) * DEG;
    if (offCam > this.o.maxTiltCorr) return;
    this.upBuf.push(axis);
    if (this.upBuf.length > 60) this.upBuf.shift();
    this.upSamples++;
    if (this.upBuf.length < this.o.calibMinSamples) return;
    const med = [0, 1, 2].map((i) => median(this.upBuf.map((a) => a[i])));
    const n = Math.hypot(...med);
    this.up = med.map((v) => v / n);
    this.rot = this.tiltDeg > this.o.minCorr ? rotationTo(this.up) : null;
  }

  /**
   * @param {number} t 초
   * @param {Array|null} lm 정규화 랜드마크 33점 (사람 없으면 null)
   * @param {Array|null} wl 월드 랜드마크 33점
   * @returns {Array<object>} 이벤트 목록
   */
  update(t, lm, wl) {
    const ev = [];
    this.t = t;
    let f = null;
    this.lastRaw = null; // 가시성이 낮아 '사람'으로 안 쳐도 보이는 부위는 알려준다 (화면 구도 안내용)
    if (lm && wl) {
      if (this.o.calibrate && !this.sensorUp) this._calibrate(t, lm, wl);
      const raw = computeFeatures(lm, rotatePoints(wl, this.rot));
      this.lastRaw = raw;
      if (raw.visAll >= this.o.minVis) {
        f = this.smoother.update(t, raw);
        f.t = t;
      }
    }

    if (f) {
      if (!this.present) ev.push({ type: 'personFound' });
      this.present = true;
      this.lastSeenT = t;
      this.buf.push(f);
      while (this.buf.length && this.buf[0].t < t - this.o.bufferSec) this.buf.shift();
    } else if (this.present && t - this.lastSeenT > 1) {
      this.present = false;
      ev.push({ type: 'personLost' });
    }
    this.lastF = f;

    if (f) {
      for (const ex of this.repSpecs) {
        const rep = this.counters[ex.id].update(t, ex.signal(f));
        if (rep) this._candidate(ex, rep, ev);
      }
      if (this.holdSpecs.length) this._hold(t, f, ev);
      if (this.state === 'reps') this._tempo(ev, false);
    }
    this._maybeEndSet(t, ev);
    return ev;
  }

  _window(t0, t1) {
    const out = [];
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const f = this.buf[i];
      if (f.t < t0) break;
      if (f.t <= t1) out.push(f);
    }
    return out.reverse();
  }

  _candidate(ex, rep, ev) {
    const w = this._window(rep.tStart - 0.2, rep.tEnd);
    const b = this._window(rep.tBottom - 0.25, rep.tBottom + 0.25);
    const fixed = this.o.fixed === ex.id;
    // 결과: true 통과 / false 탈락 / null 모름(그 부위가 안 보임)
    const checks = ex.check(w, b, rep).map(([name, res, kind]) => ({
      name, res: res === true ? true : res === false ? false : null, kind: kind === true ? 'soft' : kind || null,
    }));
    const valid = checks.every((c) => {
      if (c.kind === 'core') return fixed ? c.res !== false : c.res === true; // 핵심: 자동은 확인돼야, 직접 고르면 아니라고만 안 나오면
      if (fixed) return true;                                                    // 직접 고른 운동은 핵심 조건만 본다
      return c.res !== false;                                                    // 자동: 탈락만 막고 모름은 넘어간다
    });
    if (this.log.length < this.o.logLimit) {
      this.log.push({
        ex: ex.id, ...rep, valid,
        failed: checks.filter((c) => c.res === false || (c.kind === 'core' && c.res === null && !fixed))
          .map((c) => (c.res === null ? `${c.name}(안 보임)` : c.name)),
      });
    }
    if (!valid) return;
    this.counters[ex.id].accept(rep.amp);
    const issues = ex.form ? ex.form(w, b).filter((row) => row[1] === true).map((row) => row[0]) : [];
    const r = { ...rep, ex: ex.id, issues };

    if (this.state === 'reps' && this.set.exercise === ex.id) {
      this._countRep(r, ev);
      return;
    }
    const list = (this.valid[ex.id] ||= []);
    // 느린 운동(레그 레이즈·데드리프트)은 한 회가 길어서 간격 기준도 늘린다
    const gap = Math.max(this.o.chainGap, 3 * (r.tEnd - r.tStart));
    if (list.length && r.tEnd - list[list.length - 1].tEnd > gap) list.length = 0;
    list.push(r);
    const need = fixed ? 1 : this.o.lockReps;
    if (list.length < need) return;
    // 다른 운동 세트 도중이면: 그 세트의 마지막 반복 이후에 나온 반복만으로 판단
    if (this.state === 'reps') {
      const after = list.filter((x) => x.tStart >= this.set.lastRepT - 0.3);
      if (after.length < need) return;
      this._endSet(ev, 'switch');
    } else if (this.state === 'hold') {
      this._endSet(ev, 'switch');
    }
    this._startRepSet(ex, list.slice(), ev);
  }

  _startRepSet(ex, reps, ev) {
    this.state = 'reps';
    this.set = {
      exercise: ex.id, kind: 'reps', count: reps.length, reps,
      startT: reps[0].tStart, lastRepT: reps[reps.length - 1].tEnd, cued: {},
    };
    this.valid = {};
    const last = reps[reps.length - 1];
    ev.push({ type: 'setStart', exercise: ex.id, count: this.set.count, issues: last.issues, cue: this._cue(), t: this.t });
  }

  _countRep(r, ev) {
    const s = this.set;
    s.reps.push(r);
    s.count++;
    s.lastRepT = r.tEnd;
    this.valid = {};
    ev.push({ type: 'rep', exercise: s.exercise, count: s.count, issues: r.issues, cue: this._cue(), t: this.t });
  }

  // 템포: 센 반복이 다 올라와 끝나면(위에서 멈추거나 다음 반복을 시작하면) 힘주기·돌아오기 시간과 속도를 잰다.
  // final = 세트가 끝나서 더 기다릴 수 없음. 잴 수 없으면 null 로 남긴다.
  _tempo(ev, final) {
    const s = this.set;
    const ex = EXERCISE_BY_ID[s.exercise];
    if (!ex?.tempo) return;
    for (let i = 0; i < s.reps.length; i++) {
      const r = s.reps[i];
      if (r.tempo !== undefined) continue;
      const next = s.reps[i + 1];
      const pts = this._window(r.tStart - 0.6, next ? next.tStart + 0.3 : this.t)
        .map((f) => ({ t: f.t, s: ex.signal(f), d: ex.tempo.dist ? ex.tempo.dist(f) : NaN }));
      const m = measureRep(pts, r, { final: final || !!next, minRange: 0.6 * ex.prom });
      if (!m && !final && !next) continue;
      r.tempo = toPhases(m, ex.tempo.first);
      if (r.tempo) ev.push({ type: 'tempo', exercise: s.exercise, index: i, tempo: r.tempo, t: this.t });
    }
  }

  // 자세 지적 정책: 최근 3회 중 2회 이상 같은 문제 + 최근 cueRepeat회 안에 같은 말을 안 했을 때만 (잔소리 방지)
  _cue() {
    const s = this.set;
    const n = s.reps.length;
    const last = s.reps[n - 1];
    if (!last?.issues?.length) return null;
    const recent = s.reps.slice(-3);
    for (const code of last.issues) {
      const hits = recent.filter((r) => r.issues?.includes(code)).length;
      const lastCue = s.cued[code];
      if (hits >= 2 && (lastCue == null || n - lastCue >= this.o.cueRepeat)) {
        s.cued[code] = n;
        const row = EXERCISE_BY_ID[s.exercise].form([], []).find((x) => x[0] === code);
        return { code, text: row?.[2] ?? code, tip: row?.[3] ?? '' };
      }
    }
    return null;
  }

  _hold(t, f, ev) {
    if (this.state === 'hold') {
      const s = this.set;
      if (EXERCISE_BY_ID[s.exercise].pose(f)) {
        s.lastOkT = t;
        s.holdSec = t - s.startT;
        const sec = Math.floor(s.holdSec);
        if (sec > s.tick) {
          s.tick = sec;
          ev.push({ type: 'holdTick', exercise: s.exercise, sec, t });
          this._holdForm(t, ev);
        }
      }
      return;
    }
    // 시작 판정: 버티기 자세 중 하나 + 최근 1.2초 동안 움직임 없음 (푸시업 반복 중엔 '움직임'이라 시작 안 됨)
    const win = this._window(t - 1.2, t);
    const spec = this.holdSpecs.find((h) => h.pose(f) && h.still(win)) || null;
    if (spec) {
      if (this.holdId !== spec.id || this.holdSince == null) { this.holdId = spec.id; this.holdSince = t; }
      this.holdLastOk = t;
    } else if (this.holdSince != null && t - this.holdLastOk > 0.5) {
      this.holdSince = null;
      this.holdId = null;
    }
    if (this.holdSince == null || t - this.holdSince < this.o.holdStart) return;
    if (this.state === 'reps') {
      if (this.set.lastRepT > this.holdSince) return; // 버티는 중에 반복이 있었다 → 버티기 아님
      this._endSet(ev, 'switch');
    }
    const hs = EXERCISE_BY_ID[this.holdId];
    const holdSec = t - this.holdSince;
    this.state = 'hold';
    this.set = {
      exercise: hs.id, kind: 'hold', startT: this.holdSince, holdSec, lastOkT: t, tick: Math.floor(holdSec),
      issueSince: {}, issueSec: {}, cuedAt: {},
    };
    this.valid = {};
    ev.push({ type: 'setStart', exercise: hs.id, holdSec, t });
  }

  // 버티는 동안 1초마다 자세 확인 → 2초 이상 계속된 문제만, 같은 말은 8초 간격
  _holdForm(t, ev) {
    const s = this.set;
    const spec = EXERCISE_BY_ID[s.exercise];
    if (!spec.form) return;
    const rows = spec.form(this._window(t - 1.5, t), []);
    for (const [code, bad, text, tip] of rows) {
      if (bad === true) {
        s.issueSince[code] ??= t;
        s.issueSec[code] = (s.issueSec[code] || 0) + 1;
        if (t - s.issueSince[code] >= 2 && !(t - (s.cuedAt[code] ?? -Infinity) < 8)) {
          s.cuedAt[code] = t;
          ev.push({ type: 'cue', exercise: spec.id, code, text, tip, t });
        }
      } else {
        delete s.issueSince[code];
      }
    }
  }

  _maybeEndSet(t, ev) {
    const s = this.set;
    if (!s) return;
    if (s.kind === 'hold') {
      const brokeAt = s.lastOkT;
      if (t - brokeAt > this.o.holdBreak) {
        s.holdSec = brokeAt - s.startT;
        this._endSet(ev, this.present ? 'break' : 'lost');
      }
      return;
    }
    const idle = this._idleSec();
    const lost = !this.present && t - this.lastSeenT > this.o.lostEnd;
    if (lost || (!this._midRep() && t - s.lastRepT > idle)) this._endSet(ev, lost ? 'lost' : 'idle');
  }

  /** 반복이 이만큼(초) 멈추면 세트 끝: 사용자가 정했으면 그 값, 아니면 평소 반복 간격의 2.2배(3.5~12초) */
  _idleSec() {
    if (this.o.idleSec) return this.o.idleSec;
    const s = this.set;
    const gaps = [];
    for (let i = 1; i < s.reps.length; i++) gaps.push(s.reps[i].tEnd - s.reps[i - 1].tEnd);
    const period = gaps.length ? median(gaps) : 2.5;
    return Math.min(this.o.idleMax, Math.max(this.o.idleMin, period * this.o.idleFactor));
  }

  // 내려간(힘주는) 자세로 버티는 중이면 세트를 끝내지 않는다 (예: 스쿼트 바닥에서 잠깐 멈춤)
  _midRep() {
    const s = this.set;
    const c = this.counters[s.exercise];
    return c.mode === 'valley' && c.peak && this.t - c.peak.t < EXERCISE_BY_ID[s.exercise].maxDur;
  }

  _endSet(ev, reason) {
    const s = this.set;
    let rec = null;
    if (s.kind === 'reps') this._tempo(ev, true);
    if (s.kind === 'reps' && s.count >= this.o.minSetReps) {
      const issues = {};
      for (const r of s.reps) for (const code of r.issues || []) issues[code] = (issues[code] || 0) + 1;
      rec = {
        exercise: s.exercise, kind: 'reps', reps: s.count,
        good: s.reps.filter((r) => !r.issues?.length).length, issues,
        startT: round2(s.startT), endT: round2(s.lastRepT),
        repTimes: s.reps.map((r) => round2(r.tEnd)),
      };
      if (EXERCISE_BY_ID[s.exercise]?.tempo) {
        rec.tempo = s.reps.map((r) => r.tempo ?? null);
        rec.tempoSum = summarize(rec.tempo);
      }
    } else if (s.kind === 'hold' && s.holdSec >= this.o.holdMin) {
      rec = {
        exercise: s.exercise, kind: 'hold', holdSec: Math.round(s.holdSec), issues: { ...s.issueSec },
        startT: round2(s.startT), endT: round2(s.startT + s.holdSec),
      };
    }
    if (rec) {
      this.sets.push(rec);
      ev.push({ type: 'setEnd', set: rec, reason, t: this.t });
    } else {
      ev.push({ type: 'setDiscard', exercise: s.exercise, reason, t: this.t });
    }
    this.state = 'search';
    this.set = null;
    this.valid = {};
    if (s.kind === 'hold') { this.holdSince = null; this.holdId = null; }
    for (const c of Object.values(this.counters)) c.clearAdapt();
  }

  /** 운동 종료 시 진행 중인 세트를 마무리 */
  finish() {
    const ev = [];
    if (this.set) {
      if (this.set.kind === 'hold') this.set.holdSec = this.set.lastOkT - this.set.startT;
      this._endSet(ev, 'finish');
    }
    return ev;
  }

  snapshot() {
    const s = this.set;
    return {
      state: this.state,
      present: this.present,
      exercise: s?.exercise ?? null,
      count: s?.kind === 'reps' ? s.count : 0,
      holdSec: s?.kind === 'hold' ? s.holdSec : 0,
      features: this.lastF,
      raw: this.lastRaw,
      tiltDeg: this.tiltDeg,
      pending: this._pending(),
      // 반복 세트 중 '몇 초 더 멈추면 세트 끝'인지 (화면 안내용)
      setEndIn: s?.kind === 'reps' && !this._midRep() ? Math.max(0, this._idleSec() - (this.t - s.lastRepT)) : null,
      midRep: s?.kind === 'reps' ? !!this._midRep() : false,
      repGap: s?.kind === 'reps' && s.reps.length > 1
        ? median(s.reps.slice(1).map((r, i) => r.tEnd - s.reps[i].tEnd)) : null, // 평소 반복 간격(초)
      idleSec: s?.kind === 'reps' ? this._idleSec() : null,
      tempo: s?.kind === 'reps' ? s.reps.map((r) => r.tempo ?? null) : null,
    };
  }

  /** 확정 전(자동 인식에서 1회째) 가장 최근에 맞아 보인 운동 — 화면에 '○○ 같아요'로 보여준다 */
  _pending() {
    if (this.state !== 'search') return null;
    let best = null;
    for (const [id, list] of Object.entries(this.valid)) {
      const last = list[list.length - 1];
      if (!last || this.t - last.tEnd > 6) continue;
      if (!best || last.tEnd > best.t) best = { exercise: id, count: list.length, t: last.tEnd };
    }
    return best;
  }
}

const round2 = (x) => Math.round(x * 100) / 100;
