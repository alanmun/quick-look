// Dev harness: executes the card renderers against a minimal DOM shim and
// prints the resulting tree, so rendering bugs surface without a browser.
//
//   node tools/render.mjs
//
// Not shipped in the extension build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');

// ---- minimal DOM ----------------------------------------------------------

class Node_ {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.children = [];
    this.style = {};
    this.attrs = {};
    this._text = null;
    this.disabled = false;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = nodes; }
  get childNodes() { return this.children; }
  addEventListener() {}
  setAttribute(k, v) { this.attrs[k] = v; }
  get isConnected() { return true; }
}

globalThis.document = {
  createElement: (tag) => new Node_(tag),
  createTextNode: (text) => {
    const n = new Node_('#text');
    n._text = String(text);
    return n;
  },
};

function dump(node, depth = 0) {
  const pad = '  '.repeat(depth);
  if (node.tag === '#text') return `${pad}"${node._text}"`;
  const cls = node.className ? `.${node.className.split(' ').join('.')}` : '';
  const head = `${pad}<${node.tag}${cls}>`;
  if (node._text !== null) return `${head} ${JSON.stringify(node._text)}`;
  if (!node.children.length) return head;
  return [head, ...node.children.map((c) => dump(c, depth + 1))].join('\n');
}

for (const f of ['lib/sanitize.js', 'ui/card.js']) {
  (0, eval)(readFileSync(join(src, f), 'utf8'));
}
const QL = globalThis.QL;

// ---- fixtures --------------------------------------------------------------

const handlers = { go() {}, explain() {}, drillInto() {} };
const root = new Node_('div');
let failures = 0;

function scenario(name, fn) {
  try {
    fn();
    console.log(`\n\x1b[1m${name}\x1b[0m`);
    console.log(dump(root.children[0], 1));
  } catch (e) {
    failures++;
    console.log(`\n\x1b[31mTHREW\x1b[0m ${name}: ${e.message}`);
  }
}

const wordState = {
  kind: 'word',
  index: 0,
  showExamples: true,
  llmEnabled: false,
  result: {
    word: 'daemon',
    query: 'daemon',
    langCode: 'en',
    langName: 'English',
    isTranslation: false,
    lemmaNote: null,
    senses: [
      {
        pos: 'Noun',
        labels: ['computing', 'unix'],
        text: 'A process (a running program) that does not have a controlling terminal.',
        examples: ['The sshd daemon listens on port 22.'],
        _why: ['matches this page’s subject'],
      },
      { pos: 'Noun', labels: [], text: 'A minor deity or divinity.', examples: [], _why: [] },
    ],
  },
};

scenario('word, sense 1 of 2, no LLM', () => QL.card.renderWord(root, wordState, handlers));

scenario('word, sense 2, LLM enabled', () => QL.card.renderWord(
  root, Object.assign({}, wordState, { index: 1, llmEnabled: true }), handlers
));

scenario('translation with lemma note', () => QL.card.renderWord(root, {
  kind: 'word', index: 0, showExamples: true, llmEnabled: false,
  result: {
    word: 'Wasser', query: 'Wasser', langCode: 'de', langName: 'German',
    isTranslation: true,
    lemmaNote: { from: 'geese', to: 'goose', relation: 'plural of goose' },
    senses: [{ pos: 'Noun', labels: [], text: 'water (H₂O)', examples: [], _why: [] }],
  },
}, handlers));

scenario('single sense, no LLM (footer is attribution only)', () => QL.card.renderWord(root, {
  kind: 'word', index: 0, showExamples: false, llmEnabled: false,
  result: {
    word: 'ubiquitous', query: 'ubiquitous', langCode: 'en', langName: 'English',
    isTranslation: false, lemmaNote: null,
    senses: [{ pos: 'Adjective', labels: [], text: 'Being everywhere at once.', examples: [], _why: [] }],
  },
}, handlers));

scenario('explanation rendered', () => QL.card.renderWord(root, Object.assign({}, wordState, {
  llmEnabled: true, explanation: 'A background program with no terminal attached.',
}), handlers));

scenario('passage', () => QL.card.renderPassage(root, {
  kind: 'passage',
  query: 'The writ was issued nunc pro tunc, mooting the interlocutory appeal.',
  llmEnabled: true,
  parts: [
    { term: 'interlocutory', result: { word: 'interlocutory', senses: [{ pos: 'Adjective', text: 'Interim; not final.', labels: [] }] } },
    { term: 'nunc pro tunc', result: { word: 'nunc pro tunc', senses: [{ pos: 'Adverb', text: 'Retroactively.', labels: [] }] } },
  ],
}, handlers));

scenario('loading', () => QL.card.renderLoading(root, 'serendipity'));
scenario('error', () => QL.card.renderMessage(root, 'No entry for “asdfgh”.', false));

console.log(failures ? `\n${failures} renderer(s) threw` : '\nall renderers ran');
process.exitCode = failures ? 1 : 0;
