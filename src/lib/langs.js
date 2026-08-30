// Language identification and ranking for Wiktionary's language-keyed sections.
//
// The English Wiktionary returns one section per language that spells the word,
// and every section's glosses are written in English. That gives us translation
// for free -- the German section of "Wasser" reads "water (H2O)" -- but the
// sections arrive in no useful order: "perro" lists Chavacano first and Spanish
// fourth. Everything here exists to pick the right section.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  // Rough speaker-population ordering. Used only as a tie-breaker so that a
  // major language beats a regional one absent any other signal -- this is what
  // stops "perro" resolving to Chavacano instead of Spanish.
  const PRIOR = [
    'en', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'ur',
    'id', 'de', 'ja', 'sw', 'mr', 'te', 'tr', 'ta', 'vi', 'ko',
    'it', 'th', 'gu', 'fa', 'pl', 'uk', 'ml', 'kn', 'nl', 'he',
    'el', 'sv', 'cs', 'ro', 'hu', 'da', 'fi', 'no', 'nb', 'sk',
    'bg', 'hr', 'sr', 'lt', 'lv', 'et', 'sl', 'ca', 'eu', 'gl',
    'la', 'grc', 'ang', 'is', 'ga', 'cy', 'af', 'ms', 'tl', 'ha',
  ];

  const PRIOR_RANK = new Map(PRIOR.map((code, i) => [code, i]));

  const DISPLAY_NAMES = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', pl: 'Polish', uk: 'Ukrainian',
    ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ar: 'Arabic', he: 'Hebrew',
    hi: 'Hindi', bn: 'Bengali', tr: 'Turkish', sv: 'Swedish', da: 'Danish',
    no: 'Norwegian', nb: 'Norwegian', fi: 'Finnish', el: 'Greek', cs: 'Czech',
    ro: 'Romanian', hu: 'Hungarian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
    la: 'Latin', grc: 'Ancient Greek', fa: 'Persian', ca: 'Catalan',
  };

  // "en-US" / "EN_us" -> "en". Wiktionary keys are bare ISO codes.
  function baseCode(tag) {
    if (typeof tag !== 'string') return '';
    return tag.toLowerCase().replace(/_/g, '-').split('-')[0];
  }

  function displayName(code, fallback) {
    return DISPLAY_NAMES[code] || fallback || code;
  }

  // Resolves the user's preferred languages without ever asking them.
  // browser.i18n.getAcceptLanguages() is the full Accept-Language list;
  // getUILanguage() is the browser's own UI locale. We union them, in order,
  // and always keep English as a terminal fallback since our glosses are English.
  async function userLanguages(runtime) {
    const out = [];
    const push = (tag) => {
      const code = baseCode(tag);
      if (code && !out.includes(code)) out.push(code);
    };
    try {
      if (runtime && runtime.i18n && runtime.i18n.getAcceptLanguages) {
        const accepted = await runtime.i18n.getAcceptLanguages();
        (accepted || []).forEach(push);
      }
      if (runtime && runtime.i18n && runtime.i18n.getUILanguage) {
        push(runtime.i18n.getUILanguage());
      }
    } catch (e) {
      // i18n is unavailable in some contexts; fall through to navigator.
    }
    if (typeof navigator !== 'undefined') {
      (navigator.languages || []).forEach(push);
      push(navigator.language);
    }
    if (!out.length) out.push('en');
    return out;
  }

  // Script detection. Definitive for non-Latin scripts: if the selection is in
  // Cyrillic, the user is not reading their own language unless they read
  // Russian. Latin-script languages are left to Wiktionary's own sections.
  const SCRIPTS = [
    { code: 'ru', name: 'Cyrillic', re: /[Ѐ-ӿ]/ },
    { code: 'el', name: 'Greek', re: /[Ͱ-Ͽἀ-῿]/ },
    { code: 'he', name: 'Hebrew', re: /[֐-׿]/ },
    { code: 'ar', name: 'Arabic', re: /[؀-ۿݐ-ݿ]/ },
    { code: 'hi', name: 'Devanagari', re: /[ऀ-ॿ]/ },
    { code: 'th', name: 'Thai', re: /[฀-๿]/ },
    { code: 'ko', name: 'Hangul', re: /[가-힯ᄀ-ᇿ]/ },
    { code: 'ja', name: 'Kana', re: /[぀-ゟ゠-ヿ]/ },
    { code: 'zh', name: 'Han', re: /[一-鿿]/ },
  ];

  function detectScript(text) {
    if (typeof text !== 'string') return null;
    for (const s of SCRIPTS) if (s.re.test(text)) return s;
    return null;
  }

  // True when the text is plain ASCII-ish Latin with no diacritics, i.e. gives
  // us no script-level evidence either way.
  function isPlainLatin(text) {
    return /^[\x20-\x7E]*$/.test(String(text || ''));
  }

  QL.langs = {
    baseCode, displayName, userLanguages, detectScript, isPlainLatin,
    priorRank: (code) => (PRIOR_RANK.has(code) ? PRIOR_RANK.get(code) : PRIOR.length + 50),
    PRIOR_SIZE: PRIOR.length,
  };
})();
