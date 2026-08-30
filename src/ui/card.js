// Card rendering.
//
// Every piece of text that came from the network is written with textContent.
// There is no innerHTML anywhere in this file, and no string is ever parsed as
// markup, so a hostile dictionary payload has no path to script execution.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function posLabel(sense) {
    return String(sense.pos || '').toLowerCase();
  }

  // ---- states -------------------------------------------------------------

  function renderLoading(root, query) {
    const card = el('div', 'card');
    const state = el('div', 'state');
    state.appendChild(el('span', 'spinner'));
    state.appendChild(document.createTextNode('Looking up ' + QL.sanitize.clamp(query, 40) + '…'));
    card.appendChild(state);
    root.replaceChildren(card);
    return card;
  }

  function renderMessage(root, message, isError) {
    const card = el('div', 'card');
    card.appendChild(el('div', 'state' + (isError ? ' error' : ''), message));
    root.replaceChildren(card);
    return card;
  }

  // ---- a single word ------------------------------------------------------

  function renderWord(root, state, handlers) {
    const result = state.result;
    const senses = result.senses || [];
    const index = Math.min(state.index || 0, Math.max(0, senses.length - 1));
    const sense = senses[index];

    const card = el('div', 'card');

    const head = el('div', 'head');
    head.appendChild(el('span', 'word', result.word || result.query));

    if (senses.length > 1) {
      const pager = el('div', 'pager');
      const prev = el('button', null, '‹');
      prev.title = 'Previous sense (Left arrow)';
      prev.setAttribute('aria-label', 'Previous sense');
      prev.disabled = index === 0;
      prev.addEventListener('click', (e) => { e.stopPropagation(); handlers.go(index - 1); });

      const next = el('button', null, '›');
      next.title = 'Next sense (Right arrow)';
      next.setAttribute('aria-label', 'Next sense');
      next.disabled = index === senses.length - 1;
      next.addEventListener('click', (e) => { e.stopPropagation(); handlers.go(index + 1); });

      pager.appendChild(prev);
      pager.appendChild(el('span', 'count', (index + 1) + '/' + senses.length));
      pager.appendChild(next);
      head.appendChild(pager);
    }
    card.appendChild(head);

    const sub = el('div', 'sub');
    if (sense && posLabel(sense)) sub.appendChild(el('span', 'pos', posLabel(sense)));

    if (result.isTranslation) {
      sub.appendChild(el('span', 'chip translate', result.langName + ' → English'));
    } else if (result.langCode !== 'en') {
      sub.appendChild(el('span', 'chip', result.langName));
    }

    if (result.lemmaNote) {
      sub.appendChild(el('span', 'chip', result.lemmaNote.from + ' → ' + result.lemmaNote.to));
    }

    // Register and topic labels, e.g. "computing", "archaic". Capped: merging
    // wikitext labels can produce a long tail that would wrap the header.
    for (const label of ((sense && sense.labels) || []).slice(0, 3)) {
      sub.appendChild(el('span', 'chip', label));
    }
    if (sub.childNodes.length) card.appendChild(sub);

    const body = el('div', 'body');
    body.appendChild(el('p', 'def', sense ? sense.text : 'No definition found.'));

    if (state.showExamples && sense && (sense.examples || []).length) {
      body.appendChild(el('p', 'example', sense.examples[0]));
    }

    if (sense && (sense._why || []).length) {
      body.appendChild(el('div', 'why', sense._why[0]));
    }

    if (state.explanation) {
      const box = el('div', 'explain');
      box.appendChild(el('div', 'label', 'In plain English'));
      box.appendChild(el('p', null, state.explanation));
      body.appendChild(box);
    } else if (state.explaining) {
      const box = el('div', 'explain');
      const line = el('p', null);
      line.appendChild(el('span', 'spinner'));
      line.appendChild(document.createTextNode('Explaining…'));
      box.appendChild(line);
      body.appendChild(box);
    } else if (state.explainError) {
      const box = el('div', 'explain');
      box.appendChild(el('p', 'state error', state.explainError));
      body.appendChild(box);
    }

    card.appendChild(body);

    // Footer holds at most two things: the explain action and the paging hint.
    // Built explicitly so neither can be duplicated or rendered empty.
    const foot = el('div', 'foot');
    const canExplain = state.llmEnabled && !state.explanation && !state.explaining;
    if (canExplain) {
      const btn = el('button', 'action', 'Explain in plain English');
      btn.addEventListener('click', (e) => { e.stopPropagation(); handlers.explain(); });
      foot.appendChild(btn);
    }
    if (senses.length > 1) {
      foot.appendChild(el('span', 'hint', canExplain ? '← →' : '← → to browse senses'));
    }
    if (foot.childNodes.length) card.appendChild(foot);

    root.replaceChildren(card);
    return card;
  }

  // ---- a passage ----------------------------------------------------------

  function renderPassage(root, state, handlers) {
    const card = el('div', 'card');

    const head = el('div', 'head');
    head.appendChild(el('span', 'word', 'In this passage'));
    card.appendChild(head);

    const sub = el('div', 'sub');
    sub.appendChild(el('span', null, QL.sanitize.clamp(state.query, 90)));
    card.appendChild(sub);

    const list = el('div', 'terms');
    for (const part of state.parts || []) {
      const top = (part.result.senses || [])[0];
      if (!top) continue;
      const row = el('button', 'term');
      row.type = 'button';
      const line = el('div');
      line.appendChild(el('span', 't', part.result.word || part.term));
      line.appendChild(document.createTextNode('  '));
      line.appendChild(el('span', 'p', posLabel(top)));
      row.appendChild(line);
      row.appendChild(el('div', 'g', QL.sanitize.clamp(top.text, 130)));
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.drillInto(part);
      });
      list.appendChild(row);
    }

    if (!list.childNodes.length) {
      card.appendChild(el('div', 'state', 'Nothing unusual to define in this selection.'));
    } else {
      card.appendChild(list);
    }

    // The explanation belongs above the footer, not after it.
    if (state.explanation) {
      const box = el('div', 'body');
      const inner = el('div', 'explain');
      inner.appendChild(el('div', 'label', 'In plain English'));
      inner.appendChild(el('p', null, state.explanation));
      box.appendChild(inner);
      card.appendChild(box);
    } else if (state.explainError) {
      card.appendChild(el('div', 'state error', state.explainError));
    }

    const foot = el('div', 'foot');
    if (state.llmEnabled && !state.explanation && !state.explaining) {
      const btn = el('button', 'action', 'Explain the whole passage');
      btn.addEventListener('click', (e) => { e.stopPropagation(); handlers.explain(); });
      foot.appendChild(btn);
    } else if (state.explaining) {
      const line = el('span', 'hint');
      line.appendChild(el('span', 'spinner'));
      line.appendChild(document.createTextNode('Explaining…'));
      foot.appendChild(line);
    } else if (!state.llmEnabled) {
      foot.appendChild(el('span', 'hint', 'Enable plain-English explanation in settings'));
    }
    if (foot.childNodes.length) card.appendChild(foot);

    root.replaceChildren(card);
    return card;
  }

  QL.card = { renderWord, renderPassage, renderLoading, renderMessage, el };
})();
