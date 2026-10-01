// 동작 시범: 시범 영상에서 뽑은 관절 좌표(app/data/demos.json, tools/make-demos.mjs)를 막대 인형으로 반복 재생한다.
// 영상·사진 없이 좌표만 쓴다. 가려졌던 반대편 팔다리는 흐리게.

let data = null;
let loading = null;
export function loadDemos() {
  loading ||= fetch(new URL('../data/demos.json', import.meta.url))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { data = d; return d; })
    .catch(() => null);
  return loading;
}
export const hasDemo = (id) => !!data?.demos?.[id];

/**
 * canvas 에 운동 id 의 시범을 반복 재생. 돌려주는 함수를 부르면 멈춘다.
 * @param {HTMLCanvasElement} canvas
 * @param {string} id
 * @param {{color?:string, dim?:string, bg?:string}} [o]
 */
export function playDemo(canvas, id, { color = '#c8f53c', dim = 'rgba(200,245,60,.35)', bg = null } = {}) {
  let raf = 0;
  let stopped = false;
  const start = performance.now();
  const draw = () => {
    if (stopped) return;
    const d = data?.demos?.[id];
    const g = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    if (!d) { raf = requestAnimationFrame(draw); return; }
    const n = d.f.length;
    // 1회 동작 + 끝에서 0.4초 쉬고 다시
    const period = n / d.fps + 0.4;
    const t = ((performance.now() - start) / 1000) % period;
    const fi = Math.min(n - 1, Math.floor(t * d.fps));
    const fr = d.f[fi];
    const pad = 0.1;
    const s = Math.min(W, H) * (1 - 2 * pad);
    const ox = (W - s) / 2, oy = (H - s) / 2;
    const P = (k) => [ox + (fr[2 * k] / 1000) * s, oy + (fr[2 * k + 1] / 1000) * s];
    const idx = Object.fromEntries(data.joints.map((j, k) => [j, k]));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 흐린(가려졌던) 쪽을 먼저, 잘 보이던 쪽을 위에
    const bones = data.bones.map(([a, b]) => ({ a: idx[a], b: idx[b], v: Math.min(d.vis[idx[a]], d.vis[idx[b]]) }))
      .sort((x, y) => x.v - y.v);
    for (const { a, b, v } of bones) {
      const [x1, y1] = P(a), [x2, y2] = P(b);
      g.strokeStyle = v >= 0.55 ? color : dim;
      g.lineWidth = Math.max(3, s * 0.035);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    // 머리: 코 위치에 원
    const [hx, hy] = P(idx[0]);
    g.fillStyle = color;
    g.beginPath(); g.arc(hx, hy, Math.max(5, s * 0.045), 0, Math.PI * 2); g.fill();
    raf = requestAnimationFrame(draw);
  };
  loadDemos().then(() => { if (!stopped) draw(); });
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
