import type { AewvMatch } from './types';

export const LEVEL: Record<AewvMatch['level'], { label: string; short: string; cls: string; note: string }> = {
  high: { label: '高可信候选', short: 'AEWV 认证·高可信', cls: 'ok', note: '已确认机构与法律雇主关系，且 NZBN 出现在所依据的认证名单中。' },
  medium: { label: '中可信候选', short: 'AEWV 认证·中可信', cls: 'info', note: '名称一致，但机构与雇主的对应关系尚未确认，人工复核前不视为已核实。' },
  low: { label: '低可信候选·待核实', short: 'AEWV·低可信待核实', cls: 'warn', note: '仅名称相似，不构成认证结论。' },
  conflict: { label: '多个候选·待核实', short: 'AEWV·多个候选', cls: 'warn', note: '存在多个同等级候选雇主，无法确定对应关系。' },
};
