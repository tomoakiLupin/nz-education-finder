// Minimal UI translation: every string is written inline as t('中文', 'English'), so both languages sit side by side.
// The App re-renders the whole tree when the language changes; the choice is remembered per browser.

export type Lang = 'zh' | 'en';

function initial(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let current: Lang = initial();
document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en-NZ';

export const getLang = () => current;

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en-NZ';
  try { localStorage.setItem('lang', l); } catch { /* storage blocked */ }
}

export const t = (zh: string, en: string) => (current === 'en' ? en : zh);

/** Bilingual text produced by the data build (e.g. AEWV match reasons). Plain strings pass through. */
export const tx = (v: string | { zh: string; en: string }) => (typeof v === 'string' ? v : t(v.zh, v.en));
