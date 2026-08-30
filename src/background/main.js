// Background entry point.
//
// This is the ONLY place in the extension that touches the network. Content
// scripts never fetch: they hand over a selection and receive a rendered
// result. That boundary is deliberate --
//
//   * the page cannot observe the lookup (no request originates in its context,
//     nothing appears in its performance entries, no CORS preflight it can see)
//   * page script cannot reach the credential, which never leaves this file's
//     reach and is never included in a message to a tab
//   * the surrounding text used for context scoring is consumed here and
//     discarded; it is never transmitted anywhere
(function () {
  const QL = globalThis.QL;
  const api = QL.api;

  const jsonCache = QL.cache.createCache({ maxEntries: 400, ttlMs: 60 * 60 * 1000 });

  let cachedUserLangs = null;
  async function userLangs() {
    if (!cachedUserLangs) cachedUserLangs = await QL.langs.userLanguages(api);
    return cachedUserLangs;
  }

  function deps() {
    return { fetchImpl: (...args) => fetch(...args), jsonCache };
  }

  // ---- one headword -------------------------------------------------------

  async function lookupTerm(term, ctx, opts) {
    return QL.wiktionary.lookup(term, Object.assign(deps(), {
      ctx,
      userLangs: await userLangs(),
      posHint: opts && opts.posHint,
      selectionScript: QL.langs.detectScript(term),
    }));
  }

  // ---- a selection --------------------------------------------------------

  async function handleLookup(payload) {
    const settings = await QL.settings.getAll();
    if (!settings.enabled) return { ok: false, reason: 'disabled' };

    const page = (payload && payload.page) || {};
    if (QL.settings.hostDisabled(settings, page.hostname)) {
      return { ok: false, reason: 'host-disabled' };
    }

    const shape = QL.analyze.classify(payload && payload.text);
    if (shape.kind === 'empty') return { ok: false, reason: 'empty' };

    // Context is built here and stays here.
    const ctx = settings.useContextClues
      ? QL.context.build(page)
      : QL.context.build({ pageLang: page.pageLang });
    const posHint = settings.useContextClues ? QL.context.posHint(page.before) : null;

    if (shape.kind === 'word') {
      const result = await lookupTerm(shape.text, ctx, { posHint });
      return { ok: result.ok, kind: 'word', query: shape.text, result, settings: publicSettings(settings) };
    }

    if (shape.kind === 'phrase') {
      // Try the phrase as a unit first: idioms have their own entries.
      const asUnit = await lookupTerm(shape.text, ctx, { posHint });
      if (asUnit.ok) {
        return { ok: true, kind: 'phrase', query: shape.text, result: asUnit, settings: publicSettings(settings) };
      }
      const terms = QL.analyze.hardTerms(shape.text, { limit: 4 });
      const parts = await lookupParts(terms.length ? terms : shape.words.map((w) => ({ term: w })), ctx, posHint);
      return {
        ok: parts.length > 0, kind: 'passage', query: shape.text,
        parts, settings: publicSettings(settings),
      };
    }

    if (!settings.passageMode) {
      return { ok: false, reason: 'passage-mode-off', kind: 'passage', query: shape.text };
    }

    const terms = QL.analyze.hardTerms(shape.text, { limit: QL.analyze.MAX_TERMS });
    const parts = await lookupParts(terms, ctx, posHint);
    return {
      ok: parts.length > 0,
      kind: 'passage',
      query: shape.text,
      truncated: shape.kind === 'too-long',
      parts,
      settings: publicSettings(settings),
    };
  }

  async function lookupParts(terms, ctx, posHint) {
    const results = await QL.analyze.mapLimited(terms, 3, async (t) => {
      const r = await lookupTerm(t.term, ctx, { posHint });
      return r.ok ? { term: t.term, result: r } : null;
    });
    return results.filter(Boolean);
  }

  // Only the settings the content script legitimately needs to render.
  // Notably absent: anything credential-shaped.
  function publicSettings(s) {
    return {
      showExamples: s.showExamples,
      llmEnabled: s.llmEnabled,
      autoTranslate: s.autoTranslate,
    };
  }

  // ---- optional explanation ----------------------------------------------

  async function handleExplain(payload) {
    const settings = await QL.settings.getAll();
    if (!settings.llmEnabled) return { ok: false, error: 'Explanation is turned off.' };

    const credential = await QL.settings.getCredential();
    if (!credential) return { ok: false, error: 'No provider connected.' };

    const text = QL.sanitize.clamp(String((payload && payload.text) || ''), 4000);
    if (!text) return { ok: false, error: 'Nothing to explain.' };

    try {
      const context = settings.llmSendContext ? (payload && payload.context) || '' : '';
      const answer = await QL.providers.explain(text, settings, credential, context);
      return { ok: true, answer };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : 'Explanation failed.' };
    }
  }

  // ---- routing ------------------------------------------------------------

  const ROUTES = {
    lookup: handleLookup,
    explain: handleExplain,
    ping: async () => ({ ok: true }),
    getSettings: async () => ({ ok: true, settings: await QL.settings.getAll() }),
    setSettings: async (p) => ({ ok: true, settings: await QL.settings.set(p && p.patch) }),
    clearCache: async () => { jsonCache.clear(); return { ok: true }; },
    connectProvider: async () => {
      try {
        const credential = await QL.providers.connectOpenRouter();
        await QL.settings.setCredential(credential);
        await QL.settings.set({ llmEnabled: true, llmProvider: 'openrouter' });
        return { ok: true, connectedAt: credential.connectedAt };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : 'Sign-in failed.' };
      }
    },
    setManualKey: async (p) => {
      const key = String((p && p.key) || '').trim();
      if (!key) return { ok: false, error: 'No key supplied.' };
      await QL.settings.setCredential({ provider: 'openai-compatible', key, connectedAt: Date.now() });
      return { ok: true };
    },
    disconnectProvider: async () => {
      await QL.settings.setCredential(null);
      await QL.settings.set({ llmEnabled: false });
      await QL.providers.dropHostPermission(QL.providers.OPENROUTER.origin);
      return { ok: true };
    },
    providerStatus: async () => {
      const credential = await QL.settings.getCredential();
      return {
        ok: true,
        connected: Boolean(credential),
        provider: credential && credential.provider,
        connectedAt: credential && credential.connectedAt,
      };
    },
  };

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = message && ROUTES[message.type];
    if (!handler) return false;

    // Messages must come from our own extension. A page cannot reach this
    // listener directly (no externally_connectable is declared), but content
    // scripts are the only legitimate senders and this keeps it explicit.
    if (sender && sender.id && sender.id !== api.runtime.id) return false;

    Promise.resolve(handler(message.payload, sender))
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // keep the channel open for the async response
  });

  // Keyboard shortcut: look up the current selection without a double-click.
  if (api.commands && api.commands.onCommand) {
    api.commands.onCommand.addListener(async (command) => {
      if (command !== 'lookup-selection') return;
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) {
        try {
          await api.tabs.sendMessage(tabs[0].id, { type: 'lookupSelection' });
        } catch (e) { /* no content script on this page */ }
      }
    });
  }
})();
