// 카메라 모드: 폰을 세워 두고 전면 카메라 앞에서 운동 → 핸즈프리 PT 엔진(6ca21c1)으로 고른 운동만 1회째부터 센다.
// 카메라는 이 화면이 보일 때만 켜고(start), 숨겨지거나 끝나면 바로 끈다(stop). 영상은 저장·전송하지 않는다.
// 핸즈프리 PT workout.js 의 방식 그대로: 화면 갱신(rAF)마다 새 프레임이 왔는지 보고, AI 분석은 초당 15장만.

import { createPoseLandmarker, BONES } from './pose.js';
import { openCamera, widenCamera } from './camera.js';
import { Tracker } from './engine/tracker.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';
import { TiltSensor } from './tilt.js';

// GPU 안전장치: GPU 로 AI 를 켜는 동안 앱이 멈추면(일부 폰·에뮬레이터 실측) 다음엔 호환 모드(CPU)로.
export const GPU_GUARD = 'fitlock.gpuGuard';
const guard = (v) => { try { if (v) localStorage.setItem(GPU_GUARD, v); else localStorage.removeItem(GPU_GUARD); } catch { /* 무시 */ } };
const guarded = () => { try { return localStorage.getItem(GPU_GUARD) === 'starting'; } catch { return false; } };

let landmarker = null; // 한 번 만든 인식기는 다시 쓴다
let landmarkerDelegate = null;

/** 카메라로 셀 수 있는(검증된·반복) 운동만 */
export function cameraExercises() {
  const ids = ['squat', 'pushup', 'lunge', 'jumpingjack', 'burpee', 'climber', 'situp', 'bridge', 'sidelunge', 'press', 'curl', 'highknees'];
  return ids.map((id) => EXERCISE_BY_ID[id]).filter((e) => e && e.kind === 'reps');
}

export class CameraCounter {
  /**
   * @param {{video:HTMLVideoElement, canvas:HTMLCanvasElement, exercise:string, gpu?:boolean,
   *   camera?:{deviceId?:string, facing?:string}|null,
   *   onRep:(n:number)=>void, onStatus:(t:string)=>void, onCue?:(t:string)=>void,
   *   onFrame?:(f:{code:string,text:string,speak:boolean}|null, good:boolean)=>void}} o
   */
  constructor({ video, canvas, exercise = 'squat', gpu = true, camera = null, onRep, onStatus, onCue = () => {}, onFrame = () => {} }) {
    Object.assign(this, { video, canvas, exercise, gpu, camera, onRep, onStatus, onCue, onFrame });
    // 후면 카메라는 거울처럼 뒤집지 않고, 기울기 보정의 앞뒤 방향도 반대다
    this.back = camera?.facing === 'environment';
    this.running = false;
    this.stream = null;
    this.accum = 0;  // 이미 끊긴 세트의 횟수 (사람이 화면 밖으로 나갔다 오면 추적기가 세트를 끊는다)
    this.count = 0;
    this.frames = 0;
    this.tilt = new TiltSensor();
    this.inferEvery = 1000 / 15;
  }

  async start() {
    this.running = true;
    this.onStatus('카메라 켜는 중…');
    // 카메라가 안 되면(권한 거부·다른 앱이 사용 중) 여기서 오류 → 부른 쪽이 처리
    this.stream = await openCamera({ cameraWide: true, cameraId: this.camera?.deviceId || null });
    if (!this.running) { this.stop(); return; }
    await widenCamera(this.stream, true).catch(() => {});
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
    this.tilt.start();
    this.onStatus('AI 준비 중…');
    if (!landmarker) {
      const delegate = this.gpu && !guarded() ? 'auto' : 'CPU';
      if (delegate !== 'CPU') guard('starting');
      landmarker = await createPoseLandmarker({ model: 'full', delegate, onStatus: this.onStatus });
      landmarkerDelegate = landmarker.delegate;
    }
    if (!this.running) { this.stop(); return; }
    this.tracker = new Tracker({ fixed: this.exercise, minSetReps: 1, holdMin: 1, idleSec: 600 });
    const up = this._cameraUp();
    if (up) this.tracker.setCameraUp(up);
    this.t0 = performance.now();
    this.lastTs = 0;
    this.lastInferAt = 0;
    this.onStatus('폰을 세워 두고 2~3m 뒤로 가서, 무릎까지 보이게 서 주세요');
    this._loop();
  }

  get delegate() { return landmarkerDelegate; }

  _loop() {
    this.raf = requestAnimationFrame(() => {
      if (!this.running) return;
      const now = performance.now();
      if (now - this.lastInferAt >= this.inferEvery - 4 && this.video.readyState >= 2 && this.video.videoWidth) {
        this.lastInferAt = now;
        this._process(now);
      }
      this._loop();
    });
  }

  _process(now) {
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    let res;
    try {
      res = landmarker.detectForVideo(this.video, ts);
    } catch (e) {
      console.error(e);
      return;
    }
    this.frames++;
    if (this.frames === 60) guard(null); // GPU 로 60장 무사히 → 안전
    const lm = res.landmarks?.[0] || null;
    const wl = res.worldLandmarks?.[0] || null;
    if (this.frames % 30 === 0) { const up = this._cameraUp(); if (up) this.tracker.setCameraUp(up); }
    const events = this.tracker.update((now - this.t0) / 1000, lm, wl);
    this._draw(lm);
    if (this.frames % 5 === 0) this._framing(now);
    for (const e of events) {
      if (e.type === 'personFound') this.onStatus('좋아요! 시작하세요');
      if (e.type === 'setStart' || e.type === 'rep') {
        this.count = this.accum + e.count;
        this.onRep(this.count);
      } else if (e.type === 'setEnd') {
        this.accum += e.set.kind === 'hold' ? 0 : (e.set.reps || 0);
      } else if (e.type === 'cue' && e.text) {
        this.onCue(e.text);
      }
    }
  }

  /** 폰 기울기 센서로 본 '카메라 좌표의 위쪽'. 후면 카메라는 보는 방향이 화면 반대라 앞뒤(z)를 뒤집는다 */
  _cameraUp() {
    const up = this.tilt.cameraUp();
    if (!up || !this.back) return up;
    return [up[0], up[1], -up[2]];
  }

  /**
   * 자리 잡기 안내 (핸즈프리 PT workout.js _framing 그대로): 안 보이는 부위에 따라 어떻게 하면 되는지.
   * 세기 시작 전에만, 같은 문제가 1초 넘게 이어질 때 알린다. 잘 보이면 good=true 한 번.
   */
  _framing(now) {
    if (this.count > 0) return;
    const raw = this.tracker.snapshot().raw;
    let f = null;
    if (raw) {
      const s = raw.seen || {};
      if (raw.torsoFrac > 0.42) f = { code: 'close', text: '너무 가까워요. 한두 걸음 뒤로 가 주세요', speak: true };
      else if (!s.knees) f = { code: 'knees', text: '무릎까지 보이게 뒤로 가거나 폰을 낮춰 주세요', speak: true };
      else if (!s.head) f = { code: 'head', text: '머리까지 보이게 폰을 세우거나 뒤로 가 주세요', speak: true };
      else if (raw.cutoff) f = { code: 'edge', text: '몸 일부가 화면 밖이에요. 가운데로 와 주세요', speak: false };
    } else f = { code: 'none', text: this.back ? '폰 뒷면(카메라) 앞에 전신이 보이게 서 주세요' : '전신이 보이게 서 주세요', speak: false };
    if (f?.code !== this.frameCode) { this.frameCode = f?.code ?? null; this.frameSince = now; }
    if (f && now - this.frameSince < 1000) return;
    if (!f) {
      if (!this.framedOk && now - this.frameSince > 1200) { this.framedOk = true; this.onFrame(null, true); }
      return;
    }
    this.framedOk = false;
    this.onFrame(f, false);
  }

  _draw(lm) {
    const c = this.canvas;
    const v = this.video;
    if (!c || !v.videoWidth) return;
    const W = c.clientWidth * Math.min(2, devicePixelRatio || 1);
    const H = c.clientHeight * Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(W) || c.height !== Math.round(H)) { c.width = Math.round(W); c.height = Math.round(H); }
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    // object-fit: contain 과 같은 자리에 그린다
    const s = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    const ox = (c.width - w) / 2, oy = (c.height - h) / 2;
    const P = (i) => [ox + lm[i].x * w, oy + lm[i].y * h];
    g.lineWidth = Math.max(3, c.width * 0.008);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(200,245,60,.9)';
    for (const [a, b] of BONES) {
      if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
      const [x1, y1] = P(a), [x2, y2] = P(b);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.tilt.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}

// 앱을 스스로 내린 경우는 GPU 탓이 아니다
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guard(null); });
