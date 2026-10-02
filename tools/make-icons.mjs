#!/usr/bin/env node
// 앱 아이콘·스플래시 PNG 생성 (헤드리스 크롬으로 SVG 를 그려 저장 — 핸즈프리 PT tools/make-icons.mjs 방식)
//   웹: app/icons/*   안드로이드: android/app/src/main/res/{mipmap-*,drawable-*}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BG = '#f5f7f4';

// 웰니스 브랜드: 짙은 그린 자물쇠 안에 두 잎. 웹의 icons.js brand와 같은 모티프.
const mark = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M176 232 V170 a80 80 0 0 1 160 0 V232" fill="none" stroke="#245c48" stroke-width="32" stroke-linecap="round"/>
    <rect x="120" y="222" width="272" height="212" rx="56" fill="#245c48"/>
    <path d="M256 371c-66 0-101-33-101-84 67 0 101 34 101 84Zm0 0c0-73 35-111 111-111 0 72-37 111-111 111Z" fill="#ffffff"/>
  </g>`;
const bgFill = '';
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet">${body}</svg>`;

const square = svg(512, 512, `${bgFill}<rect width="512" height="512" fill="${BG}"/>${mark(0.9)}`);
const rounded = svg(512, 512, `${bgFill}<rect width="512" height="512" rx="112" fill="${BG}"/>${mark(0.84)}`);
const round = svg(512, 512, `${bgFill}<circle cx="256" cy="256" r="256" fill="${BG}"/>${mark(0.8)}`);
// 적응형 아이콘 전경: 108dp 중 가운데 66dp 원 안에 들어가야 잘리지 않는다
const foreground = svg(512, 512, mark(0.56));

const jobs = [
  ['app/icons/icon-512.png', 512, 512, square],
  ['app/icons/icon-192.png', 192, 192, square],
];
const RES = 'android/app/src/main/res';
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  jobs.push([`${RES}/mipmap-${d}/ic_launcher.png`, 48 * k, 48 * k, rounded]);
  jobs.push([`${RES}/mipmap-${d}/ic_launcher_round.png`, 48 * k, 48 * k, round]);
  jobs.push([`${RES}/mipmap-${d}/ic_launcher_foreground.png`, 108 * k, 108 * k, foreground]);
}
// 스플래시(안드로이드 11 이하): 앱과 같은 밝은 배경 가운데 로고
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${BG}"/>
    <svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 512 512">${mark()}</svg></svg>`;
};
for (const f of fs.readdirSync(path.join(ROOT, RES))) {
  const p = path.join(ROOT, RES, f, 'splash.png');
  if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  jobs.push([`${RES}/${f}/splash.png`, w, h, splash(w, h)]);
}

fs.mkdirSync(path.join(ROOT, 'app/icons'), { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
for (const [rel, w, h, body] of jobs) {
  await page.setViewport({ width: Math.round(w), height: Math.round(h), deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg style="display:block;width:${w}px;height:${h}px" `)}</body></html>`);
  await page.screenshot({ path: path.join(ROOT, rel), omitBackground: true, clip: { x: 0, y: 0, width: Math.round(w), height: Math.round(h) } });
}
await browser.close();
// 적응형 아이콘 배경색
fs.writeFileSync(path.join(ROOT, RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
console.log(`아이콘·스플래시 ${jobs.length}개 생성`);
