// 폰 움직임 센서(DeviceMotionEvent, 초당 약 60번) → 횟수 세기(rep-sensor.js) + 센서 기록(sensorlog.js).
// 화면이 보일 때만 듣는다(start/stop). 시작하고 noDataMs 안에 값이 하나도 안 오면 onNoSensor — 잠금 화면은 그때 그냥 열어 준다.
// 점검용: inject(samples) 로 가짜 센서 값을 같은 길로 넣을 수 있다(에뮬레이터 자동 점검).

import { PhoneRepCounter, sampleFromEvent } from './rep-sensor.js';
import { SensorRecorder } from '../sensorlog.js';

export class MotionCounter {
  /**
   * @param {{exercise?:string, onRep?:(e:object)=>void, onEvent?:(e:object)=>void, onNoSensor?:()=>void, noDataMs?:number}} o
   */
  constructor({ exercise = 'squat', onRep = () => {}, onEvent = () => {}, onNoSensor = () => {}, noDataMs = 2500 } = {}) {
    this.counter = new PhoneRepCounter({ exercise });
    this.rec = new SensorRecorder();
    this.onRep = onRep;
    this.onEvent = onEvent;
    this.onNoSensor = onNoSensor;
    this.noDataMs = noDataMs;
    this.running = false;
    this.events = 0;
    this.injected = 0;
    this.lastEventAt = 0;
    this.handler = (e) => {
      const s = sampleFromEvent(e, (e.timeStamp || performance.now()) / 1000);
      if (!s.aig) return;
      this.events++;
      this.lastEventAt = performance.now();
      if (!this.injecting) this._feed(s); // 가짜 값을 넣는 동안엔 실제 값과 섞지 않는다
    };
  }

  get count() { return this.counter.count; }
  get depthNow() { return this.counter.depthNow; }
  get phase() { return this.counter.phase; }

  _feed(s) {
    this.rec.add(s);
    for (const e of this.counter.push(s)) {
      if (e.type === 'rep') this.onRep(e);
      this.onEvent(e);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('devicemotion', this.handler);
    const startedAt = performance.now();
    const base = this.events + this.injected;
    clearTimeout(this.noDataTimer);
    this.noDataTimer = setTimeout(() => {
      if (this.running && this.events + this.injected === base) this.onNoSensor({ waitedMs: performance.now() - startedAt });
    }, this.noDataMs);
  }

  stop() {
    this.running = false;
    clearTimeout(this.noDataTimer);
    window.removeEventListener('devicemotion', this.handler);
  }

  /**
   * 가짜 센서 값 넣기 (motion/synth.js 의 samples). realtime 이면 실제 시간 간격대로(화면이 따라 움직인다).
   * @returns {Promise<void>}
   */
  async inject(samples, { realtime = true, speed = 1 } = {}) {
    if (!samples?.length) return;
    const t0 = samples[0].t;
    const base = performance.now() / 1000;
    const wall0 = performance.now();
    this.injecting = true;
    try {
      await this._inject(samples, t0, base, wall0, realtime, speed);
    } finally {
      this.injecting = false;
    }
  }

  async _inject(samples, t0, base, wall0, realtime, speed) {
    for (const s of samples) {
      if (!this.running) return;
      if (realtime) {
        const due = ((s.t - t0) / speed) * 1000;
        const wait = due - (performance.now() - wall0);
        if (wait > 4) await new Promise((r) => setTimeout(r, wait));
      }
      this.injected++;
      this._feed({ ...s, t: base + (s.t - t0) });
    }
  }
}
