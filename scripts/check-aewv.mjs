// Cheap hourly probe: compare the latest snapshot in the nzaei catalog (≈8 KB) with the one the live site was
// built from. Writes changed=true|false to $GITHUB_OUTPUT so the deploy workflow only rebuilds when needed.
// Usage: node scripts/check-aewv.mjs <live site base url>
import { appendFile } from 'node:fs/promises';

const site = (process.argv[2] ?? '').replace(/\/?$/, '/');

async function main() {
  const res = await fetch('https://data.nzaei.zemo.bio/catalog.json');
  if (!res.ok) throw new Error(`catalog.json: HTTP ${res.status}`);
  const latest = [...(await res.json()).snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];

  let live = null;
  try {
    const r = await fetch(new URL('data/overlays.json', site), { cache: 'no-store' });
    if (r.ok) live = (await r.json()).aewv?.source?.sha256 ?? null;
  } catch { /* site not deployed yet: treat as changed */ }

  const changed = !latest || latest.sha256 !== live;
  console.log(`latest ${latest?.snapshot_date} ${latest?.sha256.slice(0, 12)}, live ${live?.slice(0, 12) ?? 'none'} → changed=${changed}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

main().catch(async (e) => {
  // If the catalog is unreachable there is nothing new to build; the live site keeps its snapshot.
  console.error(e.message);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'changed=false\n');
});
