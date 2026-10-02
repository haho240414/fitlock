// One small, offline icon family for the app and exercise screen.
const paths = {
  brand: '<path d="M7 10V7a5 5 0 0 1 10 0v3" stroke-width="2"/><rect x="3" y="9" width="18" height="14" rx="4" fill="currentColor" stroke="none"/><path d="M12 19c-4 0-6-2-6-5 4 0 6 2 6 5Zm0 0c0-4 2-6 6-6 0 4-2 6-6 6Z" fill="#ffe457" stroke="none"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1" fill="currentColor" stroke="none"/><path d="m8 13 3 3 5-6"/>',
  chart: '<rect x="4" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="16" y="3" width="4" height="18" rx="1"/>',
  settings: '<path d="m9 3-1 3-3 1-2 3 2 2v3l2 3 3 1 2 2 3-1 2-2 3-1 1-3-1-3-2-2-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7.5-2m-3.5 10v2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  camera: '<path d="M8 6 9.5 3h5L16 6h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  leaf: '<path d="M20 4c0 10-3 16-9 16a7 7 0 0 1-7-7C4 6 11 4 20 4Z"/><path d="m4 20 11-11"/>',
  sprout: '<path d="M12 21v-8"/><path fill="currentColor" d="M12 13C12 6 15 3 21 3c0 6-3 10-9 10Z"/><path fill="currentColor" d="M12 16C6 16 3 13 3 7c6 0 9 3 9 9Z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M10 16V8h3a2 2 0 0 1 0 4h-3"/>',
  reward: '<circle cx="12" cy="12" r="9" fill="#ffed8c" stroke-width="1.4"/><circle cx="12" cy="12" r="6.8" fill="#ffdf43" stroke="none"/><path d="M9.3 7.2h3.3a3.4 3.4 0 0 1 0 6.8h-.7v3H9.3Zm2.6 2.4v2h.6a1 1 0 0 0 0-2Z" fill="currentColor" fill-rule="evenodd" stroke="none"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13m0-13H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
  fire: '<path d="M13 2c2 6-3 7-3 11 2 0 3-2 4-4 2 2 4 4 4 7a6 6 0 0 1-12 0c0-4 2-6 4-8 0 2 0 3 1 4 2-3 3-5 2-10Z"/>',
  workout: '<g transform="rotate(-18 12 12)"><rect x="4" y="6" width="3" height="12" rx="1"/><rect x="17" y="6" width="3" height="12" rx="1"/><path d="M7 10h10v4H7M4 9H2v6h2m16-6h2v6h-2"/></g>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  skip: '<path d="m5 4 11 8L5 20ZM19 4v16"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  bag: '<path d="M5 7h14l2 14H3ZM8 7V6a4 4 0 0 1 8 0v1"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.target}</svg>`;
}

export function mountIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
}
