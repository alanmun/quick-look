// Wiktionary client: fetch, parse, rank, and resolve inflections.
//
// This module never touches the DOM and never reads page content. It is given
// a headword and a locally-computed context object, and returns ranked senses.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  const MAX_SENSES_PER_POS = 12;

  // Wiktionary buckets less-common languages under the literal key "other" and
  // puts the real name in the section body, so always trust section.language
  // for display and only use the key as a code hint.
  function sectionCode(key, language) {
    if (key && key !== 'other') return key;
    const name = String(language || '').toLowerCase();
    const guesses = {
      'alemannic german': 'gsw', 'pennsylvania german': 'pdc',
      'chavacano': 'cbk', 'ladino': 'lad', 'scots': 'sco',
    };
    return guesses[name] || 'other';
  }

  function buildUrl(word) {
    // encodeURIComponent leaves the characters Wiktionary titles actually use
    // intact while escaping everything else. Spaces become %20, which the
    // definition endpoint accepts for multi-word idioms.
    return API + encodeURIComponent(word).replace(/%20/g, '%20');
  }

  // Turns one raw API payload into flat, ranked-ready sections.
  function parse(payload) {
    const S = QL.sanitize;
    const out = [];
    if (!payload || typeof payload !== 'object') return out;

    for (const [key, entries] of Object.entries(payload)) {
      if (!Array.isArray(entries) || !entries.length) continue;
      const langName = entries[0].language || key;
      const langCode = sectionCode(key, langName);
      const senses = [];

      entries.forEach((entry, posIndex) => {
        const pos = entry.partOfSpeech || '';
        const defs = Array.isArray(entry.definitions) ? entry.definitions : [];
        defs.slice(0, MAX_SENSES_PER_POS).forEach((d, senseIndex) => {
          const raw = S.htmlToText(d.definition || '');
          if (!raw) return;
          const { labels, text } = S.splitLabels(raw);
          if (!text || text.length < 2) return;

          const examples = (d.parsedExamples || d.examples || [])
            .map((ex) => S.htmlToText(typeof ex === 'string' ? ex : (ex && ex.example) || ''))
            .filter((ex) => ex && ex.length > 4)
            .slice(0, 2);

          const lemma = QL.morph.formOfLemma(text);
          senses.push({
            pos, labels, text, examples, posIndex, senseIndex,
            langCode, langName,
            isFormOf: Boolean(lemma),
            lemma: lemma || null,
          });
        });
      });

      if (senses.length) out.push({ langCode, langName, senses });
    }
    return out;
  }

  async function fetchWord(word, deps) {
    const url = buildUrl(word);
    // Cache at the URL level rather than at the result level: the same word
    // looked up on two different pages shares the network round-trip but is
    // ranked separately against each page's context.
    if (deps.jsonCache) {
      return deps.jsonCache.through('def:' + url, () => fetchWordUncached(url, deps));
    }
    return fetchWordUncached(url, deps);
  }

  async function fetchWordUncached(url, deps) {
    const doFetch = deps.fetchImpl;
    const res = await doFetch(url, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.timeoutMs || 6000),
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': 'LookUp/0.1 (browser extension; https://github.com/alanmun/look-up)',
      },
    });
    if (res.status === 404) return null;
    if (res.status === 429) {
      // Wikimedia throttles bursts. Deliberately not retried: a retry would
      // compound the problem, and the user can simply select the word again.
      // What matters is that this never masquerades as "no such word".
      const err = new Error('wiktionary rate-limited');
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error('wiktionary ' + res.status);
    return res.json();
  }

  // Full lookup with inflection resolution.
  //
  // deps: { fetchImpl, ctx, userLangs, selectionScript, posHint }
  async function lookup(rawQuery, deps) {
    try {
      return await lookupInner(rawQuery, deps);
    } catch (e) {
      if (e && e.rateLimited) return { ok: false, reason: 'rate-limited' };
      throw e;
    }
  }

  async function lookupInner(rawQuery, deps) {
    const d = deps || {};
    const query = QL.morph.normalizeQuery(rawQuery);
    if (!query) return { ok: false, reason: 'empty' };

    const tried = [];
    let payload = null;
    let resolvedWord = query;

    // 1. Literal form, then lowercase, then capitalized. Wiktionary titles are
    //    case-sensitive: "Apple" and "apple" are different pages.
    const caseVariants = [query];
    const lower = query.toLowerCase();
    const capped = query.charAt(0).toUpperCase() + query.slice(1);
    if (lower !== query) caseVariants.push(lower);
    if (capped !== query && capped !== lower) caseVariants.push(capped);

    // The label fetch is fired speculatively alongside the first definition
    // fetch so it costs no extra latency in the common case.
    let labelsPromise = QL.labels.labelsFor(query, d);

    for (const variant of caseVariants) {
      tried.push(variant);
      payload = await fetchWord(variant, d);
      if (payload) { resolvedWord = variant; break; }
    }

    // 2. Still nothing: try de-inflected candidates ("runnings" -> "running").
    if (!payload) {
      for (const cand of QL.morph.baseFormCandidates(query)) {
        tried.push(cand);
        payload = await fetchWord(cand, d);
        if (payload) { resolvedWord = cand; break; }
      }
    }

    if (!payload) return { ok: false, reason: 'not-found', query, tried };

    const sections = parse(payload);
    if (!sections.length) return { ok: false, reason: 'no-definitions', query, tried };

    // If a case or inflection variant won, the speculative label fetch was for
    // the wrong page; redo it for the page we actually landed on.
    if (resolvedWord !== query) labelsPromise = QL.labels.labelsFor(resolvedWord, d);
    QL.labels.applyLabels(sections, await labelsPromise);

    const rankOpts = { posHint: d.posHint, headword: resolvedWord };
    const langs = QL.rank.rankLanguages(
      sections, d.ctx, d.userLangs, d.selectionScript, rankOpts
    );
    const chosen = langs[0];
    let senses = QL.rank.rankSenses(chosen.senses, d.ctx, rankOpts);

    // 3. If the best sense is only a pointer ("plural of goose"), fetch the
    //    lemma and splice its real definitions in ahead of the pointer.
    let lemmaNote = null;
    const pointer = senses.find((s) => s.isFormOf && s.lemma);
    const topIsPointer = senses.length && senses[0].isFormOf;
    if (pointer && (topIsPointer || senses.every((s) => s.isFormOf))) {
      try {
        const lemmaPayload = await fetchWord(pointer.lemma, d);
        if (lemmaPayload) {
          const lemmaSections = parse(lemmaPayload);
          QL.labels.applyLabels(lemmaSections, await QL.labels.labelsFor(pointer.lemma, d));
          const lemmaOpts = { posHint: d.posHint, headword: pointer.lemma };
          const lemmaLangs = QL.rank.rankLanguages(
            lemmaSections, d.ctx, d.userLangs, d.selectionScript, lemmaOpts
          );
          const lemmaSenses = QL.rank
            .rankSenses(lemmaLangs[0].senses, d.ctx, lemmaOpts)
            .filter((s) => !s.isFormOf);
          if (lemmaSenses.length) {
            lemmaNote = { from: resolvedWord, to: pointer.lemma, relation: pointer.text };
            senses = lemmaSenses.concat(senses.filter((s) => !s.isFormOf));
          }
        }
      } catch (e) {
        // A failed lemma lookup is not fatal; keep the pointer sense.
      }
    }

    // Other languages the word also exists in, offered as alternates.
    const otherLangs = langs.slice(1, 4).map((l) => ({
      langCode: l.langCode, langName: l.langName, count: l.senses.length,
    }));

    return {
      ok: true,
      query,
      word: resolvedWord,
      langCode: chosen.langCode,
      langName: chosen.langName,
      isTranslation: chosen.langCode !== 'en'
        && !(d.userLangs || []).includes(chosen.langCode),
      lemmaNote,
      senses: QL.rank.usefulSenses(senses).slice(0, 12),
      otherLangs,
      tried,
    };
  }

  QL.wiktionary = { lookup, parse, buildUrl, fetchWord };
})();
