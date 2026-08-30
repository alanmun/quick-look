// Dev harness: dumps every parsed sense with its labels and its ranking score,
// so a mis-ranked word can be diagnosed instead of guessed at.
//
//   node tools/senses.mjs daemon
//   node tools/senses.mjs consideration --host law.cornell.edu --before "a contract requires valid"
//
// Not shipped in the extension build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'lib');
for (const f of ['sanitize.js', 'langs.js', 'context.js', 'morph.js', 'labels.js', 'rank.js', 'wiktionary.js']) {
  (0, eval)(readFileSync(join(src, f), 'utf8'));
}
const QL = globalThis.QL;

const argv = process.argv.slice(2);
const word = argv.find((a) => !a.startsWith('--')) || 'daemon';
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : '';
};

const page = {
  hostname: flag('host'), before: flag('before'),
  after: flag('after'), title: flag('title'), pageLang: flag('lang'),
};
const ctx = QL.context.build(page);
console.log('context topics:', ctx.topics, '| nearby:', ctx.nearby.slice(0, 10),
  '| posHint:', QL.context.posHint(page.before));

const payload = await QL.wiktionary.fetchWord(word, { fetchImpl: fetch });
if (!payload) { console.log('no entry'); process.exit(0); }

const sections = QL.wiktionary.parse(payload);
QL.labels.applyLabels(sections, await QL.labels.labelsFor(word, { fetchImpl: fetch }));
const rankOpts = { posHint: QL.context.posHint(page.before), headword: word };
const langs = QL.rank.rankLanguages(sections, ctx, ['en'], QL.langs.detectScript(word), rankOpts);

console.log('\nlanguage sections, ranked:');
for (const l of langs) {
  console.log(`  ${l._score.toFixed(1).padStart(6)}  ${l.langName} (${l.senses.length} senses)`);
}

const senses = QL.rank.rankSenses(langs[0].senses, ctx, rankOpts);
console.log(`\nsenses in "${langs[0].langName}", ranked:`);
for (const s of senses) {
  const labels = s.labels.length ? `(${s.labels.join(', ')}) ` : '';
  console.log(`  ${s._score.toFixed(1).padStart(6)}  [${s.pos}] ${labels}${s.text.slice(0, 84)}`);
  if (s._why.length) console.log(`          why: ${s._why.join('; ')}`);
}
