// 음성 안내: 횟수는 '하나, 둘, 셋'(고유어)으로, 빠른 반복은 삐 소리로 대신한다.
// 안드로이드 앱에선 WebView 가 웹 음성을 지원하지 않아 폰의 기본 TTS(네이티브)로 말한다.

import { NativeTTS } from './native.js';

const ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
const TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

/** 1~99 → 고유어 (하나, 둘 … 아흔아홉). 그 밖은 숫자 그대로 */
export function nativeKorean(n) {
  if (!Number.isInteger(n) || n <= 0 || n >= 100) return String(n);
  return TENS[Math.floor(n / 10)] + ONES[n % 10];
}

export class Voice {
  constructor() {
    this.enabled = true;
    this.style = 'native';
    this.ctx = null;
    this.ko = null;
    this.lastCountAt = 0;
    this.speakingCount = false;
    if ('speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.ko = vs.find((v) => v.lang === 'ko-KR' && /yuna|유나|google/i.test(v.name))
          || vs.find((v) => v.lang?.startsWith('ko')) || null;
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  /** 반드시 사용자 탭 안에서 호출 (iOS 소리 잠금 해제) */
  unlock() {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume?.();
    } catch { /* 소리 없이 진행 */ }
    if (!NativeTTS && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  /** 안드로이드: 폰 TTS 에 한국어 음성이 있는지 (없으면 설정에서 설치 안내) */
  async koreanAvailable() {
    if (!NativeTTS) return 'speechSynthesis' in window;
    try {
      // 음성 엔진이 없거나 준비 안 된 폰에선 응답이 안 올 수 있어 3초 제한
      const res = await Promise.race([
        NativeTTS.isLanguageSupported({ lang: 'ko-KR' }),
        new Promise((resolve) => setTimeout(() => resolve({ supported: false, timeout: true }), 3000)),
      ]);
      return !!res.supported;
    } catch {
      return false;
    }
  }

  say(text, { interrupt = false } = {}) {
    if (!this.enabled || !text) return;
    if (NativeTTS) {
      // Flush(0) = 말하던 것을 끊고 바로, Add(1) = 앞 말이 끝난 뒤
      NativeTTS.speak({ text, lang: 'ko-KR', rate: 1.05, pitch: 1.0, volume: 1.0, queueStrategy: interrupt ? 0 : 1 })
        .catch(() => {});
      return;
    }
    if (!('speechSynthesis' in window)) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (this.ko) u.voice = this.ko;
    u.rate = 1.08;
    u.pitch = 1.0;
    speechSynthesis.speak(u);
  }

  /**
   * 횟수 읽기. 점핑잭·하이니처럼 빠른 운동(최근 반복 간격 중앙값 1초 미만)은 숫자를 다 말하면 소리가 밀리고 끊긴다
   * → 매회 짧은 삐 소리, 5의 배수와 꼭 해야 할 말(자세 지적·남은 횟수)만 말로.
   */
  count(n, extra = '') {
    const now = performance.now();
    if (n <= 1 || now - this.lastCountAt > 4000) this.gaps = [];
    else this.gaps = [...(this.gaps || []), now - this.lastCountAt].slice(-3);
    this.lastCountAt = now;
    const g = [...(this.gaps || [])].sort((a, b) => a - b);
    const fast = g.length >= 2 && g[g.length >> 1] < 1000;
    const word = this.style === 'native' ? nativeKorean(n) : String(n);
    if (fast && !extra && n % 5 !== 0) {
      this.beep(n % 5 === 4 ? 990 : 880, 0.06);
      return;
    }
    this.say(extra ? `${word}. ${extra}` : word, { interrupt: true });
  }

  beep(freq = 880, dur = 0.08, gain = 0.25) {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch { /* 무시 */ }
  }

  stop() {
    if (NativeTTS) NativeTTS.stop().catch(() => {});
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
