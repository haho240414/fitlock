// 폰 기울기 센서 → '카메라 좌표에서 본 진짜 위쪽'.
// 폰을 바닥에 두고 벽에 기대면 카메라가 위를 올려다본다. AI 의 3D 좌표는 카메라 기준이라 그만큼 몸이 기운 것처럼
// 보이는데(시뮬레이션: 25° 기울면 인식 18 → 10~15개), 센서로 잰 각도로 되돌리면 원래대로 돌아온다(test/robust.mjs).
// 앞뒤 기울기(pitch)만 쓴다: 좌우 기울기는 전면 카메라 좌우반전 여부에 따라 부호가 바뀌어 잘못 보정할 위험이 있다.

export class TiltSensor {
  constructor() {
    this.g = null; // 부드럽게 한 가속도(중력 포함, 기기 좌표 m/s²)
    this.onMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      const v = [a.x, a.y, a.z];
      this.g = this.g ? this.g.map((x, i) => x + 0.1 * (v[i] - x)) : v;
    };
  }

  /**
   * 시작 버튼 탭 안에서 호출. iOS 는 권한을 물어야 센서 값이 온다.
   * 최신 크롬에도 requestPermission 이 생겼는데 거절·오류가 나도 값은 오는 경우가 있어서, 결과와 상관없이 듣는다
   * (값이 안 오면 보정 없이 그대로 동작).
   */
  start() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().catch(() => {});
      }
    } catch { /* 무시 */ }
    window.removeEventListener('devicemotion', this.onMotion);
    window.addEventListener('devicemotion', this.onMotion);
  }

  stop() {
    window.removeEventListener('devicemotion', this.onMotion);
    this.g = null;
  }

  /**
   * 카메라 좌표(x 오른쪽, y 아래, z 카메라가 보는 쪽 = 사람 쪽)에서 본 위쪽 단위벡터.
   * 폰을 들고 움직이는 중이거나 값이 없으면 null.
   */
  cameraUp() {
    const g = this.g;
    if (!g) return null;
    const mag = Math.hypot(...g);
    if (mag < 7 || mag > 12.5) return null; // 들고 움직이는 중
    // 화면 회전(가로 모드)에 맞춰 '화면 위쪽' 성분을 뽑는다
    const ang = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    let up = g[0] * Math.sin(ang) + g[1] * Math.cos(ang);
    let z = g[2];
    // 표준(안드로이드)은 '위로 받치는 힘'을, 일부 iOS 는 '중력' 방향을 준다(부호 반대).
    // 운동할 땐 폰 화면 위쪽이 실제 위를 향하므로(아니면 사람이 거꾸로 찍힘) 그쪽이 +가 되게 맞춘다.
    if (up < 0) { up = -up; z = -z; }
    // 화면 위쪽 = 카메라 -y, 화면 바깥(사람 쪽) = 카메라 +z
    const n = Math.hypot(up, z);
    if (!n) return null;
    const res = [0, -up / n, z / n];
    const deg = (Math.acos(Math.min(1, up / n)) * 180) / Math.PI;
    return deg <= 50 ? res : null; // 거의 눕혀 둔 폰은 보정하지 않는다
  }

  /** 앞뒤 기울기(도). + = 위를 올려다봄(뒤로 기댐), - = 아래를 내려다봄 */
  pitchDeg() {
    const u = this.cameraUp();
    return u ? (Math.atan2(u[2], -u[1]) * 180) / Math.PI : null;
  }
}
