// Recovers Wiktionary's sense labels, which the definition endpoint discards.
//
// The REST definition endpoint renders "{{lb|en|computing|Unix}}" down to an
// EMPTY <span class="usage-label-sense">: you can tell a sense is labelled but
// not what the label says. The labels are the single strongest signal for
// picking the right sense, so we fetch the page's wikitext in parallel and
// read them out of the source. Payloads are small (2-9 KB).
//
// Senses are matched to labels by text similarity rather than by index,
// because the two endpoints do not always agree on how sub-senses are counted
// and a misaligned label is worse than no label.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const SOURCE_API = 'https://en.wiktionary.org/w/rest.php/v1/page/';

  // Labels that describe register or currency rather than subject matter.
  // Kept separate because they demote a sense instead of matching a topic.
  const REGISTER = new Set([
    'obsolete', 'archaic', 'dated', 'historical', 'rare', 'proscribed',
    'nonstandard', 'colloquial', 'informal', 'slang', 'vulgar', 'offensive',
    'derogatory', 'euphemistic', 'poetic', 'literary', 'humorous', 'dialectal',
    'regional', 'childish', 'ethnic slur', 'now rare', 'chiefly in compounds',
  ]);

  function stripWikitext(line) {
    let s = String(line || '');
    s = s.replace(/\{\{[^{}]*\}\}/g, ' ');
    s = s.replace(/\{\{[^{}]*\}\}/g, ' ');
    s = s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2');
    s = s.replace(/'''?/g, '');
    s = s.replace(/<[^>]*>/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  function normalizeForMatch(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Parses page source into { langName: [ { text, labels } ] }, in document
  // order. POS headings are not tracked: matching is by text, so they add
  // nothing but a chance to drift.
  function parseSource(source) {
    const out = {};
    let currentLang = null;
    for (const rawLine of String(source || '').split('\n')) {
      const line = rawLine.trimEnd();

      const heading = /^(={2,6})\s*([^=]+?)\s*\1$/.exec(line);
      if (heading) {
        if (heading[1].length === 2) {
          currentLang = heading[2].trim();
          if (!out[currentLang]) out[currentLang] = [];
        }
        continue;
      }
      if (!currentLang) continue;

      // A sense line starts with a single '#'. '#:' and '#*' are examples and
      // citations; '##' is a sub-sense, which the REST endpoint also emits.
      if (!/^#{1,2}(?![:*])/.test(line)) continue;

      const body = line.replace(/^#{1,2}\s*/, '');
      const labels = [];
      const labelRe = /\{\{(?:lb|label|lbl|tlb)\|[a-zA-Z-]+\|([^{}]*)\}\}/g;
      let m;
      while ((m = labelRe.exec(body)) !== null) {
        for (const part of m[1].split('|')) {
          const label = part.trim().toLowerCase();
          // "_" and "and" are formatting joiners in the lb template.
          if (!label || label === '_' || label === 'and' || label === 'or') continue;
          if (label.startsWith('nocat') || label.includes('=')) continue;
          labels.push(label);
        }
      }
      const text = stripWikitext(body);
      if (!text && !labels.length) continue;
      out[currentLang].push({ text, labels });
    }
    return out;
  }

  // Word-overlap similarity, used to pair a REST gloss with a source line.
  function similarity(a, b) {
    const aw = normalizeForMatch(a).split(' ').filter((w) => w.length > 2);
    const bw = new Set(normalizeForMatch(b).split(' ').filter((w) => w.length > 2));
    if (!aw.length || !bw.size) return 0;
    let hits = 0;
    for (const w of aw) if (bw.has(w)) hits++;
    return hits / Math.max(aw.length, bw.size);
  }

  // Attaches labels to already-parsed sections, in place. Unmatched senses are
  // simply left alone.
  function applyLabels(sections, parsedSource) {
    if (!parsedSource) return sections;
    for (const section of sections) {
      const candidates = parsedSource[section.langName];
      if (!candidates || !candidates.length) continue;
      const used = new Set();

      for (const sense of section.senses) {
        let bestIdx = -1;
        let bestScore = 0.34; // require a real match, not a coincidence
        candidates.forEach((cand, i) => {
          if (used.has(i)) return;
          const score = similarity(sense.text, cand.text);
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        });
        if (bestIdx < 0) continue;
        used.add(bestIdx);

        const found = candidates[bestIdx].labels;
        if (!found.length) continue;
        const merged = new Set(sense.labels || []);
        for (const l of found) merged.add(l);
        sense.labels = [...merged];
        sense.sourceLabels = found;
        sense.register = found.filter((l) => REGISTER.has(l));
        sense.topicLabels = found.filter((l) => !REGISTER.has(l));
      }
    }
    return sections;
  }

  async function fetchSource(word, deps) {
    const res = await deps.fetchImpl(SOURCE_API + encodeURIComponent(word), {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      // Shorter than the definition timeout: labels only improve ranking, so a
      // slow source fetch must never be what makes the popup feel sluggish.
      signal: AbortSignal.timeout(deps.labelTimeoutMs || 3500),
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': 'LookUp/0.1 (browser extension; https://github.com/alanmun/look-up)',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.source === 'string' ? json.source : null;
  }

  // Best-effort: a failure here degrades ranking slightly but must never break
  // a lookup, so every error is swallowed.
  async function labelsFor(word, deps) {
    try {
      if (!deps.jsonCache) {
        const source = await fetchSource(word, deps);
        return source ? parseSource(source) : null;
      }
      // Wrapped in an ok/failed envelope so the cache can tell a genuine
      // "this page has no labels" (worth remembering) apart from a rate-limited
      // or timed-out fetch (must be retried, never cached).
      const envelope = await deps.jsonCache.through('lbl:' + word, async () => {
        const source = await fetchSource(word, deps);
        return source === null ? { ok: false } : { ok: true, map: parseSource(source) };
      });
      return envelope && envelope.ok ? envelope.map : null;
    } catch (e) {
      return null;
    }
  }

  QL.labels = { labelsFor, parseSource, applyLabels, similarity, REGISTER, stripWikitext };
})();
