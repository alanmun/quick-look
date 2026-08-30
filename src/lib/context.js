// Local-only context analysis.
//
// PRIVACY: everything in this file runs in the background script against data
// the content script gathered from the page. None of it is ever transmitted.
// Only the bare headword goes to Wiktionary. The surrounding sentence, the page
// title, and the domain stay on this machine.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  // Maps a site to the topic labels Wiktionary itself uses in sense glosses --
  // "(law)", "(computing)", "(medicine)". When you double-click "consideration"
  // on a court opinion, the contract-law sense should win.
  const DOMAIN_TOPICS = [
    [/(^|\.)(law\.cornell\.edu|courtlistener\.com|justia\.com|casetext\.com|oyez\.org|supremecourt\.gov)$/, ['law', 'legal']],
    [/(^|\.)(uscourts\.gov|findlaw\.com|lexisnexis\.com|westlaw\.com)$/, ['law', 'legal']],
    [/(^|\.)(github\.com|gitlab\.com|stackoverflow\.com|stackexchange\.com|npmjs\.com)$/, ['computing', 'programming', 'internet']],
    [/(^|\.)(developer\.mozilla\.org|docs\.python\.org|rust-lang\.org|kernel\.org|news\.ycombinator\.com)$/, ['computing', 'programming']],
    [/(^|\.)(pubmed\.ncbi\.nlm\.nih\.gov|nih\.gov|webmd\.com|mayoclinic\.org|nejm\.org|thelancet\.com)$/, ['medicine', 'anatomy', 'pathology']],
    [/(^|\.)(investopedia\.com|bloomberg\.com|wsj\.com|ft\.com|marketwatch\.com|sec\.gov|nasdaq\.com)$/, ['finance', 'economics', 'business', 'accounting']],
    [/(^|\.)(arxiv\.org|nature\.com|sciencedirect\.com|science\.org|springer\.com)$/, ['sciences', 'physics', 'biology', 'chemistry']],
    [/(^|\.)(espn\.com|bleacherreport\.com|skysports\.com)$/, ['sports', 'baseball', 'football', 'cricket']],
    [/(^|\.)(allrecipes\.com|seriouseats\.com|bonappetit\.com|epicurious\.com)$/, ['cooking', 'food']],
    [/(^|\.)(militarytimes\.com|defense\.gov|janes\.com)$/, ['military', 'nautical']],
    [/(^|\.)(imslp\.org|allmusic\.com|pitchfork\.com)$/, ['music']],
    [/(^|\.)(sailingmagazine\.net|boatus\.com)$/, ['nautical']],
  ];

  const TLD_TOPICS = [
    [/\.mil$/, ['military']],
    [/\.gov$/, ['law', 'government', 'politics']],
    [/\.edu$/, ['academia', 'education']],
  ];

  // The Wiktionary label vocabulary we are willing to match against. Keeping
  // this closed avoids matching noise words in a page title.
  const TOPIC_VOCAB = [
    'law', 'legal', 'medicine', 'anatomy', 'pathology', 'pharmacology',
    'computing', 'programming', 'internet', 'networking', 'mathematics',
    'physics', 'chemistry', 'biology', 'botany', 'zoology', 'ecology',
    'finance', 'economics', 'business', 'accounting', 'marketing',
    'military', 'nautical', 'aviation', 'music', 'sports', 'baseball',
    'football', 'cricket', 'chess', 'cooking', 'food', 'linguistics',
    'grammar', 'philosophy', 'psychology', 'religion', 'politics',
    'architecture', 'engineering', 'geology', 'astronomy', 'statistics',
    'literature', 'poetry', 'theater', 'art', 'photography', 'typography',
    'mining', 'agriculture', 'sewing', 'knitting', 'card games', 'gaming',
  ];

  const TOPIC_SET = new Set(TOPIC_VOCAB);

  // Several vocabulary labels mean the same thing for our purposes.
  const TOPIC_ALIAS = {
    legal: 'law', programming: 'computing', internet: 'computing',
    networking: 'computing', anatomy: 'medicine', pathology: 'medicine',
    pharmacology: 'medicine', economics: 'finance', business: 'finance',
    accounting: 'finance', marketing: 'finance', botany: 'biology',
    zoology: 'biology', ecology: 'biology', government: 'politics',
    grammar: 'linguistics', baseball: 'sports', football: 'sports',
    cricket: 'sports', gaming: 'sports', food: 'cooking',
    academia: 'sciences', education: 'sciences',
  };

  function normalizeTopic(t) {
    return TOPIC_ALIAS[t] || t;
  }

  // The REST definition endpoint STRIPS Wiktionary's "(computing)" style topic
  // labels from the gloss -- the computing sense of "daemon" arrives as plain
  // "A process (a running program) that does not have a controlling terminal."
  // So topic matching cannot rely on labels. Instead each topic carries
  // indicator words that show up in a gloss written about that topic, and we
  // score the gloss text directly.
  const TOPIC_KEYWORDS = {
    computing: ['process', 'program', 'software', 'computer', 'data', 'file',
      'memory', 'network', 'server', 'code', 'algorithm', 'terminal', 'database',
      'byte', 'protocol', 'internet', 'application', 'hardware', 'compile',
      'execute', 'runtime', 'variable', 'function', 'buffer', 'thread', 'disk'],
    law: ['court', 'legal', 'contract', 'statute', 'judge', 'jury', 'plaintiff',
      'defendant', 'lawsuit', 'liability', 'jurisdiction', 'tort', 'plea',
      'testimony', 'evidence', 'appeal', 'judicial', 'obligation', 'binding',
      'clause', 'law', 'attorney', 'prosecution', 'verdict', 'damages'],
    medicine: ['disease', 'patient', 'symptom', 'treatment', 'diagnosis',
      'infection', 'tissue', 'organ', 'blood', 'therapy', 'clinical', 'medical',
      'syndrome', 'tumor', 'chronic', 'acute', 'muscle', 'nerve', 'surgical'],
    finance: ['money', 'capital', 'stock', 'market', 'investment', 'bond',
      'asset', 'debt', 'interest', 'currency', 'profit', 'revenue', 'loan',
      'equity', 'dividend', 'bank', 'price', 'trade', 'payment', 'financial'],
    music: ['note', 'chord', 'pitch', 'scale', 'melody', 'rhythm', 'instrument',
      'tempo', 'harmony', 'octave', 'musical', 'tune', 'song', 'sung'],
    nautical: ['ship', 'vessel', 'sail', 'mast', 'deck', 'boat', 'nautical',
      'anchor', 'crew', 'harbor', 'hull', 'rigging', 'stern', 'bow'],
    military: ['army', 'soldier', 'troop', 'weapon', 'combat', 'military',
      'battle', 'artillery', 'enemy', 'regiment', 'infantry', 'garrison'],
    biology: ['species', 'genus', 'plant', 'animal', 'organism', 'cell', 'leaf',
      'flower', 'bird', 'fish', 'insect', 'mammal', 'tree', 'family', 'breed'],
    chemistry: ['element', 'compound', 'molecule', 'acid', 'atom', 'chemical',
      'reaction', 'solution', 'oxide', 'salt'],
    physics: ['force', 'energy', 'particle', 'mass', 'wave', 'quantum',
      'velocity', 'field', 'matter', 'radiation', 'momentum'],
    mathematics: ['number', 'function', 'equation', 'theorem', 'integer',
      'matrix', 'vector', 'geometry', 'algebraic', 'value', 'set', 'curve'],
    sports: ['game', 'player', 'team', 'ball', 'score', 'match', 'play',
      'field', 'point', 'race', 'goal', 'inning', 'referee'],
    cooking: ['food', 'dish', 'cook', 'sauce', 'bake', 'flavor', 'ingredient',
      'meat', 'recipe', 'eaten', 'boiled', 'seasoning'],
    psychology: ['behavior', 'mind', 'mental', 'perception', 'emotion',
      'cognitive', 'psychological', 'manipulation', 'trauma', 'anxiety'],
    politics: ['government', 'state', 'political', 'election', 'party',
      'policy', 'vote', 'public', 'official', 'parliament', 'legislature'],
    linguistics: ['word', 'sentence', 'verb', 'noun', 'language', 'phrase',
      'meaning', 'clause', 'syllable', 'phoneme', 'grammatical', 'adjective'],
    sciences: ['theory', 'experiment', 'research', 'measurement', 'scientific'],
    religion: ['god', 'church', 'divine', 'sacred', 'prayer', 'faith', 'holy',
      'ritual', 'scripture', 'worship'],
  };

  function keywordsForTopics(topics) {
    const set = new Set();
    for (const t of topics || []) {
      const words = TOPIC_KEYWORDS[normalizeTopic(t)];
      if (words) for (const w of words) set.add(w);
    }
    return set;
  }

  function topicsForHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    const found = [];
    for (const [re, topics] of DOMAIN_TOPICS) {
      if (re.test(host)) found.push(...topics);
    }
    for (const [re, topics] of TLD_TOPICS) {
      if (re.test(host)) found.push(...topics);
    }
    // A bare domain word can itself be a topic: "chess.com" -> chess.
    for (const part of host.split(/[.\-]/)) {
      if (TOPIC_SET.has(part)) found.push(part);
    }
    return [...new Set(found)];
  }

  const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
    'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
    'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them',
    'his', 'her', 'their', 'you', 'your', 'we', 'our', 'i', 'not', 'no',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
    'should', 'may', 'might', 'must', 'shall', 'there', 'here', 'what', 'which',
    'who', 'when', 'where', 'how', 'why', 'all', 'any', 'some', 'more', 'most',
    'other', 'into', 'than', 'then', 'so', 'if', 'about', 'up', 'out', 'over',
  ]);

  function contentWords(text, limit) {
    const words = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
    return [...new Set(words)].slice(0, limit || 60);
  }

  // Builds the local context bundle used to score senses. `page` is what the
  // content script collected: hostname, title, lang attribute, and the text
  // immediately before and after the selection.
  function build(page) {
    const p = page || {};
    const before = String(p.before || '');
    const after = String(p.after || '');
    const topics = topicsForHost(p.hostname);

    // Title words that happen to be topic labels are strong evidence too.
    for (const w of contentWords(p.title, 30)) {
      if (TOPIC_SET.has(w)) topics.push(w);
    }

    const uniqueTopics = [...new Set(topics.map(normalizeTopic))];

    return {
      hostname: String(p.hostname || ''),
      pageLang: QL.langs ? QL.langs.baseCode(p.pageLang) : '',
      topics: uniqueTopics,
      topicKeywords: keywordsForTopics(uniqueTopics),
      // Nearby words carry the most weight; title words are weaker background.
      nearby: contentWords(before + ' ' + after, 40),
      titleWords: contentWords(p.title, 20),
      before,
      after,
    };
  }

  // Cheap syntactic part-of-speech hint from the words immediately preceding
  // the selection. "to <x>" implies a verb; "the/a/an <x>" implies a noun.
  // Wrong sometimes, but it costs nothing and breaks a lot of ties correctly.
  function posHint(before) {
    const tail = String(before || '').toLowerCase().trim().split(/\s+/).slice(-3);
    if (!tail.length) return null;
    const last = tail[tail.length - 1];
    if (last === 'to') return 'verb';
    if (['the', 'a', 'an', 'this', 'that', 'his', 'her', 'their', 'my', 'its'].includes(last)) return 'noun';
    if (['very', 'quite', 'so', 'too', 'more', 'less', 'extremely'].includes(last)) return 'adjective';
    if (['is', 'are', 'was', 'were', 'be', 'been', 'being'].includes(last)) return 'adjective';
    if (['has', 'have', 'had'].includes(last)) return 'verb';
    return null;
  }

  QL.context = {
    build, topicsForHost, contentWords, posHint,
    keywordsForTopics, normalizeTopic, TOPIC_SET, TOPIC_KEYWORDS,
  };
})();
