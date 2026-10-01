// 폰 들고 세기(motion/rep-sensor.js) — 물리 모델로 만든 가짜 센서 값(motion/synth.js)으로 확인한다.
// 실제 폰 기록을 받으면 test/fixtures/motion/ 에 넣고 같은 방식으로 채점한다(tools/motion-eval.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { synthMotion, SCENARIOS } from '../../app/js/motion/synth.js';
import { PhoneRepCounter, sampleFromEvent } from '../../app/js/motion/rep-sensor.js';

const HOLDS = ['portrait', 'reading', 'landscape', 'flat'];
const SEEDS = [1, 2, 3];

function count(name, extra = {}, exercise) {
  const out = [];
  for (const hold of HOLDS) for (const seed of SEEDS) {
    const { samples } = synthMotion({ seed: seed * 7919 + name.length, hold, ...extra, ...SCENARIOS[name] });
    const c = new PhoneRepCounter({ exercise });
    for (const s of samples) c.push(s);
    out.push(c.count);
  }
  return out;
}
const share = (xs, f) => xs.filter(f).length / xs.length;

test('보통 속도 스쿼트 10회는 폰을 어떻게 들어도 10회', () => {
  const n = count('squat10');
  assert.ok(n.every((x) => x === 10), `결과 ${n}`);
});

test('빠른·느린·깊은 스쿼트, 런지, 들어 올리고 바로 하기: 거의 정확', () => {
  for (const [name, ex] of [['squat10fast'], ['squat10slow'], ['squat10deep'], ['lunge10', 'lunge'], ['pickupThenSquat']]) {
    const n = count(name, {}, ex);
    assert.ok(n.every((x) => Math.abs(x - 10) <= 1), `${name}: ${n}`);
    assert.ok(share(n, (x) => x === 10) >= 0.9, `${name} 정확 비율: ${n}`);
  }
});

test('얕은(반) 스쿼트도 대부분 센다 (첫 회를 놓칠 때가 있음)', () => {
  const n = count('squat10shallow');
  assert.ok(n.every((x) => x >= 9), `결과 ${n}`);
});

test('가만히 들고 있기·만지작·앉아서 가만히·엘리베이터는 세지 않는다', () => {
  for (const name of ['still60', 'handle20', 'sitStay', 'sitStand', 'elevator', 'jog30']) {
    const n = count(name);
    assert.ok(n.every((x) => x === 0), `${name}: ${n}`);
  }
});

test('걷기·버스는 1분에 많아야 1회, 대부분 0', () => {
  for (const name of ['walk60', 'bus60']) {
    const n = count(name);
    assert.ok(n.every((x) => x <= 1), `${name}: ${n}`);
    assert.ok(share(n, (x) => x === 0) >= 0.75, `${name}: ${n}`);
  }
});

test('까딱 수준(7~10cm)은 대부분 세지 않는다', () => {
  const n = count('quarter10');
  assert.ok(n.reduce((a, b) => a + b, 0) / n.length <= 1, `결과 ${n}`);
});

test('중력 뺀 값이 없는 폰(가속도만)에서도 보통 스쿼트는 센다', () => {
  const n = count('squat10', { linear: false });
  assert.ok(n.every((x) => Math.abs(x - 10) <= 1), `결과 ${n}`);
});

test('횟수 이벤트는 1부터 차례로, 깊이 막대는 음수가 아니다', () => {
  const { samples } = synthMotion({ seed: 5, ...SCENARIOS.squat10 });
  const c = new PhoneRepCounter();
  const reps = [];
  for (const s of samples) {
    for (const e of c.push(s)) if (e.type === 'rep') reps.push(e.count);
    assert.ok(c.depthNow >= 0);
  }
  assert.deepEqual(reps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('표본이 끊겼다 이어지면 새로 시작하고, 이상한 값은 무시한다', () => {
  const c = new PhoneRepCounter();
  assert.deepEqual(c.push({ t: 0, aig: null }), []);
  assert.deepEqual(c.push({ t: 0, aig: [NaN, 0, 0] }), []);
  const { samples } = synthMotion({ seed: 9, ...SCENARIOS.squat10 });
  for (const s of samples) c.push({ ...s, t: s.t + 100 });
  assert.equal(c.count, 10);
});

test('DeviceMotionEvent → 표본', () => {
  const e = {
    accelerationIncludingGravity: { x: 0.1, y: 9.8, z: 0.2 },
    acceleration: { x: 0, y: 0.1, z: 0 },
    rotationRate: { alpha: 1, beta: 2, gamma: 3 },
  };
  assert.deepEqual(sampleFromEvent(e, 1.5), { t: 1.5, aig: [0.1, 9.8, 0.2], acc: [0, 0.1, 0], rot: [1, 2, 3] });
  assert.deepEqual(sampleFromEvent({ accelerationIncludingGravity: { x: null } }, 0), { t: 0, aig: null, acc: null, rot: null });
});
