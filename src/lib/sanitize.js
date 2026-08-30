// Turns Wiktionary's definition HTML into plain text.
//
// Nothing from the network is ever handed to innerHTML anywhere in this
// extension. Definitions arrive as HTML fragments, get flattened to text here
// in the background, and reach the page only as strings set via textContent.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', lsquo: '‘',
    rsquo: '’', ldquo: '“', rdquo: '”', times: '×',
    middot: '·', deg: '°', eacute: 'é', egrave: 'è',
    agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö',
    auml: 'ä', szlig: 'ß', ntilde: 'ñ',
  };

  function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return '';
        if (code >= 0xD800 && code <= 0xDFFF) return '';
        try { return String.fromCodePoint(code); } catch (e) { return ''; }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? match : named;
    });
  }

  // C0/C1 controls, zero-width characters, and the bidi overrides that could
  // otherwise be used to visually spoof a definition once it is rendered.
  // Expressed as code-point ranges so this file stays pure ASCII.
  const INVISIBLE_RANGES = [
    [0x0000, 0x0008], [0x000B, 0x000C], [0x000E, 0x001F], [0x007F, 0x009F],
    [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2064], [0x2066, 0x2069],
    [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB],
  ];

  function stripInvisibles(s) {
    let out = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      let bad = false;
      for (const range of INVISIBLE_RANGES) {
        if (c >= range[0] && c <= range[1]) { bad = true; break; }
      }
      if (!bad) out += ch;
    }
    return out;
  }

  // Strips tags without ever constructing a DOM. Block-level tags become
  // spaces so words don't get welded together.
  function htmlToText(html) {
    if (typeof html !== 'string' || html === '') return '';
    let out = html;
    out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    out = out.replace(/<!--[\s\S]*?-->/g, ' ');
    out = out.replace(/<\s*(br|p|div|li|tr|td|dd|dt|h[1-6])\b[^>]*>/gi, ' ');
    out = out.replace(/<\/\s*(p|div|li|tr|td|dd|dt|h[1-6])\s*>/gi, ' ');
    out = out.replace(/<[^>]*>/g, '');
    out = decodeEntities(out);
    out = stripInvisibles(out);
    return out.replace(/\s+/g, ' ').trim();
  }

  // Wiktionary prefixes many senses with grammatical and topic labels in
  // parentheses -- "(law)", "(computing, informal)". Those labels are the
  // strongest signal we have for context matching, so pull them out.
  function splitLabels(text) {
    const m = /^\(([^)]{1,80})\)\s*(.+)$/.exec(text);
    if (!m) return { labels: [], text };
    const labels = m[1]
      .split(/\s*,\s*/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 6);
    return { labels, text: m[2].trim() };
  }

  function clamp(str, max) {
    if (typeof str !== 'string') return '';
    return str.length <= max ? str : str.slice(0, max).replace(/\s+\S*$/, '') + '…';
  }

  QL.sanitize = { htmlToText, decodeEntities, splitLabels, clamp, stripInvisibles };
})();
