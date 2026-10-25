import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, safeUrl, validCoord, toPublicRecord, mergeBatch, parseCsv, matchAewv } from './lib.mjs';

test('normalize keeps matching tolerant of macrons, case and spacing', () => {
  assert.equal(normalize('  Kaipātiki   Kindergarten '), 'kaipatiki kindergarten');
  assert.equal(normalize('St Mary’s & Co'), 'st mary s and co');
});

test('safeUrl only allows http(s)', () => {
  assert.equal(safeUrl('www.example.school.nz'), 'http://www.example.school.nz/');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl(''), null);
});

test('validCoord rejects zero and out-of-NZ coordinates', () => {
  assert.deepEqual(validCoord(-36.8, 174.7), [-36.8, 174.7]);
  assert.equal(validCoord(0, 0), null);
  assert.equal(validCoord(36.8, 174.7), null);
  assert.deepEqual(validCoord(-43.95, -176.56), [-43.95, -176.56]);
});

test('public record drops contact names, emails and phones', () => {
  const { record } = toPublicRecord('school', {
    School_Id: 1, Org_Name: 'Test School', Contact1_Name: 'Jane Doe', Email: 'jane@x.nz', Telephone: '09-1', Latitude: -36.8, Longitude: 174.7,
  });
  const s = JSON.stringify(record);
  assert.ok(!s.includes('Jane') && !s.includes('jane@') && !s.includes('09-1'));
  assert.equal(record.key, 'school:1');
});

test('school and ECE with the same official id do not collide', () => {
  const a = toPublicRecord('school', { School_Id: 5, Org_Name: 'A' }).record;
  const b = toPublicRecord('ece', { ECE_Id: 5, Org_Name: 'B' }).record;
  const { records } = mergeBatch([], [a, b], 'b1', '2026-10-25');
  assert.equal(records.length, 2);
});

test('mergeBatch is idempotent and flags missing records instead of deleting', () => {
  const r = (id, name) => toPublicRecord('school', { School_Id: id, Org_Name: name }).record;
  const first = mergeBatch([], [r(1, 'A'), r(2, 'B')], 'b1', '2026-10-01');
  const again = mergeBatch(first.records, [r(1, 'A'), r(2, 'B')], 'b2', '2026-10-08');
  assert.equal(again.records.length, 2);
  assert.deepEqual([again.report.added, again.report.changed, again.report.missing], [[], [], []]);
  const later = mergeBatch(again.records, [r(1, 'A renamed')], 'b3', '2026-10-15');
  const two = later.records.find((x) => x.key === 'school:2');
  assert.equal(two.sourceStatus, 'source_missing');
  assert.equal(two.missingSince, '2026-10-15');
  assert.deepEqual(later.report.changed, [{ key: 'school:1', fields: ['name'] }]);
  assert.equal(later.records.find((x) => x.key === 'school:1').firstSeen, '2026-10-01');
});

test('parseCsv handles quotes, commas and BOM', () => {
  const rows = parseCsv('﻿legal_name,nzbn\n"Smith, Jones Ltd",9429000000000\n"Say ""hi"" Ltd",\n');
  assert.deepEqual(rows, [{ legal_name: 'Smith, Jones Ltd', nzbn: '9429000000000' }, { legal_name: 'Say "hi" Ltd', nzbn: '' }]);
});

const inst = (key, name) => ({ key, name });
const emp = (legal_name, nzbn = null, trading_name = '') => ({ legal_name, trading_name, nzbn, batch: 't', source_as_of: null });

test('AEWV: group accreditation does not flow to every member without a confirmed link', () => {
  const institutions = [inst('ece:1', 'BestStart Albany'), inst('ece:2', 'BestStart Takapuna')];
  const employers = [emp('BestStart Educare Limited', '9429000000001')];
  const links = [{ institution: 'ece:1', nzbn: '9429000000001', relation: 'operator', verified_at: '2026-10-20' }];
  const m = matchAewv({ institutions, employers, links, reviews: [] });
  assert.equal(m['ece:1'].level, 'high');
  assert.notEqual(m['ece:2']?.level, 'high');
});

test('AEWV: exact name is only medium (needs review); similar name is low', () => {
  const institutions = [inst('school:1', 'Glenfield College'), inst('ece:3', 'Little Kiwis Albany Childcare')];
  const employers = [emp('Glenfield College'), emp('Little Kiwis Albany Limited')];
  const m = matchAewv({ institutions, employers, links: [], reviews: [] });
  assert.equal(m['school:1'].level, 'medium');
  assert.equal(m['school:1'].candidates[0].reviewStatus, 'pending');
  assert.equal(m['ece:3'].level, 'low');
});

test('AEWV: multiple same-level candidates become a conflict; none stays absent (unknown)', () => {
  const institutions = [inst('ece:4', 'Sunshine Kids'), inst('ece:5', 'Unlisted Centre')];
  const employers = [emp('Sunshine Kids', '9429000000002'), emp('Sunshine Kids', '9429000000003')];
  const m = matchAewv({ institutions, employers, links: [], reviews: [] });
  assert.equal(m['ece:4'].level, 'conflict');
  assert.equal(m['ece:5'], undefined);
});

test('AEWV: a rejected review removes the candidate; a confirmed review marks it verified', () => {
  const institutions = [inst('school:7', 'Northcote School'), inst('school:8', 'Takapuna School')];
  const employers = [emp('Northcote School', '9429000000004'), emp('Takapuna School', '9429000000005')];
  const reviews = [
    { institution: 'school:7', nzbn: '9429000000004', decision: 'rejected', reason: 'different town' },
    { institution: 'school:8', nzbn: '9429000000005', decision: 'confirmed', reviewer: 'admin', verified_at: '2026-10-25' },
  ];
  const m = matchAewv({ institutions, employers, links: [], reviews });
  assert.equal(m['school:7'], undefined);
  assert.equal(m['school:8'].candidates[0].reviewStatus, 'verified');
});

test('AEWV: a place name shared by a kindergarten and a college is not a candidate', () => {
  const institutions = [inst('ece:9', 'Ruawai Kindergarten')];
  const employers = [emp('The Ruawai College Board', '9429000000006', 'Ruawai College')];
  assert.equal(matchAewv({ institutions, employers, links: [], reviews: [] })['ece:9'], undefined);
});
