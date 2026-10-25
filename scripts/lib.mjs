// Shared helpers for the data pipeline. Pure functions only, so they can be unit tested.
import { createHash } from 'node:crypto';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Lowercase, strip diacritics (macrons), collapse whitespace/punctuation. For matching only, never for display. */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words that carry no identity for employer matching.
const STOP = new Set([
  'the', 'of', 'and', 'ltd', 'limited', 'inc', 'incorporated', 'trust', 'trustees', 'board', 'nz',
  'new', 'zealand', 'school', 'kindergarten', 'kindy', 'centre', 'center', 'early', 'childhood',
  'education', 'learning', 'preschool', 'childcare', 'care', 'ece', 'college', 'primary', 'intermediate',
  'association', 'society', 'group', 'company', 'co',
]);

export function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t));
}

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Only http/https URLs are allowed through; anything else (javascript:, data:, garbage) becomes null. */
export function safeUrl(v) {
  let s = clean(v);
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Mainland NZ + Chatham Islands rough bounds. Out-of-range coordinates are dropped (record kept). */
export function validCoord(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) return null;
  const main = la <= -34 && la >= -47.5 && lo >= 166 && lo <= 179;
  const chatham = la <= -43.5 && la >= -44.5 && lo <= -176 && lo >= -177;
  return main || chatham ? [Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6] : null;
}

const dateOnly = (v) => (clean(v) ? String(v).slice(0, 10) : null);

/**
 * Map a raw directory row to the public record. This is the field whitelist:
 * contact person names, emails and phone numbers are deliberately NOT copied.
 */
export function toPublicRecord(kind, row) {
  const idField = kind === 'school' ? 'School_Id' : 'ECE_Id';
  const officialId = Number(row[idField]);
  const issues = [];
  if (!Number.isInteger(officialId) || officialId <= 0) return { record: null, issues: [`invalid ${idField}: ${row[idField]}`] };
  const name = clean(row.Org_Name);
  if (!name) return { record: null, issues: [`${kind}:${officialId} missing Org_Name`] };
  const coord = validCoord(row.Latitude, row.Longitude);
  if (!coord && (clean(row.Latitude) || clean(row.Longitude))) issues.push(`${kind}:${officialId} coordinate out of NZ bounds`);
  const rawUrl = clean(row.URL);
  const url = safeUrl(rawUrl);
  if (rawUrl && !url) issues.push(`${kind}:${officialId} unusable URL`);
  const record = {
    key: `${kind}:${officialId}`,
    cat: kind,
    id: officialId,
    name,
    type: clean(row.Org_Type),
    authority: clean(row.Authority),
    region: clean(row.Regional_Council),
    district: clean(row.Territorial_Authority),
    suburb: clean(row.Add1_Suburb),
    city: clean(row.Add1_City),
    address: clean(row.Add1_Line1),
    lat: coord ? coord[0] : null,
    lon: coord ? coord[1] : null,
    url,
    roll: Number.isFinite(Number(row.Total)) && clean(row.Total) !== null ? Number(row.Total) : null,
    rollDate: dateOnly(row.Roll_Date),
    status: clean(row.Status) ?? null,
  };
  return { record, issues };
}

const COMPARE = ['name', 'type', 'authority', 'region', 'district', 'suburb', 'city', 'address', 'lat', 'lon', 'url', 'status'];

/**
 * Merge a fresh batch over the previous snapshot.
 * Records that vanished from the source are kept and flagged `source_missing` (never treated as closed or deleted).
 */
export function mergeBatch(previous, fresh, batchId, today) {
  const prevByKey = new Map(previous.map((r) => [r.key, r]));
  const freshKeys = new Set();
  const report = { added: [], changed: [], missing: [], returned: [] };
  const out = [];
  for (const r of fresh) {
    if (freshKeys.has(r.key)) continue; // duplicate row in source; first one wins, reported by caller
    freshKeys.add(r.key);
    const p = prevByKey.get(r.key);
    const firstSeen = p?.firstSeen ?? today;
    if (!p) report.added.push(r.key);
    else {
      const diff = COMPARE.filter((f) => (p[f] ?? null) !== (r[f] ?? null));
      if (diff.length) report.changed.push({ key: r.key, fields: diff });
      if (p.sourceStatus === 'source_missing') report.returned.push(r.key);
    }
    out.push({ ...r, sourceStatus: 'present', batch: batchId, firstSeen });
  }
  for (const p of previous) {
    if (freshKeys.has(p.key)) continue;
    // Only consider categories that were part of this import.
    if (!fresh.some((f) => f.cat === p.cat)) { out.push(p); continue; }
    if (p.sourceStatus !== 'source_missing') report.missing.push(p.key);
    out.push({ ...p, sourceStatus: 'source_missing', missingSince: p.missingSince ?? today });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  return { records: out, report };
}

/** Minimal RFC4180 CSV parser (quoted fields, embedded commas/newlines, BOM). */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export const normNzbn = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 13 ? d : null;
};

/**
 * AEWV evidence matching. Levels are evidence grades for this project, not probabilities and not INZ ratings.
 *  high      – confirmed institution↔employer link whose NZBN appears in the accredited list
 *  medium    – normalised legal/trading name equals institution name; needs human review before "verified"
 *  low       – token similarity only; shown as an unverified candidate
 *  conflict  – several candidates at the best level
 *  (absent)  – no candidate found: shown as unknown, never as "not accredited"
 */
export function matchAewv({ institutions, employers, links, reviews }) {
  const byNzbn = new Map();
  const byName = new Map();
  const tokenIndex = new Map();
  employers.forEach((e, idx) => {
    if (e.nzbn) byNzbn.set(e.nzbn, idx);
    for (const n of [e.legal_name, e.trading_name]) {
      const k = normalize(n);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(idx);
      for (const t of tokens(n)) {
        if (!tokenIndex.has(t)) tokenIndex.set(t, new Set());
        tokenIndex.get(t).add(idx);
      }
    }
  });
  const rejected = new Set(reviews.filter((r) => r.decision === 'rejected').map((r) => `${r.institution}|${empKey(r)}`));
  const confirmedReview = new Map(reviews.filter((r) => r.decision === 'confirmed').map((r) => [`${r.institution}|${empKey(r)}`, r]));
  const linksByInst = new Map();
  for (const l of links) {
    if (!linksByInst.has(l.institution)) linksByInst.set(l.institution, []);
    linksByInst.get(l.institution).push(l);
  }

  const result = {};
  for (const inst of institutions) {
    const cands = [];
    for (const l of linksByInst.get(inst.key) ?? []) {
      const n = normNzbn(l.nzbn);
      const idx = n != null ? byNzbn.get(n) : undefined;
      if (idx !== undefined) cands.push({ idx, level: 'high', reasons: [`已确认雇主关系（${l.relation || '未注明'}）`, `NZBN ${n} 出现在认证名单中`], link: l });
    }
    if (!cands.length) {
      const exact = byName.get(normalize(inst.name));
      if (exact) for (const idx of exact) cands.push({ idx, level: 'medium', reasons: ['规范化后的法律名称/商号与机构名称一致', '缺少稳定标识（NZBN）关联，需人工复核'] });
    }
    if (!cands.length) {
      const it = tokens(inst.name);
      const pool = new Set();
      for (const t of it) {
        const s = tokenIndex.get(t);
        if (s && s.size <= 200) for (const i of s) pool.add(i); // ignore very common tokens
      }
      for (const idx of pool) {
        const e = employers[idx];
        const score = Math.max(jaccard(it, tokens(e.legal_name)), jaccard(it, tokens(e.trading_name)));
        if (score >= 0.75) cands.push({ idx, level: 'low', reasons: [`名称相似（相似度 ${score.toFixed(2)}），仅为候选`] });
      }
    }
    const kept = cands.filter((c) => !rejected.has(`${inst.key}|${empKey(employers[c.idx])}`));
    if (!kept.length) continue;
    const best = ['high', 'medium', 'low'].find((lv) => kept.some((c) => c.level === lv));
    const top = kept.filter((c) => c.level === best);
    const uniq = [...new Map(top.map((c) => [c.idx, c])).values()];
    const describe = (c) => {
      const e = employers[c.idx];
      const review = confirmedReview.get(`${inst.key}|${empKey(e)}`);
      return {
        employer: e.legal_name || e.trading_name,
        nzbn: e.nzbn,
        status: e.status || null,
        sourceAsOf: e.source_as_of || null,
        batch: e.batch,
        reasons: c.reasons,
        reviewStatus: review ? 'verified' : c.level === 'high' ? 'link_confirmed' : 'pending',
        verifiedAt: review?.verified_at ?? c.link?.verified_at ?? null,
        reviewer: review?.reviewer ?? null,
      };
    };
    result[inst.key] = uniq.length > 1
      ? { level: 'conflict', candidates: uniq.slice(0, 5).map(describe) }
      : { level: best, candidates: [describe(uniq[0])] };
  }
  return result;
}

function empKey(e) {
  return normNzbn(e.nzbn) ?? `name:${normalize(e.legal_name || e.employer || e.trading_name)}`;
}
