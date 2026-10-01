#!/usr/bin/env node
// 실제 폰 센서 기록(앱 설정 → '센서 기록 보내기' 파일)을 지금 세기 코드로 다시 돌려 본다.
//   node tools/motion-replay.mjs ~/Downloads/fitlock-sensor-*.json [--trace] [--save 이름]
// - 앱이 센 개수 / 사용자가 적은 실제 개수 / 지금 코드로 다시 센 개수를 나란히 보여준다
// - --trace : 회마다 깊이·시간, 덜 앉은 것(shallow)
// - --save 이름 : test/fixtures/motion/이름.json 으로 저장 (실제 개수가 적혀 있는 기록만) → 단위 테스트에 들어간다

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackRecording } from '../app/js/sensorlog.js';
import { PhoneRepCounter } from '../app/js/motion/rep-sensor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--save');
const trace = argv.includes('--trace');
const saveName = argv.includes('--save') ? argv[argv.indexOf('--save') + 1] : null;

if (!files.length) {
  console.log('쓰는 법: node tools/motion-replay.mjs <센서 기록 파일.json> [--trace] [--save 이름]');
  process.exit(1);
}

// Node 에는 atob 이 있다 (sensorlog.js 가 브라우저 함수를 쓴다)
for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (doc.app !== 'fitlock-sensorlog') { console.log(`${f}: 핏락 센서 기록이 아니에요`); continue; }
  console.log(`\n${path.basename(f)} · ${doc.device?.manufacturer ?? ''} ${doc.device?.model ?? ''} (API ${doc.device?.sdk ?? '?'}) · 기록 ${doc.recordings.length}개`);
  for (const r of doc.recordings) {
    const samples = unpackRecording(r);
    const c = new PhoneRepCounter({ exercise: r.exercise });
    const ev = [];
    for (const s of samples) for (const e of c.push(s)) ev.push(e);
    const dur = samples.length ? samples[samples.length - 1].t - samples[0].t : 0;
    const hz = dur > 0 ? Math.round(samples.length / dur) : 0;
    const truth = r.truth ?? null;
    const mark = truth == null ? '' : c.count === truth ? ' ✅' : ` ❌(${c.count - truth > 0 ? '+' : ''}${c.count - truth})`;
    console.log(`- ${new Date(r.at).toLocaleString('ko-KR')} ${r.exercise} 목표 ${r.target} · ${dur.toFixed(1)}초 ${hz}Hz`
      + ` · 중력 뺀 값 ${r.hasAcc ? '있음' : '없음'} · 회전 ${r.hasRot ? '있음' : '없음'}`);
    console.log(`  앱이 센 개수 ${r.counted} · 실제 ${truth ?? '(안 적음)'} · 지금 코드 ${c.count}${mark} · 덜 앉음 ${c.shallow}`);
    if (trace) {
      for (const e of ev) {
        if (e.type === 'rep') console.log(`    ${e.t.toFixed(2)}s  ${e.count}회  깊이 ${e.depth}m  내려감 ${e.downSec}s 올라옴 ${e.upSec}s${e.first ? ' (가만히 있다 시작)' : ''}`);
        else if (e.type === 'shallow') console.log(`    ${e.t.toFixed(2)}s  덜 앉음 ${e.depth.toFixed(3)}m`);
      }
    }
    if (saveName && truth != null) {
      const dir = path.join(ROOT, 'test/fixtures/motion');
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${saveName}-${r.id}.json`);
      fs.writeFileSync(out, JSON.stringify({ device: doc.device, ...r }));
      console.log(`  저장: ${path.relative(ROOT, out)}`);
    }
  }
}
