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

// For similarity scoring only legal-form words are dropped: "Ruawai Kindergarten" must not look like "Ruawai College Board".
const LEGAL = new Set(['the', 'of', 'and', 'ltd', 'limited', 'inc', 'incorporated', 'trust', 'trustees', 'board', 'company', 'co', 'nz']);
const scoreTokens = (s) => normalize(s).split(' ').filter((t) => t && !LEGAL.has(t));

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
/** Reasons are shown in the UI language, so each carries both. */
const bi = (zh, en) => ({ zh, en });

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
  const brands = chainBrands(institutions, employers);
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
      if (idx !== undefined) cands.push({ idx, level: 'high', reasons: [bi(`已确认雇主关系（${l.relation || '未注明'}）`, `Confirmed employer relationship (${l.relation || 'unspecified'})`), bi(`NZBN ${n} 出现在认证名单中`, `NZBN ${n} is on the accredited list`)], link: l });
    }
    if (!cands.length) {
      const exact = byName.get(normalize(inst.name));
      if (exact) for (const idx of exact) cands.push({ idx, level: 'medium', reasons: [bi('规范化后的法律名称/商号与机构名称一致', 'Legal or trading name matches the institution name'), bi('尚未确认机构与该雇主（NZBN）的对应关系，需人工复核', 'The link between this institution and the employer (NZBN) is not yet confirmed; needs manual review')] });
    }
    if (!cands.length && inst.cat === 'ece') {
      const it = normalize(inst.name).split(' ');
      for (let n = Math.min(3, it.length - 1); n >= 1; n--) {
        const b = brands.get(it.slice(0, n).join(' '));
        if (!b) continue;
        for (const idx of b.employers) {
          cands.push({ idx, level: 'medium', reasons: [
            bi(`机构名称以认证雇主的品牌名“${b.label}”开头（全国共 ${b.count} 家同品牌机构）`, `Name starts with the accredited employer's brand "${b.label}" (${b.count} centres with this brand nationwide)`),
            bi('连锁机构的分店通常由品牌公司雇佣，但也可能由加盟方等其他法人运营，需人工复核', 'Chain branches are usually employed by the brand company, but some are run by franchisees or other entities; needs manual review'),
          ] });
        }
        break;
      }
    }
    if (!cands.length) {
      const pool = new Set();
      for (const t of tokens(inst.name)) {
        const s = tokenIndex.get(t);
        if (s && s.size <= 200) for (const i of s) pool.add(i); // ignore very common tokens
      }
      const it = scoreTokens(inst.name);
      for (const idx of pool) {
        const e = employers[idx];
        const score = Math.max(jaccard(it, scoreTokens(e.legal_name)), jaccard(it, scoreTokens(e.trading_name)));
        if (score >= 0.75) cands.push({ idx, level: 'low', reasons: [bi(`名称相似（相似度 ${score.toFixed(2)}），仅为候选`, `Similar name (similarity ${score.toFixed(2)}), candidate only`)] });
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
      // Supporting context only: it never raises the level on its own.
      const extra = [];
      if (e.city && inst.city) {
        extra.push(normalize(e.city) === normalize(inst.city)
          ? bi(`雇主登记城市（${e.city}）与机构所在城市一致`, `Employer's registered city (${e.city}) matches the institution's city`)
          : bi(`注意：雇主登记城市为 ${e.city}，机构位于 ${inst.city}`, `Note: employer registered in ${e.city}, institution is in ${inst.city}`));
      }
      if (e.sector) extra.push(bi(`雇主行业：${e.sector}`, `Employer industry: ${e.sector}`));
      return {
        employer: e.legal_name || e.trading_name,
        tradingName: e.trading_name || null,
        nzbn: e.nzbn,
        expiry: e.expiry || null,
        sourceAsOf: e.source_as_of || null,
        batch: e.batch,
        reasons: [...c.reasons, ...extra],
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

// Trailing words that describe the business type, not the brand: "Kindercare Learning Centres Limited" → "kindercare".
const BRAND_SUFFIX = new Set([...LEGAL, 'learning', 'centre', 'centres', 'center', 'centers', 'educare', 'early', 'childhood', 'education',
  'kindergarten', 'kindergartens', 'preschool', 'preschools', 'childcare', 'care', 'group', 'new', 'zealand', 'aotearoa', 'services']);
const ECE_WORDS = new Set(['learning', 'centre', 'centres', 'center', 'centers', 'educare', 'early', 'childhood', 'kindergarten', 'kindergartens', 'preschool', 'preschools', 'childcare', 'montessori', 'kindy', 'nursery']);
// Generic words that cannot be a brand on their own.
const BRAND_GENERIC = new Set([...STOP, 'little', 'kids', 'kidz', 'tiny', 'happy', 'small', 'st', 'saint', 'mt', 'home', 'based', 'montessori', 'play', 'playcentre', 'kohanga', 'reo', 'puna']);

/**
 * ECE chains list each centre as "<brand> <suburb>" while INZ lists the company ("Kindercare Learning Centres Limited").
 * A brand qualifies only if it prefixes at least two ECE names, is not made of place names or generic words, and is
 * long enough to be distinctive — so "Ruawai …" (a place) never matches "Ruawai College Board".
 */
function chainBrands(institutions, employers) {
  const places = new Set();
  for (const r of institutions) for (const v of [r.suburb, r.city, r.district, r.region]) for (const t of normalize(v).split(' ')) if (t) places.add(t);
  const prefixCount = new Map(); // "<first n words>" of ECE names (strict prefixes only) → number of centres
  for (const r of institutions) {
    if (r.cat !== 'ece') continue;
    const t = normalize(r.name).split(' ');
    for (let n = 1; n <= Math.min(3, t.length - 1); n++) {
      const p = t.slice(0, n).join(' ');
      prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
    }
  }
  const out = new Map();
  employers.forEach((e, idx) => {
    // Childcare sits under ANZSIC "Social Assistance" (e.g. BestStart), schools under "Education and Training".
    if (e.industry && !/education|child|social assistance|preschool/i.test(e.industry)) return;
    for (const name of [e.legal_name, e.trading_name]) {
      const all = normalize(name).split(' ').filter(Boolean);
      const t = [...all];
      while (t.length && BRAND_SUFFIX.has(t[t.length - 1])) t.pop();
      if (!t.length || t.length > 3 || t.join('').length < 6) continue;
      if (t.every((w) => places.has(w) || BRAND_GENERIC.has(w))) continue;
      const brand = t.join(' ');
      const count = prefixCount.get(brand) ?? 0;
      if (count < 2) continue;
      // One-word brands ("Bright", "Capital") are often ordinary words: require an ECE word in the employer name or a big chain.
      if (t.length === 1 && count < 10 && !all.some((w) => ECE_WORDS.has(w))) continue;
      const b = out.get(brand) ?? { label: brand, employers: new Set(), count };
      b.employers.add(idx);
      out.set(brand, b);
    }
  });
  return out;
}

function empKey(e) {
  return normNzbn(e.nzbn) ?? `name:${normalize(e.legal_name || e.employer || e.trading_name)}`;
}

// Gazette regions are coarser ("Tasman/Nelson", "Manawatu/Whanganui") than MoE Regional_Council ("Nelson Region").
const regionWords = (s) => new Set(normalize(String(s ?? '').replace(/ Region$/, '')).split(' ').filter(Boolean));
const sameRegion = (gazette, moe) => [...regionWords(moe)].some((w) => regionWords(gazette).has(w));

/**
 * Link Education Gazette vacancies to directory institutions by exact normalized name, using region to break
 * ties. Ambiguous or unknown advertisers stay unlinked (key null) rather than guessed.
 */
export function matchJobs(jobs, institutions) {
  const byName = new Map();
  for (const r of institutions) {
    if (r.sourceStatus === 'source_missing') continue;
    const k = normalize(r.name);
    (byName.get(k) ?? byName.set(k, []).get(k)).push(r);
  }
  return jobs.map((j) => {
    let c = byName.get(normalize(j.institute)) ?? [];
    if (c.length > 1) c = c.filter((r) => sameRegion(j.region, r.region));
    return c.length === 1 ? c[0].key : null;
  });
}

// ---- Visa / work-eligibility statements in vacancy text ----
// Only these short sentences are kept from an advertisement; the rest of the ad is not stored.

const VISA_RULES = [
  ['no_overseas', /(overseas|offshore|international)\s+(applicants|applications|candidates)\b[^.]{0,80}\b(not|won'?t|cannot|can'?t|unable|ineligible)\b|\b(not|unable to|cannot|can'?t|won'?t)\b[^.]{0,40}\b(accept|consider)\w*\b[^.]{0,40}\b(overseas|offshore)|\bmust\s+(already\s+)?(be\s+)?(currently\s+)?(living|based|residing|resident|located)\s+in\s+(new zealand|nz|aotearoa)|\bno\s+(visa\s+)?sponsorship|\b(unable|not able|cannot|can'?t|do not|don'?t|will not|won'?t|not in a position)\b[^.]{0,40}\b(sponsor|support)\w*\b[^.]{0,30}\bvisa|\bnot\s+(currently\s+)?(an\s+)?accredited\s+employer|\bnot\s+eligible\s+for\b[^.]{0,30}\b(sponsor\w*|aewv|visa)|\b(requir\w*|need\w*)\s+(a\s+)?(work\s+)?visa\s+sponsorship\b[^.]{0,40}\b(not|won'?t)\b|\bnot\s+(currently\s+)?(offer|provid)\w*\s+[^.]{0,20}\bsponsorship|\bnot\s+(looking|seeking|accepting|considering)\s+(for\s+)?[^.]{0,20}\b(overseas|offshore|international)|\bno\s+overseas\b|(residents?|citizens?|residency)\s+only\b|\bonly\s+(open\s+to\s+)?(nz|new zealand)\s+(citizens?|residents?)/i],
  ['sponsor', /\baewv\b|\baccredited\s+employer\b|\b(visa\s+)?sponsorship\s+(is\s+|may\s+be\s+)?(available|offered|considered|provided)|\b(will|can|could|able to|happy to|may)\s+(support|sponsor|assist\s+with)\b[^.]{0,40}\bvisa|\bsupport\s+(a\s+|your\s+|the\s+)?(work\s+)?visa/i],
  ['residency', /\b(nz|new zealand)\s+(citizen|citizenship|resident|residence|residency|permanent\s+resident)|\bresidency\b|\b(valid|current|appropriate)\s+(nz\s+|new zealand\s+)?(work|working\s+)?\s*visa|\b(nz|new zealand)\s+work\s+visa|\b(eligible|entitled|legally entitled|right)\s+to\s+work\s+in\s+(nz|new zealand|aotearoa)|\bwork\s+rights\b/i],
  ['other', /\bvisa\b|\bimmigration\b|\boverseas\s+(applicants|candidates|teachers)/i],
];

const decodeEntities = (s) => s
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Plain text of the "About the role" block of a Gazette vacancy page (paragraphs/list items → lines). */
export function gazetteDescription(html) {
  const m = html.match(/<div class="vd-description">([\s\S]*?)<\/div>/);
  if (!m) return null;
  return decodeEntities(m[1].replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const EMAIL = /\[email(?:\s|&#160;)*protected\]|[\w.+-]+ ?@ ?[\w-]+(?:\.[\w-]+)+/gi;
const PHONE = /(?:\+?64[\s-]?\(?0?\d{1,2}\)?|\(?0\d{1,2}\)?|0800|0508)[\s-]?\d{3}[\s-]?\d{3,4}\b/g;
/**
 * The ad text with email addresses and phone numbers replaced, so the archive keeps what the job was,
 * not how to reach the staff named in it. Contact details stay on the Gazette page.
 */
export function redactContacts(text) {
  if (!text) return text;
  return text.replace(EMAIL, '[email: see Gazette]').replace(PHONE, '[phone: see Gazette]');
}

/** Sentences about visas / residency / overseas applicants, each tagged with the strongest matching kind. */
export function extractVisa(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    for (const raw of line.split(/(?<=[.!?])\s+(?=[A-Z(])/)) {
      const s = raw.trim();
      const rule = VISA_RULES.find(([, re]) => re.test(s));
      if (!rule || seen.has(s)) continue;
      seen.add(s);
      out.push({ kind: rule[0], text: s.length > 300 ? `${s.slice(0, 297)}…` : s });
      if (out.length >= 5) return out;
    }
  }
  return out;
}
