// Build script. No dependencies, no bundler, no transpiler.
//
//   node build.mjs            # build both targets
//   node build.mjs firefox    # build one
//
// Source files are plain scripts that hang their exports off a single global
// `QL` object, and this script concatenates them in a declared order. That is
// the whole build. It exists because Firefox does not support MV3 service
// workers (only event pages) and does not document `"type": "module"` support
// for background scripts, so ES modules are not safely portable across the two
// targets. Concatenation is boring, auditable, and works in both.
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

// Load order matters: a file may use anything declared above it.
const BACKGROUND = [
  'lib/compat.js',
  'lib/sanitize.js',
  'lib/langs.js',
  'lib/context.js',
  'lib/morph.js',
  'lib/labels.js',
  'lib/rank.js',
  'lib/cache.js',
  'lib/freq.js',
  'lib/analyze.js',
  'lib/settings.js',
  'lib/providers.js',
  'lib/wiktionary.js',
  'background/main.js',
];

const CONTENT = [
  'lib/compat.js',
  'lib/sanitize.js',
  'lib/freq.js',
  'lib/analyze.js',
  'lib/settings.js',
  'ui/styles.js',
  'ui/card.js',
  'content/content.js',
];

const OPTIONS = [
  'lib/compat.js',
  'lib/sanitize.js',
  'lib/settings.js',
  'lib/providers.js',
  'options/options.js',
];

const BANNER = (name, files) =>
  `// Quick Look -- generated bundle (${name}). Do not edit.\n`
  + `// Sources, in order:\n`
  + files.map((f) => `//   src/${f}`).join('\n')
  + `\n\n`;

async function bundle(files, name) {
  const parts = [];
  for (const file of files) {
    const code = await readFile(join(src, file), 'utf8');
    parts.push(`// ---- src/${file} ${'-'.repeat(Math.max(0, 60 - file.length))}\n${code}`);
  }
  return BANNER(name, files) + parts.join('\n');
}

// ---- icons ----------------------------------------------------------------

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Draws the mark procedurally: a rounded square in accent blue with a white
// magnifying glass. Avoids shipping binary blobs we cannot diff.
function drawIcon(size) {
  const px = (x, y) => (y * size + x) * 4;
  const raw = Buffer.alloc(size * size * 4, 0);
  const c = size / 2;
  const radius = size * 0.22;
  const lensR = size * 0.26;
  const lensCx = size * 0.44;
  const lensCy = size * 0.42;
  const ring = Math.max(1.2, size * 0.085);

  // Anti-aliased coverage via 3x3 supersampling.
  const S = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const fy = y + (sy + 0.5) / S;

          // Rounded square.
          const dx = Math.max(Math.abs(fx - c) - (c - radius), 0);
          const dy = Math.max(Math.abs(fy - c) - (c - radius), 0);
          if (Math.hypot(dx, dy) <= radius) bg++;

          // Lens ring.
          const dl = Math.hypot(fx - lensCx, fy - lensCy);
          if (Math.abs(dl - lensR) <= ring / 2) fg++;

          // Handle.
          const hx = fx - (lensCx + lensR * 0.72);
          const hy = fy - (lensCy + lensR * 0.72);
          const along = (hx + hy) / Math.SQRT2;
          const across = (hx - hy) / Math.SQRT2;
          if (along >= 0 && along <= size * 0.24 && Math.abs(across) <= ring / 2) fg++;
        }
      }
      const total = S * S;
      const bgA = bg / total;
      const fgA = fg / total;
      const i = px(x, y);
      // Accent blue background, white glass composited on top.
      const r = 47 + (255 - 47) * (fgA / Math.max(bgA, 0.0001));
      const g = 111 + (255 - 111) * (fgA / Math.max(bgA, 0.0001));
      const b = 208 + (255 - 208) * (fgA / Math.max(bgA, 0.0001));
      raw[i] = Math.min(255, Math.round(r));
      raw[i + 1] = Math.min(255, Math.round(g));
      raw[i + 2] = Math.min(255, Math.round(b));
      raw[i + 3] = Math.round(bgA * 255);
    }
  }

  // PNG scanlines need a filter byte per row.
  const stride = size * 4;
  const rows = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (stride + 1)] = 0;
    raw.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- manifests ------------------------------------------------------------

function manifestFor(target, base) {
  const m = JSON.parse(JSON.stringify(base));
  if (target === 'firefox') {
    // Firefox implements MV3 background as an event page; service_worker is
    // not supported (Firefox bug 1573659).
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        // Permanent once submitted to AMO. Override via EXT_ID before the
        // first signing run; it cannot be changed afterwards.
        id: process.env.EXT_ID || 'quick-look@alanmun',
        // Set by the newest manifest key in use, per web-ext lint:
        // optional_host_permissions needs 128, data_collection_permissions
        // needs 140. The higher one wins.
        strict_min_version: '140.0',
        // Required for new Firefox extensions since 2025-11-03. "none" would
        // be a false claim: the selected word is sent to Wiktionary to be
        // defined, and selected text is "websiteContent" under Mozilla's
        // definition. The optional AI provider sends the same category, so it
        // needs no separate entry.
        data_collection_permissions: { required: ['websiteContent'] },
      },
      // Firefox for Android shipped data_collection_permissions two releases
      // later than desktop. Declared separately so desktop 140-141 users are
      // not excluded just to satisfy the Android floor.
      gecko_android: { strict_min_version: '142.0' },
    };
  } else {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '103'; // AbortSignal.timeout
  }
  return m;
}

// ---- run ------------------------------------------------------------------

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const build = targets.length ? targets : ['firefox', 'chrome'];

const base = JSON.parse(await readFile(join(src, 'manifest.base.json'), 'utf8'));
const icons = {};
for (const size of [16, 32, 48, 128]) icons[size] = drawIcon(size);

for (const target of build) {
  const out = join(dist, target);
  if (existsSync(out)) await rm(out, { recursive: true });
  await mkdir(join(out, 'icons'), { recursive: true });
  await mkdir(join(out, 'options'), { recursive: true });

  await writeFile(join(out, 'background.js'), await bundle(BACKGROUND, 'background'));
  await writeFile(join(out, 'content.js'), await bundle(CONTENT, 'content'));
  await writeFile(join(out, 'options', 'options.js'), await bundle(OPTIONS, 'options'));
  await cp(join(src, 'options', 'options.html'), join(out, 'options', 'options.html'));
  await cp(join(src, 'options', 'options.css'), join(out, 'options', 'options.css'));

  for (const [size, png] of Object.entries(icons)) {
    await writeFile(join(out, 'icons', `icon-${size}.png`), png);
  }

  await writeFile(
    join(out, 'manifest.json'),
    JSON.stringify(manifestFor(target, base), null, 2) + '\n'
  );
  console.log(`built dist/${target}`);
}
