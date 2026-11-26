import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, safeUrl, validCoord, toPublicRecord, mergeBatch, parseCsv, matchAewv, matchJobs, extractVisa, htmlToText, parseGazetteVacancy, gazetteSitemap, refToId, redactContacts, eroDate, parseEroPage, parseAkarangiXml } from './lib.mjs';

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

test('AEWV: same distinctive name without generic words is medium where the employer is local, low elsewhere', () => {
  const at = (key, name, city, suburb = null) => ({ key, name, cat: key.split(':')[0], city, suburb, district: null, region: 'Auckland Region' });
  const local = (legal_name, trading_name, city) => ({ ...emp(legal_name, null, trading_name), city, industry: 'Health Care and Social Assistance / Social Assistance Services' });
  const institutions = [
    at('ece:10', 'Happy Kiddy Warkworth Early Learning Centre', 'Warkworth'),
    at('ece:11', 'Sylvia Park Kindergarten', 'Auckland', 'Mount Wellington'),
    at('ece:12', 'Hill Street Early Childhood Centre', 'Wellington', 'Thorndon'),
    at('ece:13', 'Warkworth Kindergarten', 'Warkworth'), // place-only name: never matched this way
    at('ece:14', 'Totara Hill Montessori', 'Matakana-Auckland'),
  ];
  const employers = [
    local('Delight Education Limited', 'Happy Kiddy Early Education Center Warkworth', 'Warkworth'),
    { ...emp('The Sylvia Park School Board', null, 'Sylvia Park School'), city: 'Auckland', industry: 'Education and Training' },
    local('Hill Street Limited', 'Hill Street Limited', 'Auckland'),
    local('Warkworth Early Learning Limited', '', 'Warkworth'),
    local('Totara Hill Montessori 2025 Limited', '', 'Matakana'), // year in the company name is ignored
  ];
  const m = matchAewv({ institutions, employers, links: [], reviews: [] });
  assert.equal(m['ece:10'].level, 'medium');
  assert.equal(m['ece:10'].candidates[0].employer, 'Delight Education Limited');
  assert.equal(m['ece:11'], undefined); // a kindergarten is not the school it is named after
  assert.equal(m['ece:12'].level, 'low'); // registered in another city
  assert.equal(m['ece:13'], undefined);
  assert.equal(m['ece:14'].level, 'medium');
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

test('matchJobs links vacancies by exact name, breaks ties by region, never guesses', () => {
  const inst = [
    { key: 'school:1', name: 'St Mary’s School', region: 'Auckland Region', sourceStatus: 'present' },
    { key: 'school:2', name: "St Mary's School", region: 'Nelson Region', sourceStatus: 'present' },
    { key: 'school:3', name: 'Rangitoto School', region: 'Waikato Region', sourceStatus: 'present' },
    { key: 'ece:9', name: 'Closed Kindy', region: 'Otago Region', sourceStatus: 'source_missing' },
  ];
  const jobs = [
    { institute: 'Rangitoto School ', region: 'Waikato' },
    { institute: "St Mary's School", region: 'Tasman/Nelson' },
    { institute: "St Mary's School", region: 'Otago' },
    { institute: 'Closed Kindy', region: 'Otago' },
    { institute: 'Sport Bay of Plenty', region: 'Bay of Plenty' },
  ];
  assert.deepEqual(matchJobs(jobs, inst), ['school:3', 'school:2', null, null, null]);
});

test('matchAewv links ECE chain branches to the brand employer, but not place names or unrelated businesses', () => {
  const ece = (id, name, suburb) => ({ key: `ece:${id}`, cat: 'ece', name, suburb, city: 'Auckland', district: null, region: 'Auckland Region' });
  const institutions = [
    ece(1, 'Kindercare Learning Centres Botany Downs', 'Botany Downs'),
    ece(2, 'Kindercare Learning Centre - Papatoetoe', 'Papatoetoe'),
    ece(3, 'Ruawai Kindergarten', 'Ruawai'),
    ece(4, 'Ruawai Playgroup', 'Ruawai'),
    ece(5, 'Capital Kids Co-Operative', 'Te Aro'),
    ece(6, 'Capital City Preschool', 'Te Aro'),
    { key: 'school:7', cat: 'school', name: 'Kindercare School', suburb: 'X', city: 'Auckland', district: null, region: 'Auckland Region' },
  ];
  const employers = [
    { legal_name: 'Kindercare Learning Centres Limited', trading_name: 'kindercare Learning Centers Limited', nzbn: '9429040386706', industry: 'Education and Training / Preschool and School Education' },
    { legal_name: 'The Ruawai College Board', trading_name: '', nzbn: '9429000000001', industry: 'Education and Training' },
    { legal_name: 'Capital Scaffolding Limited', trading_name: 'Capital', nzbn: '9429000000002', industry: 'Construction' },
  ];
  const m = matchAewv({ institutions, employers, links: [], reviews: [] });
  assert.equal(m['ece:1'].level, 'medium');
  assert.equal(m['ece:2'].candidates[0].nzbn, '9429040386706');
  assert.ok(!m['ece:3'] && !m['ece:4'] && !m['ece:5'] && !m['ece:6'] && !m['school:7']);
});

test('extractVisa tags residency, no-overseas and sponsorship statements', () => {
  const text = [
    'We are a friendly kindergarten.',
    'Applicants must be NZ registered teachers and have NZ residency or a valid NZ work visa. Great team!',
    'Unfortunately we are unable to sponsor work visas.',
    'Overseas applicants will not be considered.',
    'Full-time, ECE Qualified teacher (Accredited employer)',
    'Eligibility: Applications are open to New Zealand residents only',
  ].join('\n');
  assert.deepEqual(extractVisa(text).map((x) => x.kind), ['residency', 'no_overseas', 'no_overseas', 'sponsor', 'no_overseas']);
  assert.equal(extractVisa(text)[0].text, 'Applicants must be NZ registered teachers and have NZ residency or a valid NZ work visa.');
  assert.deepEqual(extractVisa('Join our team of passionate educators.'), []);
});

test('htmlToText turns an ad body into lines without markup', () => {
  assert.equal(htmlToText('<p>Hello &amp; welcome.</p>\n<p>Must hold a <b>valid</b> visa.</p><ul><li>K&#x101;hui</li></ul>'), 'Hello & welcome.\nMust hold a valid visa.\nKāhui');
});

test('refToId decodes Gazette references to the numeric listing ids of the old data feed', () => {
  assert.equal(refToId('1HAur5'), 277465);
  assert.equal(refToId('1HAty_'), 274314);
  assert.equal(refToId('1HAtKi'), 271983);
  assert.equal(refToId('bad ref'), null);
  assert.equal(refToId('1HAlr5'), null); // "l" is not in the alphabet
});

test('gazetteSitemap lists vacancy references with their last-modified time, nothing else', () => {
  const xml = '<urlset><url><loc>https://gazette.education.govt.nz/vacancies</loc></url>'
    + '<url><loc>https://gazette.education.govt.nz/vacancies/1HB1qt</loc><lastmod>2026-11-24T19:45:00.000Z</lastmod></url>'
    + '<url><loc>https://gazette.education.govt.nz/stories/abc</loc></url></urlset>';
  assert.deepEqual(gazetteSitemap(xml), [{ ref: '1HB1qt', modified: '2026-11-24T19:45:00.000Z' }]);
});

test('parseGazetteVacancy reads JobPosting data and role details, not the contact block', () => {
  const ld = {
    '@type': 'JobPosting', title: 'Year 5-6 Teacher', identifier: { value: '1HB1rR' },
    description: '<p>Join us.</p><p>Applicants must hold NZ work rights.</p>', validThrough: '2026-12-09T02:00:00.000Z',
    hiringOrganization: { name: 'Korakonui School' }, jobLocation: { address: { addressRegion: 'Waikato' } },
  };
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script><h1>Year 5-6 Teacher</h1>`
    + '<span class="x_tag">Part-time (0.5 FTTE)</span><span class="x_tag">Suitable for beginning teachers</span><h2>About the role</h2>'
    + '<p>Direct enquiries to: Jo, 021 123 4567</p>'
    + '<h2 id="role-details-2" class="h">Role details</h2><dl class="f"><dt>Role</dt><dd>Classroom teacher</dd>'
    + '<dt>Sector</dt><dd>Primary and intermediate (Years 1–8) / kura tuatahi</dd><dt>Position</dt><dd>Part-time (0.5 FTTE), fixed-term</dd>'
    + '<dt>Incentives and allowances</dt><dd>None listed</dd><dt>Learning areas</dt><dd>English, Health and PE</dd><dt>Region</dt><dd>Waikato</dd></dl>';
  const v = parseGazetteVacancy(html);
  assert.equal(v.ref, '1HB1rR');
  assert.equal(v.institute, 'Korakonui School');
  assert.deepEqual(v.roles, ['Classroom teacher']);
  assert.deepEqual(v.positions, ['Part-time', 'Fixed-term']);
  assert.deepEqual(v.learning, ['English', 'Health and PE']);
  assert.equal(v.allowances, null);
  assert.equal(v.beginning, true);
  assert.equal(v.closing, '2026-12-09'); // NZ date
  assert.equal(v.closingTime, '3pm'); // 02:00Z = 3pm NZDT
  assert.equal(v.text, 'Join us.\nApplicants must hold NZ work rights.');
  assert.equal(parseGazetteVacancy('<html>no data</html>'), null);
});

test('extractVisa treats negative sponsorship statements as no-overseas', () => {
  const kinds = (t) => extractVisa(t).map((x) => x.kind);
  assert.deepEqual(kinds('Please note: This position is not eligible for AEWV sponsorship.'), ['no_overseas']);
  assert.deepEqual(kinds('Note as we are not currently an accredited employer, candidates must hold valid NZ work rights.'), ['no_overseas']);
  assert.deepEqual(kinds('Applicants requiring visa sponsorship will not be considered.'), ['no_overseas']);
  assert.deepEqual(kinds('Please note - we are not looking for overseas applicants'), ['no_overseas']);
  assert.deepEqual(kinds('We are an accredited employer.'), ['sponsor']);
  assert.deepEqual(kinds('Candidates must have a New Zealand Work Visa allowing full-time employment.'), ['residency']);
});

test('redactContacts removes emails and phone numbers but keeps other numbers', () => {
  const t = 'Contact Jo Bloggs, jo.bloggs @school.nz or [email protected], ph 09 399 2802, 021-123-4567, +64 21 555 1234 or 0800 123 456. Salary $75,000, 0.6 FTE, starting 2027.';
  assert.equal(redactContacts(t), 'Contact Jo Bloggs, [email: see Gazette] or [email: see Gazette], ph [phone: see Gazette], [phone: see Gazette], [phone: see Gazette] or [phone: see Gazette]. Salary $75,000, 0.6 FTE, starting 2027.');
});

test('eroDate: month-year and dd/mm/yyyy titles', () => {
  assert.equal(eroDate('Bunny Childcare Warkworth - June 2026'), '2026-06');
  assert.equal(eroDate('The Learning Ladder - 31/10/2019'), '2019-10');
  assert.equal(eroDate('No date'), null);
});

test('parseEroPage: assurance standards, info table dropped, past reports, international students', () => {
  const html = '<main id="main-content"><h2>Wa Ora Montessori Preschool - August 2024</h2><p>ERO’s Akanuku | Assurance Review reports</p>'
    + '<table><tr><td><h4>Regulatory standards</h4></td><td><h4>ERO’s judgement</h4></td></tr>'
    + '<tr><td>Curriculum</td><td>Meeting</td></tr><tr><td>Health and safety</td><td>Not meeting&nbsp;</td></tr></table>'
    + '<table><tr><td>Service type</td><td>Education and care service</td></tr><tr><td>Number licensed for</td><td>120 children</td></tr></table>'
    + '<h2>Past Reports</h2><div class="past-reports-list"><div class="past-report-item"><div class="past-report-title"><span>Provision for International Students Report May 2023</span></div>'
    + '<a class="past-report-link" href="/institution/1/x/?reportId=abc&amp;versionId=def">View this report </a></div></div>'
    + '<div class="right-container"></div></main>';
  const p = parseEroPage(html, 'https://www.ero.govt.nz/institution/1/x');
  assert.equal(p.kind, 'assurance');
  assert.equal(p.date, '2024-08');
  assert.deepEqual(p.rows, [['Curriculum', 'Meeting'], ['Health and safety', 'Not meeting']]);
  assert.equal(p.past[0].url, 'https://www.ero.govt.nz/institution/1/x/?reportId=abc&versionId=def');
  assert.equal(p.intl, true);
});

test('parseEroPage: governing organisation page with report PDF, framework PDFs ignored; empty page → null', () => {
  const html = '<main><h2>Educare Early Learning Centres December 2025</h2><p>We call this a governing organisation.</p>'
    + '<a href="/sites/default/files/x/Improvement%20Framework%20%28teacher-led%29.pdf">f</a><a href="/sites/default/files/2025-12/report_32.pdf">r</a></main>';
  const p = parseEroPage(html, 'https://www.ero.govt.nz/institution/46992/educare-warkworth');
  assert.equal(p.kind, 'group');
  assert.equal(p.pdf, 'https://www.ero.govt.nz/sites/default/files/2025-12/report_32.pdf');
  assert.equal(parseEroPage('<main><div class="right-container"></div></main>', 'https://www.ero.govt.nz/'), null);
});

test('parseAkarangiXml: highlighted (white / near-white) cell per domain row', () => {
  const xml = '<fontspec id="0" size="17" family="C" color="#000000"/><fontspec id="11" size="17" family="C" color="#005e62"/>'
    + '<fontspec id="3" size="33" family="C" color="#ffffff"/><fontspec id="12" size="17" family="C" color="#fcfaff"/>'
    + '<text top="175" left="85" width="1" height="1" font="3">ERO Early Childhood Service Akarangi</text>'
    + '<text top="485" left="93" width="1" height="1" font="11"><b>Domains: Ngā Akatoro</b></text>'
    + '<text top="539" left="93" width="1" height="1" font="0">The learner and their learning </text>'
    + '<text top="569" left="93" width="1" height="1" font="0">He Whāriki Motuhake</text>'
    + '<text top="554" left="586" width="1" height="1" font="12"><b>Embedded </b></text>'
    + '<text top="554" left="718" width="1" height="1" font="11">Excelling </text>'
    + '<text top="607" left="93" width="1" height="1" font="0">Collaborative professional </text>'
    + '<text top="628" left="93" width="1" height="1" font="0">learning and development </text>'
    + '<text top="637" left="473" width="1" height="1" font="12"><b>Working </b></text>'
    + '<text top="657" left="474" width="1" height="1" font="12"><b>towards</b></text>'
    + '<text top="647" left="586" width="1" height="1" font="11">Embedded </text>'
    + '<text top="900" left="93" width="1" height="1" font="0">Children’s health and safety </text>'
    + '<text top="900" left="600" width="1" height="1" font="12"><b>Taking reasonable steps</b></text>';
  assert.deepEqual(parseAkarangiXml(xml), [
    ['The learner and their learning', 'Embedded'],
    ['Professional learning and development', 'Working towards'],
    ['Health and safety', 'Taking reasonable steps'],
  ]);
});
