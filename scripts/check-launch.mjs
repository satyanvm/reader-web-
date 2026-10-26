// Pre-launch check: lists every placeholder that would ship to production.
// Run with `npm run check:launch`; `npm run deploy` runs it first and stops
// if anything is left. Pass --warn to report without failing.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

const problems = [];
const config = await read('src/site.config.ts');

// Links for platforms marked `available: false` aren't shown, so they can wait.
const lines = config.split('\n');
let platformAvailable = true;
lines.forEach((line, i) => {
  if (/^\s*id: '/.test(line)) {
    const block = lines.slice(i, i + 6).join('\n');
    platformAvailable = !/available:\s*false/.test(block);
  }
  if (/^\s*\],?\s*(satisfies|$)/.test(line)) platformAvailable = true;
  const at = `src/site.config.ts:${i + 1}`;
  const isPlatformLink = /^\s*(url|alt|version|size):/.test(line);
  if (!platformAvailable && isPlatformLink) return;
  if (/example\.(com|org|net)/.test(line)) problems.push(`${at}  placeholder URL or email: ${line.trim()}`);
  else if (/\/\/\s*TODO/.test(line)) problems.push(`${at}  unconfirmed value: ${line.trim()}`);
});

if (/pricingIsPlaceholder:\s*true/.test(config)) {
  problems.push('src/site.config.ts  pricingIsPlaceholder is true, so the page says "Prices are placeholders"');
}

for (const page of ['src/pages/privacy.astro', 'src/pages/terms.astro']) {
  if ((await read(page)).includes('class="notice"')) {
    problems.push(`${page}  still marked as an unreviewed template`);
  }
}

if (problems.length === 0) {
  console.log('Launch check passed: no placeholders left.');
} else {
  console.log(`Launch check: ${problems.length} item(s) to resolve before launch:\n`);
  for (const p of problems) console.log(`  - ${p}`);
  if (!process.argv.includes('--warn')) process.exit(1);
}
