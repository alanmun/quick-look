// Popup stylesheet, injected into a closed shadow root.
//
// Every rule is scoped inside the shadow root, and the host element resets all
// inherited properties, so a page cannot style the card and the card cannot
// disturb the page. No web fonts, no external resources.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  QL.styles = `
:host {
  all: initial;
}
* { box-sizing: border-box; }

.card {
  position: fixed;
  z-index: 2147483647;
  max-width: 380px;
  min-width: 260px;
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 10px;
  border: 1px solid var(--ql-border);
  background: var(--ql-bg);
  color: var(--ql-fg);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.1);
  font: 400 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  animation: ql-in 110ms ease-out;
}
@keyframes ql-in {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
}

/* Light is the base; dark is a token swap only. */
.card {
  --ql-bg: #ffffff;
  --ql-fg: #1a1a1a;
  --ql-muted: #6b6b6b;
  --ql-border: #e2e2e2;
  --ql-rule: #efefef;
  --ql-accent: #2f6fd0;
  --ql-chip-bg: #f2f4f7;
  --ql-chip-fg: #4a5568;
  --ql-hover: #f5f6f8;
  /* Pager controls sit at the edge of the card and were getting lost against
     it, so they are deliberately higher-contrast than the muted footer text.
     On dark this is ghostwhite; on light, muted-grey would be the same problem
     in reverse, so it inverts. */
  --ql-pager: #15161a;
}
@media (prefers-color-scheme: dark) {
  .card {
    --ql-bg: #1f2023;
    --ql-fg: #ececec;
    --ql-muted: #9aa0a6;
    --ql-border: #3a3c40;
    --ql-rule: #303236;
    --ql-accent: #7fa8f0;
    --ql-chip-bg: #2c2e33;
    --ql-chip-fg: #b6bcc4;
    --ql-hover: #2a2c30;
    --ql-pager: ghostwhite;
  }
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 12px 6px;
}
.word {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  word-break: break-word;
  flex: 1 1 auto;
}
.pager {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  color: var(--ql-pager);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.pager button {
  all: unset;
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: var(--ql-pager);
  font-size: 13px;
  line-height: 1;
}
.pager button:hover:not([disabled]) { background: var(--ql-hover); color: var(--ql-fg); }
.pager button[disabled] { opacity: 0.4; cursor: default; }
.pager button:focus-visible { outline: 2px solid var(--ql-accent); outline-offset: 1px; }
.count { padding: 0 3px; min-width: 30px; text-align: center; color: var(--ql-pager); }

.sub {
  padding: 0 12px 8px;
  color: var(--ql-muted);
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.pos { font-style: italic; }
.chip {
  background: var(--ql-chip-bg);
  color: var(--ql-chip-fg);
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 11px;
  font-style: normal;
}
.chip.translate { background: var(--ql-accent); color: #fff; }

.body { padding: 0 12px 12px; }
.def { margin: 0; word-break: break-word; }
.example {
  margin: 7px 0 0;
  padding-left: 9px;
  border-left: 2px solid var(--ql-rule);
  color: var(--ql-muted);
  font-style: italic;
  font-size: 13px;
}
.why {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ql-muted);
  display: flex;
  gap: 5px;
  align-items: center;
}
.why::before { content: "◆"; font-size: 8px; color: var(--ql-accent); }

/* Passage mode: one row per hard term. */
.terms { padding: 2px 0 6px; }
.term {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-top: 1px solid var(--ql-rule);
}
.term:first-child { border-top: 0; }
.term:hover { background: var(--ql-hover); }
.term:focus-visible { outline: 2px solid var(--ql-accent); outline-offset: -2px; }
.term .t { font-weight: 600; }
.term .g { color: var(--ql-muted); font-size: 13px; }
.term .p { color: var(--ql-muted); font-style: italic; font-size: 11.5px; }

.foot {
  border-top: 1px solid var(--ql-rule);
  padding: 7px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}
.action {
  all: unset;
  cursor: pointer;
  color: var(--ql-accent);
  font-size: 12.5px;
  padding: 2px 4px;
  border-radius: 4px;
}
.action:hover { text-decoration: underline; }
.action:focus-visible { outline: 2px solid var(--ql-accent); outline-offset: 1px; }
.hint { color: var(--ql-muted); font-size: 12.5px; }
.source {
  color: var(--ql-muted);
  font-size: 11px;
  text-decoration: none;
  margin-left: auto;
  white-space: nowrap;
}
.source:hover { color: var(--ql-accent); text-decoration: underline; }
.source:focus-visible { outline: 2px solid var(--ql-accent); outline-offset: 1px; }

.state { padding: 12px; color: var(--ql-muted); font-size: 13px; }
.state.error { color: #c0392b; }
@media (prefers-color-scheme: dark) { .state.error { color: #ff8a80; } }

.spinner {
  display: inline-block;
  width: 11px; height: 11px;
  border: 2px solid var(--ql-rule);
  border-top-color: var(--ql-accent);
  border-radius: 50%;
  animation: ql-spin 0.7s linear infinite;
  vertical-align: -1px;
  margin-right: 6px;
}
@keyframes ql-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }

.explain { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--ql-rule); }
.explain p { margin: 0; }
.explain .label {
  font-size: 11px; color: var(--ql-muted); text-transform: uppercase;
  letter-spacing: 0.05em; margin-bottom: 4px;
}
`;
})();
