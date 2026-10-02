// 화면 공용 도우미: 요소 찾기, 알림 띄우기, 아래에서 올라오는 창, 동전 날아가기, 숫자·시간 표시

export const $ = (id) => document.getElementById(id);

export const fmt = (n) => Math.round(n || 0).toLocaleString('ko-KR');

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const dateLabel = (ms = Date.now()) => { const d = new Date(ms); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`; };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastEl = null;
let toastTimer = 0;
export function toast(msg, ms = 2400) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/**
 * 아래에서 올라오는 창. actions: [{label, cls, onClick(close) → false 면 안 닫음}]
 * @returns {() => void} 닫기
 */
let sheetId = 0;
let sheetCount = 0;
let previousOverflow = '';
export function sheet({ title = '', html = '', actions = [], dismissable = true, steps = null, onClose = null }) {
  const previousFocus = document.activeElement;
  const titleId = `sheet-title-${++sheetId}`;
  const back = document.createElement('div');
  back.className = 'sheet-back';
  const box = document.createElement('div');
  box.className = 'sheet';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.tabIndex = -1;
  if (title) box.setAttribute('aria-labelledby', titleId);
  box.innerHTML = `${steps ? `<div class="steps">${Array.from({ length: steps.n }, (_, i) => `<i class="${i <= steps.i ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    ${title ? `<h2 id="${titleId}">${esc(title)}</h2>` : ''}<div class="sheet-body">${html}</div><div class="actions"></div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey);
    if (--sheetCount === 0) document.body.style.overflow = previousOverflow;
    const nextSheet = [...document.querySelectorAll('.sheet')].at(-1);
    if (nextSheet) nextSheet.focus();
    else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onClose?.();
  };
  const onKey = (e) => {
    if ([...document.querySelectorAll('.sheet-back')].at(-1) !== back) return;
    if (e.key === 'Escape' && dismissable) { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const controls = [...box.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')].filter((el) => el.getClientRects().length);
    if (!controls.length) { e.preventDefault(); box.focus(); return; }
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  back._close = close; // 뒤로 가기 버튼 등 바깥에서 닫을 때도 onClose 가 불리게
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn block ${a.cls || ''}`;
    b.textContent = a.label;
    if (a.id) b.id = a.id;
    b.addEventListener('click', async () => {
      const r = await a.onClick?.(close);
      if (r !== false) close();
    });
    box.querySelector('.actions').append(b);
  }
  if (dismissable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.append(box);
  if (sheetCount++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  box.focus();
  return close;
}

/** 동전이 from 요소에서 to 요소로 날아간다 */
export function coinBurst(from, to, n = 8) {
  if (!from || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'coin-fly';
    c.textContent = 'P';
    const x = a.left + a.width / 2 + (Math.random() - 0.5) * a.width * 0.6;
    const y = a.top + a.height / 2 + (Math.random() - 0.5) * a.height * 0.4;
    c.style.left = `${x - 13}px`;
    c.style.top = `${y - 13}px`;
    c.style.setProperty('--dx', `${b.left + b.width / 2 - x}px`);
    c.style.setProperty('--dy', `${b.top + b.height / 2 - y}px`);
    c.style.animationDelay = `${i * 60}ms`;
    document.body.append(c);
    setTimeout(() => c.remove(), 1200 + i * 60);
  }
  setTimeout(() => { to.classList.remove('pop'); void to.offsetWidth; to.classList.add('pop'); }, 700);
}

/** 운동 이름 */
export const EXERCISE_NAMES = { squat: '스쿼트', lunge: '런지' };
