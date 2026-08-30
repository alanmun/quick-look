// In-memory LRU cache for lookups.
//
// PRIVACY: deliberately in-memory only. Nothing about what you looked up is
// ever written to disk, so there is no lookup history to leak, subpoena, or
// forget to clear. The cost is that the cache empties when the background page
// is suspended, which is exactly the trade we want.
//
// It also keeps us honest with Wikimedia: repeatedly double-clicking the same
// word costs one request, not one per click.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  function createCache(options) {
    const opts = options || {};
    const maxEntries = opts.maxEntries || 300;
    const ttlMs = opts.ttlMs || 30 * 60 * 1000;
    const map = new Map();

    function get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { map.delete(key); return undefined; }
      // Refresh recency.
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    }

    function set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, at: Date.now() });
      while (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      return value;
    }

    // Collapses concurrent identical lookups into one in-flight request, so a
    // double-click that fires two events does not fire two fetches.
    const inflight = new Map();
    async function through(key, produce) {
      const cached = get(key);
      if (cached !== undefined) return cached;
      if (inflight.has(key)) return inflight.get(key);
      const promise = (async () => {
        try {
          const value = await produce();
          // Never cache a transport failure: a rate-limited or timed-out
          // lookup must be retried, not remembered.
          if (value && value.ok !== false) set(key, value);
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
      return promise;
    }

    return {
      get, set, through,
      clear: () => { map.clear(); inflight.clear(); },
      get size() { return map.size; },
    };
  }

  QL.cache = { createCache };
})();
