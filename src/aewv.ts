import type { AewvMatch, VisaKind, VisaNote } from './types';
import { t } from './i18n';

export const level = (l: AewvMatch['level']): { label: string; short: string; cls: string; note: string } => ({
  high: { label: t('高可信候选', 'High-confidence candidate'), short: t('AEWV 认证·高可信', 'AEWV · high confidence'), cls: 'ok', note: t('已确认机构与法律雇主关系，且 NZBN 出现在所依据的认证名单中。', 'The institution–employer link is confirmed and the NZBN is on the accredited list.') },
  medium: { label: t('中可信候选', 'Medium-confidence candidate'), short: t('AEWV 认证·中可信', 'AEWV · medium confidence'), cls: 'info', note: t('名称一致，但机构与雇主的对应关系尚未确认，人工复核前不视为已核实。', 'Names match, but the institution–employer link is not confirmed; not verified until reviewed.') },
  low: { label: t('低可信候选·待核实', 'Low-confidence candidate · unverified'), short: t('AEWV·低可信待核实', 'AEWV · low confidence'), cls: 'warn', note: t('仅名称相似，不构成认证结论。', 'Only a similar name — not evidence of accreditation.') },
  conflict: { label: t('多个候选·待核实', 'Several candidates · unverified'), short: t('AEWV·多个候选', 'AEWV · several candidates'), cls: 'warn', note: t('存在多个同等级候选雇主，无法确定对应关系。', 'Several equally likely employers; the link cannot be determined.') },
})[l];

// Strongest first: a "no overseas / no sponsorship" sentence outweighs a generic visa mention.
export const VISA_ORDER: VisaKind[] = ['no_overseas', 'sponsor', 'residency', 'other'];

export const visaLabel = (k: VisaKind): { label: string; cls: string } => ({
  no_overseas: { label: t('不接受海外申请／不提供签证担保', 'No overseas applicants / no visa sponsorship'), cls: 'bad' },
  sponsor: { label: t('提及 AEWV／签证担保', 'Mentions AEWV / visa sponsorship'), cls: 'ok' },
  residency: { label: t('要求／优先 NZ 居民或有效工作签证', 'NZ residency or a valid work visa required / preferred'), cls: 'warn' },
  other: { label: t('提及签证／海外申请人', 'Mentions visas / overseas applicants'), cls: 'info' },
})[k];

/** Distinct kinds in strength order. A "sponsor" sentence that is negated is already classified as no_overseas. */
export const visaKinds = (v: VisaNote[] | null | undefined): VisaKind[] =>
  VISA_ORDER.filter((k) => v?.some((x) => x.kind === k));
