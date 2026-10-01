// 센서 기록: 16비트로 줄여 저장해도 세기 결과가 같아야 하고, 사용자가 보낸 실제 기록(test/fixtures/motion)은 정답과 맞아야 한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthMotion, SCENARIOS } from '../../app/js/motion/synth.js';
import { SensorRecorder, unpackRecording } from '../../app/js/sensorlog.js';
import { PhoneRepCounter } from '../../app/js/motion/rep-sensor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const countOf = (samples, exercise) => {
  const c = new PhoneRepCounter({ exercise });
  for (const s of samples) c.push(s);
  return c.count;
};

test('저장 모양(16비트)으로 줄였다 풀어도 같은 횟수', () => {
  for (const [name, seed] of [['squat10', 4], ['squat10fast', 5], ['walk60', 6]]) {
    const { samples } = synthMotion({ seed, ...SCENARIOS[name] });
    const rec = new SensorRecorder();
    for (const s of samples) rec.add({ ...s, t: s.t + 500 });
    const packed = rec.pack({ id: 'x', exercise: 'squat' });
    assert.equal(packed.n, Math.min(samples.length, packed.n));
    const back = unpackRecording(packed);
    assert.ok(Math.abs(back[10].aig[1] - samples[10].aig[1]) < 0.006);
    assert.equal(countOf(back), countOf(samples), name);
  }
});

test('중력 뺀 값·회전이 없는 기록도 풀린다', () => {
  const { samples } = synthMotion({ seed: 2, linear: false, rotation: false, ...SCENARIOS.squat10 });
  const rec = new SensorRecorder();
  for (const s of samples) rec.add(s);
  const p = rec.pack({ id: 'y' });
  assert.equal(p.hasAcc, false);
  assert.equal(p.hasRot, false);
  const back = unpackRecording(p);
  assert.equal(back[0].acc, null);
  assert.equal(back[0].rot, null);
});

const dir = path.join(ROOT, 'test/fixtures/motion');
const real = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
test(`실제 폰 기록 ${real.length}개: 정답과 같은 횟수`, { skip: real.length === 0 && '아직 실제 기록 없음' }, () => {
  const bad = [];
  for (const f of real) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const n = countOf(unpackRecording(r), r.exercise);
    if (n !== r.truth) bad.push(`${f}: ${n} (정답 ${r.truth})`);
  }
  assert.deepEqual(bad, []);
});
