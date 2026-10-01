// MediaPipe 포즈 인식기 준비 (앱 폴더 안의 파일만 사용 → 한 번 받으면 오프라인에서도 동작)

let visionMod = null;
let fileset = null;

/** delegate: 'auto' = GPU 먼저, 안 되면 CPU / 'CPU' = 호환 모드(일부 폰·에뮬레이터의 GPU 문제 회피) */
export async function createPoseLandmarker({ model = 'full', delegate = 'auto', onStatus = () => {} } = {}) {
  onStatus('AI 엔진 불러오는 중…');
  visionMod ||= await import('../vendor/mediapipe/vision_bundle.js');
  const { PoseLandmarker, FilesetResolver } = visionMod;
  fileset ||= await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
  const modelUrl = new URL(`../vendor/mediapipe/models/pose_landmarker_${model}.task`, import.meta.url).href;
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  onStatus(model === 'full' ? '자세 인식 모델(정확) 불러오는 중…' : '자세 인식 모델(빠름) 불러오는 중…');
  if (delegate === 'CPU') {
    const lm = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    lm.delegate = 'CPU';
    return lm;
  }
  try {
    const lm = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
    lm.delegate = 'GPU';
    return lm;
  } catch (e) {
    console.warn('GPU 가속 실패, CPU로 전환', e);
    const lm = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    lm.delegate = 'CPU';
    return lm;
  }
}

// 화면에 그릴 뼈대 연결 (얼굴 제외)
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [27, 29], [28, 30],
];
export const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
