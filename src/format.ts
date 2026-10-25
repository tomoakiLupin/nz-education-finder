import type { Category, Institution } from './types';

export const NONE = '__none__';
export const NONE_LABEL = '未提供';

export const CAT_LABEL: Record<Category, string> = { school: 'School', ece: 'ECE' };

/** Strip diacritics/case/punctuation for tolerant search. Never used for display. */
export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * School and ECE directories spell Auckland local boards differently
 * ("Kaipātiki Local Board Area" vs "Auckland - Kaipātiki"). Filters use one label; the official value is still shown on detail pages.
 */
export function districtLabel(r: Pick<Institution, 'district'>): string | null {
  const m = r.district?.match(/^(.*) Local Board Area$/);
  return m ? `Auckland - ${m[1]}` : r.district;
}

const nzDateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const nzDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' });

/** UTC timestamp → Auckland local time with explicit zone label. Date-only values keep date precision. */
export function fmtDate(v: string | null | undefined, withTime = false): string {
  if (!v) return '日期未知';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${(withTime ? nzDateTime : nzDate).format(d)}${withTime ? '（NZ 时间）' : ''}`;
}

export function daysSince(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
}

/** Only http(s) URLs may be rendered as links. */
export function safeHref(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export const displayHost = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};
