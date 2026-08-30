// Dev harness: runs the real ranking pipeline against the live Wiktionary API
// so the ranker can be tuned against actual payloads rather than guesses.
//
//   node tools/probe.mjs                 # run the regression cases
//   node tools/probe.mjs ran run "kick the bucket"
//
// Not shipped in the extension build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'lib');
const ORDER = ['sanitize.js', 'langs.js', 'context.js', 'morph.js', 'labels.js', 'rank.js', 'wiktionary.js'];
for (const f of ORDER) {
  // eslint-disable-next-line no-eval
  (0, eval)(readFileSync(join(src, f), 'utf8'));
}
const QL = globalThis.QL;

// `want` is a substring the top-ranked gloss must contain. These are
// regressions, not preferences: every one of them was observed ranking wrongly
// at some point while the scoring was being tuned.
const CASES = [
  { q: 'ran', want: 'run', note: 'raw payload leads with an ISO 639-3 language code' },
  { q: 'geese', want: 'waterfowl', note: 'entry is only "plural of goose"' },
  { q: 'better', want: 'Greater', note: 'entry leads with "comparative of good"' },
  { q: 'Apple', want: 'Apple', note: 'raw payload leads with a nickname for New York City' },
  { q: 'rizz', want: 'attract', note: 'dictionaryapi.dev 404s on this' },
  { q: 'gaslighting', want: 'Manipulation', note: 'literal "burning gas" sense is listed first' },
  { q: 'kick the bucket', want: 'die', note: '"break down" sense competes with the real one' },
  { q: 'a priori', wantAny: ['hypothesis', 'self-evident'],
    note: 'first sense is empty in the raw payload; either surviving sense is correct' },
  { q: 'ubiquitous', want: 'everywhere', note: 'dictionaryapi.dev times out on this' },
  { q: 'perro', want: 'dog', lang: 'Spanish', note: 'raw payload lists Chavacano first' },
  { q: 'Wasser', page: { pageLang: 'de' }, want: 'water', lang: 'German',
    note: 'English section says "a surname"; colloquial sense is "urine"' },
  { q: 'Schadenfreude', want: 'malicious', lang: 'German', note: 'raw payload lists French first' },
  {
    q: 'consideration', want: 'recompense',
    page: { hostname: 'law.cornell.edu', before: 'a contract requires valid' },
    note: 'page topic should surface the contract-law sense',
  },
  {
    q: 'daemon', want: 'process',
    page: { hostname: 'stackoverflow.com', before: 'start the background' },
    note: 'page topic should surface the computing sense',
  },
  {
    q: 'daemon', want: 'deity',
    page: { hostname: 'theoi.com', title: 'Greek mythology' },
    note: 'same word, no computing context: mythology sense should win',
  },
];

const words = process.argv.slice(2);
const cases = words.length ? words.map((q) => ({ q })) : CASES;

const deps = { fetchImpl: fetch };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;

let first = true;
for (const c of cases) {
  // Wikimedia rate-limits the wikitext endpoint; pace the suite so failures
  // are ranking failures rather than throttling.
  if (!first) await sleep(2500);
  first = false;
  const ctx = QL.context.build(c.page || {});
  const userLangs = ['en'];
  const posHint = QL.context.posHint((c.page || {}).before);
  const script = QL.langs.detectScript(c.q);

  // Wikimedia throttles bursts, and a 429 is not a ranking failure. Retry with
  // backoff so this suite reports on scoring rather than on network luck.
  let r = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      r = await QL.wiktionary.lookup(c.q, {
        fetchImpl: deps.fetchImpl, ctx, userLangs, posHint, selectionScript: script,
      });
    } catch (e) {
      console.log(`\x1b[31mERR\x1b[0m  ${c.q}: ${e.message}`);
      break;
    }
    if (!r || r.reason !== 'rate-limited') break;
    const wait = 4000 * (attempt + 1);
    process.stdout.write(`\x1b[2m  throttled on "${c.q}", waiting ${wait / 1000}s…\x1b[0m\n`);
    await sleep(wait);
    r = null;
  }
  if (!r) {
    console.log(`\x1b[31mERR\x1b[0m  ${c.q}: gave up after repeated rate limiting`);
    continue;
  }

  if (!r.ok) {
    console.log(`\x1b[31mMISS\x1b[0m ${c.q}  (${r.reason}, tried: ${(r.tried || []).join(', ')})`);
    continue;
  }
  const top = r.senses[0];
  const wants = c.wantAny || (c.want ? [c.want] : []);
  const okText = !wants.length
    || wants.some((w) => top.text.toLowerCase().includes(w.toLowerCase()));
  const okLang = !c.lang || r.langName === c.lang;
  if (okText && okLang) pass++;
  const mark = okText && okLang ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  const tag = r.isTranslation ? `\x1b[35m${r.langName}→English\x1b[0m ` : '';
  const lemma = r.lemmaNote ? `\x1b[36m(via ${r.lemmaNote.to})\x1b[0m ` : '';
  console.log(`${mark} \x1b[1m${c.q}\x1b[0m ${tag}${lemma}${!okText ? `\x1b[31m  expected one of: ${wants.join(', ')}\x1b[0m` : ''}`);
  console.log(`       [${top.pos}]${top.labels.length ? ' (' + top.labels.join(', ') + ')' : ''} ${top.text.slice(0, 96)}`);
  if (top._why.length) console.log(`       \x1b[2mwhy: ${top._why.join('; ')}\x1b[0m`);
  console.log(`       \x1b[2m${r.senses.length} senses total${r.otherLangs.length ? ' | also: ' + r.otherLangs.map((l) => l.langName).join(', ') : ''}\x1b[0m`);
  if (c.note) console.log(`       \x1b[2mcase: ${c.note}\x1b[0m`);
  console.log();
}

console.log(`${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exitCode = 1;
