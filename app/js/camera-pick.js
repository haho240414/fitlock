// 카메라 고르기: 시야가 넓은 카메라일수록 폰을 가까이 둬도 전신이 들어온다.
// - 웹(WebView)은 카메라 목록만 알고 시야각은 모른다 → 네이티브(FitLock.listCameras)가 렌즈 초점거리·센서 크기로 계산한 값을 붙인다.
//   WebView 카메라 이름의 번호('camera 2, facing back')가 네이티브 목록의 순서(index)다.
// - WebView 줌은 잘라 내기 방식이라 1배 아래(초광각)로 못 간다(Chromium VideoCaptureCamera2) → 넓게 보려면 따로 보이는 광각 카메라를 골라야 한다.
// - 후면 카메라는 시야가 가장 넓은 경우가 많지만 화면이 반대쪽이라 숫자는 소리로만 들린다.

import { FitLock } from './native.js';
import { listCameras } from './camera.js';

/** 폰을 허리 높이에 세웠을 때 머리~발(여유 포함 2m)이 다 들어오는 거리(m) */
export function distanceFor(fovLong) {
  if (!Number.isFinite(fovLong) || fovLong <= 0) return null;
  return Math.round((1.0 / Math.tan(((fovLong * Math.PI) / 180) / 2)) * 10) / 10;
}

/**
 * 이 폰의 카메라 목록 (시야가 넓은 순). 카메라 권한이 있어야 이름이 보인다.
 * @returns {Promise<{deviceId:string, label:string, facing:'user'|'environment'|'', fovLong:number|null, fovDiag:number|null, distance:number|null, name:string, wide:boolean}[]>}
 */
export async function cameraOptions() {
  const web = await listCameras();
  let nat = [];
  if (FitLock) {
    try { nat = (await FitLock.listCameras()).cameras || []; } catch { nat = []; }
  }
  const list = web.filter((c) => !/infrared/i.test(c.label)).map((c, i) => {
    const m = /camera2?\s*(\d+)/i.exec(c.label || '');
    const idx = m ? Number(m[1]) : i;
    const n = nat.find((x) => x.index === idx);
    const facing = n?.facing === 'front' ? 'user' : n?.facing === 'back' ? 'environment' : c.facing;
    const fovLong = Number.isFinite(n?.fovLong) ? n.fovLong : null;
    return {
      deviceId: c.id, label: c.label, facing, fovLong, fovShort: n?.fovShort ?? null,
      fovDiag: Number.isFinite(n?.fovDiag) ? n.fovDiag : null, distance: distanceFor(fovLong), index: idx,
    };
  });
  // 이름: 전면/후면 + 같은 쪽에서 가장 넓고(다른 것보다 8° 넘게) 넓으면 '광각', 후면은 '초광각'
  for (const side of ['user', 'environment']) {
    const same = list.filter((c) => c.facing === side);
    const known = same.filter((c) => c.fovLong != null).sort((a, b) => b.fovLong - a.fovLong);
    same.forEach((c, k) => { c.name = `${side === 'user' ? '전면' : '후면'}${same.length > 1 ? ` ${k + 1}` : ''}`; });
    if (known.length >= 2 && known[0].fovLong - known[1].fovLong > 8) {
      known[0].wide = true;
      known[0].name = side === 'user' ? '전면 광각' : '후면 초광각';
    }
  }
  for (const c of list) if (!c.name) c.name = '카메라';
  return list.sort((a, b) => (b.fovLong ?? 0) - (a.fovLong ?? 0));
}

/** 자동: 화면을 보면서 할 수 있는 전면 카메라 중 가장 넓은 것 */
export function autoCamera(list) {
  const front = list.filter((c) => c.facing === 'user');
  return front[0] || list[0] || null;
}

/** 설정에 저장할 모양 */
export const toSetting = (c) => (c ? {
  deviceId: c.deviceId, facing: c.facing, name: c.name, fovLong: c.fovLong, distance: c.distance,
} : null);

/** 고른 카메라 설명 한 줄 */
export function describe(c) {
  if (!c) return '자동 (전면)';
  const fov = c.fovLong ? ` · 시야 ${Math.round(c.fovLong)}°` : '';
  const dist = c.distance ? ` · 약 ${c.distance}m 떨어져서` : '';
  return `${c.name}${fov}${dist}`;
}
