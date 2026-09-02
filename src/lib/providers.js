// Optional LLM layer: plain-English explanation of a whole sentence.
//
// Everything here is inert until the user turns it on. The extension ships with
// no LLM host in `host_permissions` at all -- the host is an *optional*
// permission requested at the moment you connect a provider, so before that
// point the extension is technically incapable of reaching one.
//
// OpenRouter is the headline path because its OAuth PKCE flow needs no client
// secret and accepts any callback URL, which matters for extensions: Firefox's
// redirect URL is per-installation and cannot be pre-registered anywhere.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const OPENROUTER = {
    id: 'openrouter',
    label: 'OpenRouter',
    authUrl: 'https://openrouter.ai/auth',
    keyUrl: 'https://openrouter.ai/api/v1/auth/keys',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    origin: 'https://openrouter.ai/*',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  };

  // Anthropic speaks its own Messages API rather than the OpenAI chat shape, so
  // it gets its own request and response handling below. Calling it straight
  // from a browser context also needs an explicit opt-in header -- without it
  // the preflight is refused.
  const ANTHROPIC = {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    origin: 'https://api.anthropic.com/*',
    version: '2023-06-01',
    defaultModel: 'claude-opus-5',
  };

  // ---- PKCE ---------------------------------------------------------------

  function base64url(bytes) {
    let binary = '';
    for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function createVerifier() {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(digest);
  }

  // ---- permissions --------------------------------------------------------

  async function ensureHostPermission(origin) {
    const api = QL.api;
    if (!api || !api.permissions) return false;
    const has = await api.permissions.contains({ origins: [origin] });
    if (has) return true;
    // Must be called from a user gesture; the options page invokes this
    // directly from the click handler.
    return api.permissions.request({ origins: [origin] });
  }

  async function dropHostPermission(origin) {
    const api = QL.api;
    if (!api || !api.permissions) return;
    try { await api.permissions.remove({ origins: [origin] }); } catch (e) { /* ignore */ }
  }

  // ---- OpenRouter sign-in -------------------------------------------------

  // Returns a user-scoped OpenRouter API key. The user signs in on
  // openrouter.ai; we never see a password, and no client secret exists.
  async function connectOpenRouter() {
    const api = QL.api;
    if (!api || !api.identity) throw new Error('This browser has no identity API for sign-in.');

    const granted = await ensureHostPermission(OPENROUTER.origin);
    if (!granted) throw new Error('Permission to reach openrouter.ai was declined.');

    const redirectUri = api.identity.getRedirectURL();
    const verifier = createVerifier();
    const challenge = await challengeFor(verifier);

    const authUrl = OPENROUTER.authUrl
      + '?callback_url=' + encodeURIComponent(redirectUri)
      + '&code_challenge=' + encodeURIComponent(challenge)
      + '&code_challenge_method=S256';

    const redirect = await api.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    if (!redirect) throw new Error('Sign-in was cancelled.');

    const code = new URL(redirect).searchParams.get('code');
    if (!code) throw new Error('No authorization code came back from OpenRouter.');

    const res = await fetch(OPENROUTER.keyUrl, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    });
    if (!res.ok) throw new Error('OpenRouter rejected the code exchange (' + res.status + ').');
    const json = await res.json();
    if (!json || !json.key) throw new Error('OpenRouter returned no key.');

    return { provider: 'openrouter', key: json.key, connectedAt: Date.now() };
  }

  // ---- explanation --------------------------------------------------------

  const SYSTEM_PROMPT =
    'You explain text for a reader who did not understand it. Reply with one '
    + 'short paragraph of plain English, at most three sentences. Do not '
    + 'preface your answer, do not repeat the original text, and do not add '
    + 'commentary about the request itself. If the text is in another '
    + 'language, translate it and say which language it was.';

  function endpointFor(settings) {
    if (settings.llmProvider === 'openrouter') {
      return {
        kind: 'openai',
        url: OPENROUTER.chatUrl,
        model: settings.llmModel || OPENROUTER.defaultModel,
      };
    }
    if (settings.llmProvider === 'anthropic') {
      const base = String(settings.llmBaseUrl || ANTHROPIC.baseUrl).replace(/\/+$/, '');
      return {
        kind: 'anthropic',
        url: base + '/messages',
        model: settings.llmModel || ANTHROPIC.defaultModel,
      };
    }
    const base = String(settings.llmBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('No API base URL is configured.');
    return {
      kind: 'openai',
      url: base + '/chat/completions',
      model: settings.llmModel || 'gpt-4o-mini',
    };
  }

  // The two wire formats differ in three places -- auth header, request body,
  // and where the text lives in the response -- so each is described once here
  // and `explain` stays shape-agnostic.
  function requestFor(kind, model, key, userContent) {
    if (kind === 'anthropic') {
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC.version,
          // Anthropic blocks browser-origin calls unless the caller opts in.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model,
          // Current Claude models think by default, and thinking tokens count
          // against max_tokens -- so leave room, and ask for the least thinking
          // the job needs. A three-sentence gloss needs very little.
          max_tokens: 1024,
          output_config: { effort: 'low' },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        },
      };
    }
    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: {
        model,
        max_tokens: 300,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      },
    };
  }

  function textFrom(kind, json) {
    if (kind === 'anthropic') {
      // A response carries thinking blocks alongside the answer; only the text
      // blocks are the answer.
      const blocks = (json && Array.isArray(json.content)) ? json.content : [];
      return blocks
        .filter((b) => b && b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n')
        .trim();
    }
    return (json && json.choices && json.choices[0]
      && json.choices[0].message && json.choices[0].message.content) || '';
  }

  // `text` is the selection. `context` is the surrounding sentence and is only
  // included when the user has explicitly opted into sending it.
  async function explain(text, settings, credential, context) {
    if (!settings.llmEnabled) throw new Error('Explanation is turned off.');
    if (!credential || !credential.key) throw new Error('No provider is connected.');

    const { kind, url, model } = endpointFor(settings);
    const userContent = settings.llmSendContext && context
      ? 'Text to explain:\n' + text + '\n\nIt appears in this context:\n' + context
      : 'Text to explain:\n' + text;

    const { headers, body } = requestFor(kind, model, credential.key, userContent);

    const res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(20000),
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('The connected provider rejected the credential. Reconnect in settings.');
    }
    if (res.status === 429) throw new Error('Rate limited by the provider. Try again shortly.');
    if (!res.ok) throw new Error('Provider error (' + res.status + ').');

    const json = await res.json();

    // Claude can decline a request without erroring: HTTP 200, no text blocks.
    if (kind === 'anthropic' && json && json.stop_reason === 'refusal') {
      throw new Error('The model declined to explain that text.');
    }

    const content = textFrom(kind, json);
    if (!content) throw new Error('The provider returned an empty response.');
    return QL.sanitize.clamp(String(content).trim(), 900);
  }

  QL.providers = {
    OPENROUTER, ANTHROPIC, connectOpenRouter, explain, endpointFor,
    ensureHostPermission, dropHostPermission, createVerifier, challengeFor,
  };
})();
