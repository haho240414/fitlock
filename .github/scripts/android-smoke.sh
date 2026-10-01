#!/usr/bin/env bash
# 에뮬레이터 점검: 설치 → 권한 → 실행 → 잠금 흐름을 단계별로 확인(lock-smoke.mjs) → 스크린샷·로그 저장
# 에뮬레이터가 멈춰도 점검이 끝없이 기다리지 않도록 adb 에 제한 시간을 둔다
set -uo pipefail
APK="$1"; OUT="$2"; PKG=io.github.haho240414.fitlock
mkdir -p "$OUT"
A() { timeout 90 adb "$@"; }
echo "== 설치"; A install -r -g "$APK" || exit 1
# '다른 앱 위에 표시'(특별 권한)와 배터리 최적화 예외는 사람이 설정 화면에서 켜는 것 — 점검에선 adb 로
A shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow
A shell dumpsys deviceidle whitelist +"$PKG"
A shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
# 화면을 끄면 바로 잠기게(키가드 확인용), 화면은 10분 동안 안 꺼지게
A shell settings put secure lock_screen_lock_after_timeout 0
A shell settings put secure lockscreen.power_button_instantly_locks 1
A shell settings put system screen_off_timeout 600000
A shell input keyevent 224
A shell wm dismiss-keyguard || true
A shell input keyevent 82 || true
A logcat -c
# 에뮬레이터가 막 부팅된 직후엔 실행 명령이 묻히기도 한다 → 프로세스가 뜰 때까지 최대 3번 (핸즈프리 PT 에서 겪음)
PID=""
for TRY in 1 2 3; do
  echo "== 실행 ($TRY)"; A shell am start -W -n "$PKG/.MainActivity"
  for _ in $(seq 1 15); do
    sleep 2
    PID="$(A shell pidof "$PKG" | tr -d '\r')"
    [ -n "$PID" ] && break
  done
  [ -n "$PID" ] && break
  A logcat -d > "$OUT/logcat_try$TRY.txt"
done
sleep 8 # WebView 가 화면을 그릴 시간
A exec-out screencap -p > "$OUT/1_home.png"
node .github/scripts/lock-smoke.mjs "$OUT" "$PKG"
STATUS=$?
A logcat -d > "$OUT/logcat.txt"
A shell dumpsys activity activities > "$OUT/activities.txt" 2>&1 || true
echo "== 점검 종료 코드 $STATUS"
exit $STATUS
