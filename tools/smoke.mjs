// Integration smoke test: loads the BUILT background bundle against a mocked
// WebExtension API and drives it through the real message router, so bundle
// ordering, the storage layer, and the router are all exercised together.
//
//   node build.mjs && node tools/smoke.mjs
//
// Not shipped in the extension build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '..', 'dist', 'firefox', 'background.js');

// ---- mock WebExtension API -------------------------------------------------

const store = new Map();
let listener = null;

globalThis.browser = {
  runtime: {
    id: 'quick-look@test',
    onMessage: { addListener: (fn) => { listener = fn; } },
  },
  storage: {
    local: {
      async get(keys) {
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      async remove(k) { store.delete(k); },
    },
    onChanged: { addListener: () => {} },
  },
  i18n: {
    async getAcceptLanguages() { return ['en-US', 'en']; },
    getUILanguage() { return 'en-US'; },
  },
  permissions: {
    async contains() { return false; },
    async request() { return false; },
    async remove() {},
  },
  identity: {},
  tabs: { async query() { return []; }, async sendMessage() {} },
  commands: { onCommand: { addListener: () => {} } },
};

(0, eval)(readFileSync(bundle, 'utf8'));

if (!listener) {
  console.error('FAIL: background never registered a message listener');
  process.exit(1);
}

function send(message) {
  return new Promise((resolve) => {
    const kept = listener(message, { id: 'quick-look@test' }, resolve);
    if (kept !== true) resolve(undefined);
  });
}

// ---- cases -----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, condition, detail) {
  console.log(`${condition ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}`
    + (detail ? `\n       ${detail}` : ''));
  if (!condition) failures++;
}

const settings = await send({ type: 'getSettings' });
check('getSettings returns defaults', settings?.ok && settings.settings.enabled === true);
check('LLM is off by default', settings?.settings.llmEnabled === false);

const status = await send({ type: 'providerStatus' });
check('no provider connected out of the box', status?.ok && status.connected === false);

// A single word, with page context.
const word = await send({
  type: 'lookup',
  payload: {
    text: 'daemon',
    page: { hostname: 'stackoverflow.com', title: 'systemd question', before: 'start the background', after: 'on boot' },
  },
});
check('word lookup succeeds', word?.ok && word.kind === 'word',
  word?.ok ? `top: ${word.result.senses[0].text.slice(0, 60)}` : JSON.stringify(word));
check('context picked the computing sense',
  /process|program/i.test(word?.result?.senses?.[0]?.text || ''),
  word?.result?.senses?.[0]?.text?.slice(0, 70));
check('multiple senses available for paging', (word?.result?.senses || []).length > 1,
  `${(word?.result?.senses || []).length} senses`);
check('credential never crosses into the tab response',
  !JSON.stringify(word).toLowerCase().includes('credential'));

await sleep(1200);

// A passage.
const passage = await send({
  type: 'lookup',
  payload: {
    text: 'The writ was issued nunc pro tunc, thereby mooting the interlocutory appeal.',
    page: { hostname: 'law.cornell.edu', title: 'Opinions' },
  },
});
check('passage lookup succeeds', passage?.ok && passage.kind === 'passage',
  passage?.ok ? `${passage.parts.length} terms` : JSON.stringify(passage).slice(0, 200));
check('passage found hard terms', (passage?.parts || []).length >= 2,
  (passage?.parts || []).map((p) => p.term).join(', '));

await sleep(1200);

// Explanation must refuse while disconnected.
const explain = await send({ type: 'explain', payload: { text: 'anything' } });
check('explain refuses with no provider', explain?.ok === false, explain?.error);

// Host disabling.
await send({ type: 'setSettings', payload: { patch: { disabledHosts: ['example.com'] } } });
const blocked = await send({
  type: 'lookup',
  payload: { text: 'daemon', page: { hostname: 'www.example.com' } },
});
check('disabled host blocks lookups', blocked?.ok === false && blocked.reason === 'host-disabled');

// Cache: a repeat lookup should not re-fetch.
await send({ type: 'setSettings', payload: { patch: { disabledHosts: [] } } });
// Only the definition endpoint is asserted on. The label fetch is best-effort
// and is legitimately retried when Wikimedia rate-limits it, so counting all
// calls here would make this test flaky rather than meaningful.
const realFetch = globalThis.fetch;
let defCalls = 0;
globalThis.fetch = (url, ...rest) => {
  if (String(url).includes('/page/definition/')) defCalls++;
  return realFetch(url, ...rest);
};
await send({ type: 'lookup', payload: { text: 'daemon', page: { hostname: 'stackoverflow.com' } } });
check('repeat lookup re-uses the cached definition', defCalls === 0, `${defCalls} definition fetches`);
globalThis.fetch = realFetch;

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
