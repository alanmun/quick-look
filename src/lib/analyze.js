// Decides what the user actually selected, and what to do about it.
//
// Three shapes, escalating:
//   word     - one token: define it
//   phrase   - 2-4 tokens: try it as a unit first (idioms and set phrases have
//              their own Wiktionary entries), fall back to its hard words
//   passage  - a sentence or more: pull out the terms a reader is likely to be
//              stuck on and define those, entirely decided on this machine
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const MAX_SELECTION = 2000;
  const MAX_TERMS = 6;

  function classify(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return { kind: 'empty', text: '' };
    if (text.length > MAX_SELECTION) {
      return { kind: 'too-long', text: text.slice(0, MAX_SELECTION) };
    }
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 1) return { kind: 'word', text, words };
    // Sentence-ending punctuation mid-selection means it is prose, not a phrase.
    const looksLikeProse = /[.!?;]\s/.test(text) || words.length > 4;
    if (!looksLikeProse) return { kind: 'phrase', text, words };
    return { kind: 'passage', text, words };
  }

  // Splits a passage into candidate terms worth defining. Runs locally; the
  // passage itself never leaves the machine.
  function hardTerms(text, opts) {
    const o = opts || {};
    const limit = o.limit || MAX_TERMS;
    const seen = new Set();
    const candidates = [];

    // Multi-word candidates first: capitalised runs are usually proper nouns
    // or technical terms that mean more together than apart.
    const properRuns = String(text).match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,3})\b/g) || [];
    for (const run of properRuns) {
      const key = run.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ term: run, score: 8 + run.split(/\s+/).length, multiword: true });
    }

    // Latin and foreign-looking set phrases that a reader will not parse.
    const latinish = String(text).match(/\b(?:[a-z]+\s+(?:de|di|du|von|van|pro|ex|in|ad|sub|per|sine|inter|prima)\s+[a-z]+|(?:a|de|ex|in|per|sub|ad)\s+[a-z]{4,})\b/gi) || [];
    for (const phrase of latinish) {
      const key = phrase.toLowerCase().trim();
      if (seen.has(key) || key.split(/\s+/).length < 2) continue;
      seen.add(key);
      candidates.push({ term: phrase.trim(), score: 7, multiword: true });
    }

    // Then single hard words.
    const tokens = String(text).split(/[^A-Za-zÀ-ɏ'-]+/).filter(Boolean);
    for (const token of tokens) {
      const word = token.replace(/^['-]+|['-]+$/g, '');
      if (word.length < 4) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      const score = QL.freq.rarity(word);
      if (score <= 0) continue;
      seen.add(key);
      candidates.push({ term: word, score, multiword: false });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  }

  // Runs lookups with bounded concurrency so a paragraph does not fire a dozen
  // simultaneous requests at Wikimedia.
  async function mapLimited(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = await fn(items[index], index);
        } catch (e) {
          results[index] = null;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  QL.analyze = { classify, hardTerms, mapLimited, MAX_SELECTION, MAX_TERMS };
})();
