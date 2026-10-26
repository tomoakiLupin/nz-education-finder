// Cheap hourly probe: compare the upstream sources with what the live site was built from — the latest snapshot in
// the nzaei catalog (≈8 KB) and the Education Gazette vacancies file. Writes changed=true|false to $GITHUB_OUTPUT so
// the deploy workflow only rebuilds when something is new.
// Usage: node scripts/check-updates.mjs <live site base url>
import { appendFile } from 'node:fs/promises';
import { sha256 } from './lib.mjs';

const site = (process.argv[2] ?? '').replace(/\/?$/, '/');

async function upstream() {
  const [cat, gz] = await Promise.all([
    fetch('https://data.nzaei.zemo.bio/catalog.json'),
    fetch('https://gazette.education.govt.nz/vacancies/data.json'),
  ]);
  if (!cat.ok) throw new Error(`catalog.json: HTTP ${cat.status}`);
  if (!gz.ok) throw new Error(`gazette data.json: HTTP ${gz.status}`);
  const latest = [...(await cat.json()).snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
  return { aewv: latest?.sha256 ?? null, jobs: sha256(Buffer.from(await gz.arrayBuffer())) };
}

async function live(path, pick) {
  try {
    const r = await fetch(new URL(path, site), { cache: 'no-store' });
    return r.ok ? pick(await r.json()) ?? null : null;
  } catch {
    return null; // site not deployed yet: treat as changed
  }
}

async function main() {
  const up = await upstream();
  const was = {
    aewv: await live('data/overlays.json', (d) => d.aewv?.source?.sha256),
    jobs: await live('data/jobs.json', (d) => d.source?.sha256),
  };
  const diff = Object.keys(up).filter((k) => up[k] !== was[k]);
  console.log(`upstream ${JSON.stringify(up)}; live ${JSON.stringify(was)} → changed: ${diff.join(', ') || 'none'}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${diff.length > 0}\n`);
}

main().catch(async (e) => {
  // If a source is unreachable there is nothing new to build; the live site keeps its data.
  console.error(e.message);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'changed=false\n');
});
