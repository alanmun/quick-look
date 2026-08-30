// The ranker. This is the part the original extension is missing.
//
// Wiktionary's raw output is unordered with respect to usefulness: "ran" leads
// with an ISO 639-3 language code, "Apple" leads with a nickname for New York
// City, "perro" leads with Chavacano. Every sense is scored here, and the
// highest scorer becomes the card the user sees first. The rest stay available
// behind the arrow keys, in score order.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  // Parts of speech that are almost never what a reader wants when they
  // double-click a word. Scored to the floor rather than deleted, so they can
  // still surface if literally nothing else exists.
  const POS_JUNK = new Set([
    'symbol', 'letter', 'punctuation mark', 'diacritical mark', 'han character',
    'hanzi', 'kanji', 'hanja', 'romanization', 'syllable', 'number',
    'definitions', 'gismu', 'brivla', 'cmavo', 'logogram',
  ]);

  const POS_SCORE = {
    noun: 10, verb: 10, adjective: 9, adverb: 8, 'proper noun': 5,
    interjection: 7, preposition: 6, conjunction: 6, pronoun: 6,
    determiner: 5, numeral: 4, article: 4, particle: 4,
    prefix: 2, suffix: 2, infix: 1, interfix: 1, 'proverb': 6, phrase: 8,
    idiom: 9, abbreviation: 5, acronym: 5, initialism: 5, contraction: 5,
  };

  // Labels marking a sense as not the current, ordinary meaning. Only
  // currency and locality are penalised here.
  //
  // Deliberately absent: colloquial, informal, slang, vulgar, offensive,
  // euphemistic, humorous. Those describe register, not staleness, and they
  // are precisely the senses a reader stops to look up -- penalising them once
  // made "kick the bucket" resolve to "break down" instead of "to die",
  // because "to die" carries a euphemistic label.
  const STALE_LABELS = {
    obsolete: 9, archaic: 7, dated: 4, historical: 3, rare: 4, 'now rare': 6,
    proscribed: 3, nonstandard: 2, dialectal: 3, regional: 2, poetic: 2,
    literary: 1, 'chiefly in compounds': 3, 'many dialects': 2,
  };

  // The mirror image: a reader who stops on a word is more often puzzled by a
  // figurative or idiomatic sense than by the literal compositional reading.
  // This is what lifts "gaslighting" past "illumination by burning gas".
  // Kept strictly to markers of non-literal meaning. "colloquial" and
  // "informal" do not belong here: they lifted the colloquial sense of German
  // "Wasser" (urine) above the primary one (water).
  const FIGURATIVE_LABELS = new Set([
    'figurative', 'figuratively', 'idiomatic', 'idiomatically',
    'metaphorical', 'metaphorically', 'by extension',
  ]);

  function posScore(pos) {
    const key = String(pos || '').toLowerCase().trim();
    if (POS_JUNK.has(key)) return -25;
    if (key in POS_SCORE) return POS_SCORE[key];
    return 5;
  }

  // ---- sense scoring -------------------------------------------------------

  function scoreSense(sense, ctx, opts) {
    const o = opts || {};
    let score = 0;
    const why = [];

    score += posScore(sense.pos);

    // Wiktionary lists senses roughly most-common-first. Preserve that as a
    // decaying prior, but keep it weak enough that one solid context signal
    // can override it -- that override is the whole point of the feature.
    score += Math.max(0, 4 - (sense.senseIndex || 0) * 1.0);
    score += Math.max(0, 4 - (sense.posIndex || 0) * 2);

    const labels = sense.labels || [];
    const topics = (ctx && ctx.topics) || [];
    const glossLower = String(sense.text || '').toLowerCase();

    // Topic match, part one: an explicit label, on the rare occasions the REST
    // endpoint preserves one.
    let topicHits = 0;
    for (const label of labels) {
      if (topics.includes(QL.context.normalizeTopic(label))) topicHits++;
    }
    if (topicHits) {
      score += 14 * topicHits;
      why.push('matches this page’s subject');
    }

    // Topic match, part two, and the one that actually carries the weight: the
    // REST endpoint strips "(computing)" style labels, so match the page's
    // topic vocabulary against the words of the gloss itself.
    const topicWords = ctx && ctx.topicKeywords;
    if (topicWords && topicWords.size) {
      const glossTokens = new Set(glossLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/));
      let kw = 0;
      for (const w of glossTokens) if (topicWords.has(w)) kw++;
      if (kw) {
        score += Math.min(18, kw * 7);
        if (!topicHits) why.push('matches this page’s subject');
      }
    }

    // A sense carrying a topic label that does NOT match the page is mildly
    // suspicious -- a "(nautical)" sense on a cooking blog is probably wrong.
    const hasTopicLabel = labels.some((l) => QL.context.TOPIC_SET.has(l));
    if (hasTopicLabel && !topicHits && topics.length) score -= 4;

    for (const label of labels) {
      if (STALE_LABELS[label]) score -= STALE_LABELS[label];
    }
    if (labels.some((l) => FIGURATIVE_LABELS.has(l))) score += 2.5;

    // Lexical overlap between the gloss and the words surrounding the
    // selection. Cheap, local, and surprisingly effective at picking the right
    // sense of a common polysemous word.
    const nearby = (ctx && ctx.nearby) || [];
    if (nearby.length) {
      const glossWords = new Set(
        String(sense.text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      );
      let overlap = 0;
      for (const w of nearby) if (w.length > 3 && glossWords.has(w)) overlap++;
      if (overlap) {
        score += Math.min(12, overlap * 4);
        why.push('matches nearby wording');
      }
    }

    // Syntactic hint from the preceding words: "to <x>" wants a verb.
    if (o.posHint) {
      const p = String(sense.pos || '').toLowerCase();
      if (p === o.posHint) { score += 6; why.push('fits the sentence'); }
      else if ((o.posHint === 'verb' && p === 'noun') || (o.posHint === 'noun' && p === 'verb')) score -= 3;
    }

    // Pointer entries ("plural of goose") are not definitions. They are
    // resolved upstream; if one survives to here it should rank last.
    if (sense.isFormOf) score -= 12;

    // Lexicographers attach usage examples to the senses that matter. Kept
    // deliberately small: at +4 it outweighed sense order and made the
    // colloquial sense of German "Wasser" (urine) beat the primary one.
    if ((sense.examples || []).length) {
      score += 2;
      why.push('has usage examples');
    }

    // A gloss that merely restates the headword is a loanword stub, not a
    // definition: the French section of "Schadenfreude" reads "schadenfreude
    // (malicious enjoyment...)" while the German section defines it outright.
    const head = String(o.headword || '').toLowerCase().trim();
    if (head && glossLower.replace(/[^a-z]/g, '').startsWith(head.replace(/[^a-z]/g, ''))) {
      score -= 7;
    }

    // Elaborated glosses tend to be the sense a reader is actually looking up;
    // a terse one-liner is more often a secondary or literal reading. Small
    // effect, and deliberately not a penalty for being short -- "To die." is a
    // perfectly good definition of "kick the bucket".
    // Deliberately smaller than the per-sense order step above, so an
    // elaborated gloss can only outrank an earlier one when something else is
    // also in its favour. Otherwise "To break down such that it cannot be
    // repaired" would beat "To die." as the meaning of "kick the bucket".
    const len = String(sense.text || '').trim().length;
    if (len > 90) score += 2;
    else if (len > 40) score += 1;

    return { score, why };
  }

  function rankSenses(senses, ctx, opts) {
    const scored = (senses || []).map((s, i) => {
      const { score, why } = scoreSense(s, ctx, opts);
      return Object.assign({}, s, { _score: score, _why: why, _tie: i });
    });
    scored.sort((a, b) => (b._score - a._score) || (a._tie - b._tie));
    return scored;
  }

  // Decides how many pages the arrows offer.
  //
  // Deliberately an absolute quality bar, not a margin below the winner: a
  // strong context match lifts the top sense far above the rest, and a relative
  // window would then discard the very alternatives the arrows exist to reach.
  // Junk parts of speech score negative and are the only thing dropped here.
  function usefulSenses(ranked) {
    if (!ranked || !ranked.length) return [];
    const keep = ranked.filter((s) => s._score > 0);
    return keep.length ? keep : ranked.slice(0, 1);
  }

  // ---- language-section scoring -------------------------------------------

  // Picks which of Wiktionary's language sections to show. Handles the case
  // that motivated it: "Wasser" has an English section reading "a surname" and
  // a German section reading "water", and on a German page you want German.
  function scoreLanguage(section, ctx, userLangs, selectionScript, opts) {
    const code = section.langCode;
    const o = opts || {};
    let score = 0;
    const why = [];

    // The page's own declared language is the single best clue.
    if (ctx && ctx.pageLang && code === ctx.pageLang) {
      score += 30;
      why.push('this page is in ' + section.langName);
    }

    // Non-Latin script in the selection is decisive evidence about which
    // language it belongs to.
    if (selectionScript && selectionScript.code === code) score += 25;

    // Prefer the reader's own languages, but only mildly -- the whole point of
    // translation mode is to show a language that is NOT theirs.
    const userIdx = (userLangs || []).indexOf(code);
    if (userIdx >= 0) score += Math.max(4, 12 - userIdx * 3);

    // English is the default assumption for Latin-script text on an English
    // page, and our glosses are English anyway.
    if (code === 'en') score += 8;

    // Speaker-population tie-break: Spanish over Chavacano, German over
    // Pennsylvania German.
    score += Math.max(0, 14 - QL.langs.priorRank(code) * 0.35);

    // A section whose only senses are junk parts of speech ("Wasser" ->
    // English -> "a surname") should lose to a section with real content.
    const senses = section.senses || [];
    const best = senses.reduce((m, s) => Math.max(m, posScore(s.pos)), -99);
    if (best <= 0) score -= 18;
    if (!senses.length) score -= 40;

    // Sections whose every gloss just restates the headword are loanword
    // stubs. This is what separates German "Wasser: water (H2O)" from a French
    // entry that only says "schadenfreude (...)".
    const head = String(o.headword || '').toLowerCase().replace(/[^a-z]/g, '');
    if (head && senses.length) {
      const echoes = senses.filter((s) =>
        String(s.text || '').toLowerCase().replace(/[^a-z]/g, '').startsWith(head)
      ).length;
      if (echoes === senses.length) score -= 9;
    }

    // A section that defines the word many different ways is more likely the
    // language the word genuinely belongs to.
    score += Math.min(4, senses.length * 0.5);

    return { score, why };
  }

  function rankLanguages(sections, ctx, userLangs, selectionScript, opts) {
    const scored = (sections || []).map((sec, i) => {
      const { score, why } = scoreLanguage(sec, ctx, userLangs, selectionScript, opts);
      return Object.assign({}, sec, { _score: score, _why: why, _tie: i });
    });
    scored.sort((a, b) => (b._score - a._score) || (a._tie - b._tie));
    return scored;
  }

  QL.rank = {
    rankSenses, rankLanguages, usefulSenses,
    scoreSense, scoreLanguage, posScore, POS_JUNK,
  };
})();
