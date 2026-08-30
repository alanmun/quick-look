// Inflection handling.
//
// Wiktionary has an entry for "geese", but it only says "plural of goose" --
// which is not a definition. The single biggest quality win available is to
// notice those pointer entries and go fetch the lemma. This is why looking up
// "ran" in a naive client is useless and why it works here.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  // Matches Wiktionary's stock inflection glosses and captures the lemma.
  const FORM_OF = [
    /^(?:the\s+)?(?:plural|singular)\s+(?:form\s+)?of\s+(.+)$/i,
    /^(?:simple\s+)?past\s+(?:tense|participle)\s+(?:and\s+past\s+participle\s+)?of\s+(.+)$/i,
    /^past\s+participle\s+of\s+(.+)$/i,
    /^present\s+participle\s+(?:and\s+gerund\s+)?of\s+(.+)$/i,
    /^gerund\s+of\s+(.+)$/i,
    /^(?:third|3rd)[- ]person\s+singular\s+(?:simple\s+)?present\s+(?:indicative\s+)?(?:form\s+)?of\s+(.+)$/i,
    /^comparative\s+(?:degree\s+)?(?:form\s+)?of\s+(.+)$/i,
    /^superlative\s+(?:degree\s+)?(?:form\s+)?of\s+(.+)$/i,
    /^(?:alternative|alternate)\s+(?:form|spelling|case\s+form)\s+of\s+(.+)$/i,
    /^(?:obsolete\s+|archaic\s+|common\s+|informal\s+)?(?:misspelling|spelling)\s+of\s+(.+)$/i,
    /^inflection\s+of\s+(.+)$/i,
    /^(?:feminine|masculine|neuter)\s+(?:singular\s+|plural\s+)?of\s+(.+)$/i,
    /^diminutive\s+of\s+(.+)$/i,
    /^abbreviation\s+of\s+(.+)$/i,
    /^initialism\s+of\s+(.+)$/i,
    /^acronym\s+of\s+(.+)$/i,
    /^contraction\s+of\s+(.+)$/i,
    /^synonym\s+of\s+(.+)$/i,
  ];

  // A gloss that is only a pointer, e.g. "plural of goose". Returns the lemma
  // or null. Trailing commentary after a colon or semicolon is discarded.
  function formOfLemma(gloss) {
    const text = String(gloss || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 120) return null;
    for (const re of FORM_OF) {
      const m = re.exec(text);
      if (!m) continue;
      let lemma = m[1];
      lemma = lemma.split(/[;:,(]/)[0];
      lemma = lemma.replace(/\.$/, '').replace(/["'‘’“”]/g, '').trim();
      // Reject anything that is clearly a sentence rather than a headword.
      if (!lemma || lemma.length > 40) return null;
      if (lemma.split(/\s+/).length > 4) return null;
      return lemma;
    }
    return null;
  }

  // Candidate base forms to try when a word has no entry at all. Ordered by
  // likelihood. Only used as a fallback after the literal lookup misses.
  function baseFormCandidates(word) {
    const w = String(word || '').toLowerCase();
    if (w.length < 4 || /\s/.test(w)) return [];
    const out = [];
    const add = (c) => { if (c && c.length >= 2 && c !== w && !out.includes(c)) out.push(c); };

    if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
    if (w.endsWith('ing')) {
      add(w.slice(0, -3));
      add(w.slice(0, -3) + 'e');
      if (/([bdfglmnprt])\1ing$/.test(w)) add(w.slice(0, -4));
    }
    if (w.endsWith('ed')) {
      add(w.slice(0, -2));
      add(w.slice(0, -1));
      if (/([bdfglmnprt])\1ed$/.test(w)) add(w.slice(0, -3));
      if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
    }
    if (w.endsWith('er')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (w.endsWith('est')) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
    if (w.endsWith('ly')) add(w.slice(0, -2));
    return out.slice(0, 5);
  }

  // Normalizes a raw selection into something Wiktionary can be asked about.
  // Strips surrounding punctuation and smart quotes but preserves internal
  // hyphens and apostrophes, which are part of real headwords.
  function normalizeQuery(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^[\s"'‘’“”«»(\[{<.,;:!?—–-]+/, '');
    s = s.replace(/[\s"'‘’“”«»)\]}>.,;:!?—–]+$/, '');
    return s.trim();
  }

  QL.morph = { formOfLemma, baseFormCandidates, normalizeQuery, FORM_OF };
})();
