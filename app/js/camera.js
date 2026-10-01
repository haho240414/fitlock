// 카메라 고르기·넓게 보기.
// 폰마다 다르다: 전면 광각이 따로 된 카메라로 보이는 폰, 줌을 1배 아래로 내릴 수 있는 폰(그게 광각), 둘 다 안 되는 폰.
// 어느 폰이든 되는 것: 센서 전체(4:3)로 찍기 — 16:9 로 찍으면 세로 화면에서 좌우가 25% 잘려 나간다.

const SIZE = {
  wide: { width: { ideal: 1280 }, height: { ideal: 960 } },  // 4:3 = 센서 전체
  normal: { width: { ideal: 1280 }, height: { ideal: 720 } }, // 16:9
};

/** 설정대로 카메라를 연다. 고른 카메라가 없어졌으면(다른 폰·초기화) 전면 기본으로 */
export async function openCamera(st) {
  const size = st.cameraWide ? SIZE.wide : SIZE.normal;
  const want = st.cameraId ? { deviceId: { exact: st.cameraId }, ...size } : { facingMode: 'user', ...size };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: want, audio: false });
  } catch (e) {
    if (st.cameraId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...size }, audio: false });
    }
    throw e;
  }
}

/** 넓게 보기: 줌을 가장 작게(1배 미만이면 광각 렌즈로 바뀌는 폰이 있다). 실제로 잡힌 카메라 정보를 돌려준다 */
export async function widenCamera(stream, wide) {
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  let set = track.getSettings?.() || {};
  if (wide && caps.zoom && Number.isFinite(caps.zoom.min) && caps.zoom.min < (set.zoom ?? 1)) {
    try { await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }); } catch { /* 줌 조절 안 됨 */ }
    set = track.getSettings?.() || set;
  }
  return {
    label: track.label || '',
    facing: set.facingMode || facingFromLabel(track.label),
    width: set.width ?? null, height: set.height ?? null,
    zoom: set.zoom ?? null, zoomMin: caps.zoom?.min ?? null,
  };
}

export function facingFromLabel(label = '') {
  if (/front|user|전면|facetime/i.test(label)) return 'user';
  if (/back|rear|environment|후면/i.test(label)) return 'environment';
  return '';
}

/**
 * 설정 화면용: 이 폰의 카메라 목록. 이름·방향은 카메라 권한이 있어야 보여서 잠깐 켰다 끄고,
 * 카메라마다 잠깐 열어 방향과 줌 범위를 확인한다(줌 1배 미만 = 광각).
 */
export async function listCameras() {
  let tmp = null;
  try { tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch { /* 권한 거부 */ }
  tmp?.getTracks().forEach((t) => t.stop());
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const out = [];
  for (const [i, d] of devs.entries()) {
    let info = { facing: facingFromLabel(d.label), zoomMin: null, maxW: null, maxH: null };
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } }, audio: false });
      const t = s.getVideoTracks()[0];
      const caps = t.getCapabilities?.() || {};
      const set = t.getSettings?.() || {};
      info = {
        facing: set.facingMode || caps.facingMode?.[0] || info.facing,
        zoomMin: caps.zoom?.min ?? null, maxW: caps.width?.max ?? null, maxH: caps.height?.max ?? null,
      };
      s.getTracks().forEach((x) => x.stop());
    } catch { /* 지금은 열 수 없는 카메라 */ }
    out.push({ id: d.deviceId, label: d.label || `카메라 ${i + 1}`, ...info });
  }
  return out;
}

/** 목록 표시 이름: 전면 1 · 광각 (줌 0.6배까지) */
export function cameraNames(cams) {
  const seen = {};
  return cams.map((c) => {
    const side = c.facing === 'user' ? '전면' : c.facing === 'environment' ? '후면' : '카메라';
    seen[side] = (seen[side] || 0) + 1;
    const zoomWide = c.zoomMin != null && c.zoomMin < 1;
    const wide = /wide|광각|ultra/i.test(c.label) || zoomWide ? ' · 광각' : '';
    const zoom = zoomWide ? ` (줌 ${Math.round(c.zoomMin * 10) / 10}배까지)` : '';
    return `${side} ${seen[side]}${wide}${zoom}`;
  });
}
