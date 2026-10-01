# 핏락 (가칭)

**운동을 해야 열리는 안드로이드 잠금화면.** 화면을 켜면 "스쿼트 10개 하면 열려요"가 먼저 뜨고,
폰을 가슴에 대고 스쿼트를 하면(또는 폰을 세워 두고 카메라 앞에서 운동하면) 횟수를 세서 열어 준다.
캐시워크처럼 잠금화면에서 오늘 기록·포인트·연속 기록이 보이고, 미션·레벨로 계속 쓰게 만든다.

> ⚠️ 이건 **운동 습관용 잠금**이지 보안 잠금이 아니다. 폰의 PIN·지문 잠금은 그 뒤에 그대로 있고,
> '급할 때 그냥 열기'·긴급 전화·홈 버튼으로 언제든 나갈 수 있다. 전화가 오면 바로 비킨다.

- 안드로이드 전용 (iOS 는 다른 앱이 잠금화면 위에 화면을 띄울 수 없다)
- [핸즈프리 PT](https://github.com/haho240414/handsfree-pt)의 변주: 카메라 운동 인식 엔진을 그대로 가져와 '카메라 모드'에 쓴다

## 핸즈프리 PT 에서 가져온 것

핸즈프리 PT 저장소(`~/Documents/handsfree-workout`)의 **커밋 6ca21c1** 에서 아래 파일을 그대로 복사했다.
엔진이 좋아지면 같은 경로끼리 비교해서 옮기면 된다 (`git -C ~/Documents/handsfree-workout diff 6ca21c1 -- app/js/engine`).

| 파일 | 쓰는 곳 |
|---|---|
| `app/js/engine/` (features·filters·counter·exercises·tracker·tempo) | 카메라 모드: 고른 운동만 1회째부터 센다 (`new Tracker({ fixed, minSetReps: 1, holdMin: 1, idleSec: 600 })`) |
| `app/js/pose.js`, `app/vendor/mediapipe/` | 포즈 인식(MediaPipe, 폰 안에서 처리 — 영상은 밖으로 안 나감) |
| `app/js/camera.js`, `app/js/tilt.js`, `app/js/voice.js` | 전면 카메라(4:3 넓게), 폰 기울기 보정, 한국어 숫자 음성 |
| `app/js/demo.js`, `app/data/demos.json` | 할 동작을 막대 인형으로 보여주기 |
| `app/vendor/capacitor/core.js` | 번들러 없이 Capacitor 쓰기 |
| `tools/serve.mjs`, `test/unit/synth.mjs`, `test/fixtures/squat_*.full.json` | 개발 서버, 합성 스켈레톤, 스쿼트 정답 영상 관절 좌표 |

## 폰 들고 세기 (새로 만든 것)

카메라는 폰을 2~3m 떨어진 곳에 세워야 해서 잠금을 풀 때마다 쓰기엔 번거롭다. 그래서 기본은 **폰을 두 손으로 가슴에 대고 스쿼트**,
가속도·회전 센서로 센다 (`app/js/motion/rep-sensor.js`).

- 중력 방향으로 본 가속도를 두 번 '새는 적분'해서 폰 높이 변화를 어림 → 위 → 아래(13cm 이상) → 위면 1회
- 동작 모양도 본다: 1초 안에 아래로 빨라졌다가, 일어선 끝에서 1초 안에 멈춰 서야 한다 → 앉은 채 가만히 있기·폰 들어 올리기는 안 셈
- 폰을 크게 돌리는 중(만지작)엔 안 셈
- **아직 실제 폰 데이터로 맞추지 않았다.** 물리 모델로 만든 가짜 센서 값(`app/js/motion/synth.js`)으로 17가지 상황 × 폰 드는 방향 8가지를 채점해 맞춘 출발점이다 (`node tools/motion-eval.mjs`):
  보통·빠른·느린·깊은 스쿼트·런지는 거의 정확, 반 스쿼트는 첫 회를 가끔 놓침, 걷기·버스는 1분에 0~1회, 앉아서 가만히·엘리베이터·만지작은 0회.
  실제 폰에서 센서 기록을 받아 다시 맞춘다

## 개발

```bash
npm install
npm test                         # 단위 테스트
node tools/motion-eval.mjs       # 폰 들고 세기 채점 (가짜 센서 시나리오)
npm run serve                    # http://127.0.0.1:8870 (브라우저에서 화면 확인)
```
