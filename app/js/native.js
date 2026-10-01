// 안드로이드 앱(Capacitor)으로 실행될 때만 쓰는 기능. 브라우저(개발용 미리 보기)에선 모두 null 이라 웹 대체 기능을 쓴다.
// 핸즈프리 PT(6ca21c1)의 native.js 를 바탕으로, 잠금 기능 플러그인(FitLock)을 더했다.

import { Capacitor, registerPlugin } from '../vendor/capacitor/core.js';

export const isNative = Capacitor.isNativePlatform();
export const isAndroid = Capacitor.getPlatform() === 'android';
const plugin = (name) => (isNative && Capacitor.isPluginAvailable(name) ? registerPlugin(name) : null);

export const NativeTTS = plugin('TextToSpeech');
export const NativeApp = plugin('App');
const NativeShare = plugin('Share');
const NativeFS = plugin('Filesystem');
// 앱 안의 플러그인(android/.../FitLockPlugin.kt): 잠금 서비스·권한·잠금 화면 닫기·장소
export const FitLock = isAndroid ? plugin('FitLock') : null;

export const canShareFile = !!(NativeShare && NativeFS);

/** 텍스트 파일을 공유 창으로 내보내기 (구글 드라이브·내 파일·카톡 등으로 저장) */
export async function shareTextFile(name, text, title = '핏락 백업') {
  const { uri } = await NativeFS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await NativeShare.share({ title, url: uri, dialogTitle: title });
}

/** 브라우저: 파일 내려받기 */
export function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 짧게 진동 (네이티브가 없으면 웹 진동) */
export function buzz(ms = 30) {
  if (FitLock) FitLock.vibrate({ ms }).catch(() => {});
  else navigator.vibrate?.(ms);
}
