// Thin cross-browser shim.
//
// Firefox exposes the promise-based `browser.*` namespace; Chrome exposes
// `chrome.*`, which is promise-based for the APIs we use under MV3. Picking one
// object here keeps every other file free of branching.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const api = (typeof browser !== 'undefined' && browser && browser.runtime)
    ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

  // Firefox is the only one of the two that implements background event pages
  // rather than service workers; a few call sites need to know.
  const isFirefox = typeof browser !== 'undefined'
    && typeof browser.runtime !== 'undefined'
    && typeof ServiceWorkerGlobalScope === 'undefined';

  QL.api = api;
  QL.compat = { api, isFirefox };
})();
