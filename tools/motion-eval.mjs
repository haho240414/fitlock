#!/usr/bin/env node
// 폰 들고 세기(motion/rep-sensor.js)를 가짜 센서 시나리오로 채점한다.
//   node tools/motion-eval.mjs [--seeds 8] [--only squat10,walk60] [--verbose]
// 시나리오마다 폰 드는 방향·잡음·치우침·'중력 뺀 값' 유무를 바꿔 가며 돌린다.

import { synthMotion, SCENARIOS } from '../app/js/motion/synth.js';
import { PhoneRepCounter } from '../app/js/motion/rep-sensor.js';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const seeds = Number(opt('--seeds', 8));
const only = opt('--only', null)?.split(',');
const verbose = argv.includes('--verbose');

export const VARIANTS = [
  { name: '세로', hold: 'portrait' },
  { name: '읽는각도', hold: 'reading' },
  { name: '가로', hold: 'landscape' },
  { name: '눕혀서', hold: 'flat' },
  { name: '잡음큼', hold: 'portrait', noise: 0.12, bias: [0.15, -0.1, 0.12], handShake: 2.5 },
  { name: '융합느림', hold: 'portrait', fusionLag: 0.3 },
  { name: '중력값없음', hold: 'portrait', linear: false },
  { name: '30Hz', hold: 'portrait', rate: 30 },
];

export function runCounter(samples, opts = {}) {
  const c = new PhoneRepCounter(opts);
  const events = [];
  for (const s of samples) for (const e of c.push(s)) events.push(e);
  return { count: c.count, shallow: c.shallow, reps: c.reps, events };
}

// 시나리오별 기대: 정답 횟수(=) 또는 최대 허용(≤)
export const EXPECT = {
  squat10: { eq: 10 }, squat10fast: { eq: 10 }, squat10slow: { eq: 10 }, squat10shallow: { eq: 10 }, squat10deep: { eq: 10 },
  lunge10: { eq: 10, exercise: 'lunge' }, pickupThenSquat: { eq: 10 },
  still60: { max: 0 }, walk60: { max: 0 }, jog30: { max: 0 }, bus60: { max: 0 }, handle20: { max: 0 },
  sitStay: { max: 0 }, sitStand: { max: 1 }, elevator: { max: 1 }, stairs: { max: 2 }, quarter10: { max: 0 },
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  let fails = 0;
  let total = 0;
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (only && !only.includes(name)) continue;
    const exp = EXPECT[name] || {};
    const row = [];
    for (const v of VARIANTS) {
      const counts = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const { samples } = synthMotion({ seed: seed * 7919 + name.length, ...v, ...sc });
        const r = runCounter(samples, { exercise: exp.exercise });
        counts.push(r.count);
        const ok = exp.eq != null ? r.count === exp.eq : exp.max != null ? r.count <= exp.max : true;
        total++;
        if (!ok) fails++;
        if (verbose && !ok) console.log(`  ✗ ${name} ${v.name} seed${seed}: ${r.count} (${r.reps.map((x) => x.depth).join(',')})`);
      }
      const ok = counts.every((n) => (exp.eq != null ? n === exp.eq : exp.max != null ? n <= exp.max : true));
      row.push(`${ok ? '' : '✗'}${v.name}:${[...new Set(counts)].sort((a, b) => a - b).join('/')}`);
    }
    console.log(`${name.padEnd(16)} ${exp.eq != null ? '=' + exp.eq : '≤' + exp.max}  ${row.join('  ')}`);
  }
  console.log(`\n틀린 경우 ${fails}/${total}`);
}
