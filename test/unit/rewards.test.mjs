import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, normalize, recordSession, recordSkip, skipsLeft, claimMission, missionsFor, missionIds, buy,
  levelInfo, levelThreshold, streakInfo, dayKey, addDays, daysBetween, ingestNativeEvents, weekDots, todaySummary,
  POINTS, MISSIONS,
} from '../../app/js/rewards.js';
import { mergeDeep, DEFAULT_SETTINGS } from '../../app/js/store.js';

const at = (s) => new Date(s).getTime(); // 이 기기 시간대 기준 '2026-10-01T08:30'

test('날짜 계산', () => {
  assert.equal(dayKey(at('2026-10-01T23:59')), '2026-10-01');
  assert.equal(addDays('2026-10-01', 1), '2026-10-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-09-30', '2026-10-02'), 2);
});

test('잠금 해제 운동: 횟수 + 해제 보너스 + 출석, 같은 날 두 번째엔 출석 없음', () => {
  const s = emptyState();
  const r1 = recordSession(s, { kind: 'unlock', reps: 10, target: 10, at: at('2026-10-01T08:30'), name: '스쿼트' });
  assert.equal(r1.total, 10 * POINTS.perRep + POINTS.unlockBonus + POINTS.attendance);
  assert.deepEqual(r1.gains.map((g) => g.label), ['스쿼트 10개', '운동으로 잠금 해제', '오늘 첫 운동 (출석)']);
  const r2 = recordSession(s, { kind: 'unlock', reps: 12, target: 10, at: at('2026-10-01T12:00') });
  assert.equal(r2.total, 12 + POINTS.unlockBonus);
  assert.equal(s.points, r1.total + r2.total);
  assert.equal(s.earned, s.points);
  const d = s.days['2026-10-01'];
  assert.equal(d.unlocks, 2);
  assert.equal(d.reps.squat, 22);
  assert.equal(d.morning, true);
  assert.equal(d.extra, undefined); // 12 < 10+5
});

test('연속 기록: 이어지면 +1, 하루 건너뛰면 1부터, 보호권이 있으면 지켜 준다, 3일째 보너스', () => {
  const s = emptyState();
  recordSession(s, { reps: 10, target: 10, at: at('2026-10-01T09:00') });
  recordSession(s, { reps: 10, target: 10, at: at('2026-10-02T09:00') });
  const r3 = recordSession(s, { reps: 10, target: 10, at: at('2026-10-03T09:00') });
  assert.equal(s.streak.count, 3);
  assert.ok(r3.gains.some((g) => g.label === '3일 연속 달성' && g.pts === 20));
  // 10/04 쉼 → 10/05: 끊김
  recordSession(s, { reps: 10, target: 10, at: at('2026-10-05T09:00') });
  assert.equal(s.streak.count, 1);
  assert.equal(s.streak.best, 3);
  // 보호권 1장 → 10/06 쉼 → 10/07: 이어짐
  s.inv.freezes = 1;
  assert.equal(streakInfo(s, '2026-10-07').alive, true);
  recordSession(s, { reps: 10, target: 10, at: at('2026-10-07T09:00') });
  assert.equal(s.streak.count, 2);
  assert.equal(s.inv.freezes, 0);
  assert.deepEqual(s.streak.frozen, ['2026-10-06']);
  // 이틀 쉬면(보호권 없음) 오늘 기준으로 끊긴 것으로 보인다
  assert.equal(streakInfo(s, '2026-10-10').count, 0);
  assert.equal(streakInfo(s, '2026-10-08').atRisk, true);
});

test('횟수 0 인 기록은 연속 기록·출석을 만들지 않는다', () => {
  const s = emptyState();
  const r = recordSession(s, { kind: 'practice', reps: 0, at: at('2026-10-01T09:00') });
  assert.equal(r.total, 0);
  assert.equal(s.streak.count, 0);
  // 그 뒤 실제 운동은 그날 첫 운동(출석)으로 친다
  const r2 = recordSession(s, { kind: 'unlock', reps: 10, target: 10, at: at('2026-10-01T10:00') });
  assert.ok(r2.gains.some((g) => g.label === '오늘 첫 운동 (출석)'));
});

test('건너뛰기: 무료 3번 → 그다음은 건너뛰기권 → 없으면 기록만', () => {
  const s = emptyState();
  const t = at('2026-10-01T10:00');
  for (let i = 0; i < 3; i++) assert.equal(recordSkip(s, { at: t, freeLimit: 3 }).free, true);
  s.inv.skipTickets = 1;
  assert.equal(skipsLeft(s, 3, t), 1);
  const r4 = recordSkip(s, { at: t, freeLimit: 3 });
  assert.deepEqual([r4.free, r4.ticketUsed], [true, true]);
  const r5 = recordSkip(s, { at: t, freeLimit: 3 });
  assert.deepEqual([r5.free, r5.ticketUsed], [false, false]);
  assert.equal(s.days['2026-10-01'].skips, 5);
  assert.equal(skipsLeft(s, 3, t), 0);
  assert.equal(s.points, 0); // 포인트를 뺏지는 않는다
});

test('오늘의 미션: 날짜마다 3개, 하루 동안 같고, 다 하면 받기, 두 번은 못 받음', () => {
  const ids = missionIds('2026-10-01');
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(missionIds('2026-10-01'), ids);
  assert.ok(MISSIONS.find((m) => m.id === ids[0]).group === 'reps');
  // 여러 날짜에서 늘 서로 다른 3개
  for (let i = 0; i < 60; i++) assert.equal(new Set(missionIds(addDays('2026-10-01', i))).size, 3);

  const s = emptyState();
  const t = at('2026-10-01T08:00');
  for (let i = 0; i < 10; i++) recordSession(s, { kind: 'unlock', reps: 12, target: 10, at: t, mode: i ? 'sensor' : 'camera' });
  recordSession(s, { kind: 'practice', reps: 15, target: 10, at: t });
  const ms = missionsFor(s, '2026-10-01');
  const done = ms.filter((m) => m.done);
  assert.ok(done.length >= 1);
  const pointsBefore = s.points;
  const r = claimMission(s, done[0].id, { at: t });
  assert.equal(r.ok, true);
  assert.equal(s.points, pointsBefore + done[0].reward);
  assert.equal(claimMission(s, done[0].id, { at: t }).ok, false);
  assert.equal(claimMission(s, 'nope', { at: t }).ok, false);
});

test('건너뛰면 "건너뛰지 않고" 미션은 실패로 보인다', () => {
  const s = emptyState();
  // noskip 미션이 나오는 날을 찾는다
  let key = '2026-10-01';
  for (let i = 0; i < 200 && !missionIds(key).includes('noskip'); i++) key = addDays(key, 1);
  const t = at(`${key}T10:00`);
  recordSession(s, { kind: 'unlock', reps: 10, target: 10, at: t });
  recordSkip(s, { at: t });
  const m = missionsFor(s, key).find((x) => x.id === 'noskip');
  assert.equal(m.failed, true);
  assert.equal(m.done, false);
});

test('레벨: 0·100·300·600… 에서 오른다', () => {
  assert.equal(levelThreshold(1), 0);
  assert.equal(levelThreshold(2), 100);
  assert.equal(levelThreshold(5), 1000);
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  assert.equal(levelInfo(650).level, 4);
  assert.ok(levelInfo(150).frac > 0.2 && levelInfo(150).frac < 0.3);
  const s = emptyState();
  s.earned = 95;
  const r = recordSession(s, { reps: 10, target: 10, at: at('2026-10-01T10:00') });
  assert.deepEqual(r.levelUp, { from: 1, to: 2 });
});

test('상점: 포인트가 모자라면 못 사고, 개수 제한, 테마는 한 번만', () => {
  const s = emptyState();
  assert.equal(buy(s, 'skip').ok, false);
  s.points = 1000;
  assert.equal(buy(s, 'skip').ok, true);
  assert.equal(s.inv.skipTickets, 1);
  assert.equal(s.points, 950);
  assert.equal(buy(s, 'freeze').ok, true);
  assert.equal(buy(s, 'freeze').ok, true);
  assert.equal(buy(s, 'freeze').ok, false); // 최대 2장
  assert.equal(buy(s, 'theme:ocean').ok, true);
  assert.equal(s.inv.theme, 'ocean');
  assert.equal(buy(s, 'theme:ocean').ok, false);
  assert.equal(s.earned, 0); // 써도 레벨 기준은 안 줄어든다
});

test('네이티브 이벤트는 한 번만 반영 (건너뛰기·홈 = 건너뛰기, 전화·통과 = 기록만)', () => {
  const s = emptyState();
  const t = at('2026-10-01T10:00');
  const evs = [
    { id: 'a', type: 'skip', at: t }, { id: 'b', type: 'home', at: t },
    { id: 'c', type: 'call', at: t }, { id: 'd', type: 'pass', at: t },
  ];
  ingestNativeEvents(s, evs, { freeLimit: 3 });
  ingestNativeEvents(s, evs, { freeLimit: 3 });
  assert.equal(s.days['2026-10-01'].skips, 2);
  assert.equal(s.log.filter((l) => l.kind === 'pass').length, 2);
});

test('이번 주 점·오늘 요약', () => {
  const s = emptyState();
  recordSession(s, { reps: 10, target: 10, at: at('2026-09-29T10:00') }); // 화
  recordSession(s, { reps: 12, target: 10, at: at('2026-10-01T10:00') }); // 목
  const w = weekDots(s, '2026-10-01');
  assert.equal(w.length, 7);
  assert.equal(w[0].key, '2026-09-28'); // 월요일
  assert.deepEqual(w.map((x) => x.done), [false, true, false, true, false, false, false]);
  assert.equal(w[3].today, true);
  assert.equal(w[4].future, true);
  assert.deepEqual(todaySummary(s, '2026-10-01'), { reps: 12, unlocks: 1, practice: 0, skips: 0, pts: 12 + 5 + 10 });
});

test('깨진 저장값도 쓸 수 있게 채운다, 설정은 기본값 위에 덮는다', () => {
  assert.deepEqual(normalize(null).inv.themes, ['basic']);
  const n = normalize({ points: 5, inv: { freezes: 1 } });
  assert.equal(n.points, 5);
  assert.equal(n.inv.freezes, 1);
  assert.equal(n.inv.skipTickets, 0);
  const st = mergeDeep(DEFAULT_SETTINGS, { target: 15, lock: { enabled: true, schedule: { enabled: false } } });
  assert.equal(st.target, 15);
  assert.equal(st.lock.enabled, true);
  assert.equal(st.lock.freeMinutes, 60);
  assert.equal(st.lock.schedule.enabled, false);
  assert.equal(st.lock.schedule.windows.length, 1);
  assert.equal(DEFAULT_SETTINGS.lock.enabled, false); // 기본값은 그대로
});
