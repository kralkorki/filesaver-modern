/**
 * Test suite for the modernised FileSaver.
 *
 * Runs on Node's built-in test runner (node --test) with no dependencies.
 * Every environment the library branches on is simulated so the cascade can be
 * exercised end to end: Chromium, iOS Safari, legacy Edge/IE, macOS WebView,
 * and a worker with no DOM at all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// Captured before any fake is installed. Two tests deliberately save a *real*
// Blob so the MIME-type and BOM logic sees genuine `.type` strings — using the
// test double there is exactly what let the picker-path regression through.
const RealBlob = globalThis.Blob;

/**
 * Builds a fake browser environment and loads a fresh copy of the library
 * inside it. The library captures globals at module load, so every scenario
 * needs its own module registry — hence clearing require.cache.
 */
function loadIn(env) {
  const keys = [
    'window', 'document', 'navigator', 'Blob', 'File', 'MouseEvent',
    'URL', 'XMLHttpRequest', 'location'
  ];
  const saved = {};
  for (const k of keys) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    if (env[k] !== undefined) {
      // Always define, never assign: Node exposes `navigator` as a getter-only
      // accessor on globalThis, so plain assignment throws in strict mode and
      // silently no-ops outside it. defineProperty replaces the accessor with
      // a data property, which is what the library reads.
      Object.defineProperty(globalThis, k, {
        value: env[k], writable: true, configurable: true, enumerable: true
      });
    } else if (k === 'navigator') {
      // Node has a real navigator global; blanking it stops a UA string from
      // leaking into feature detection. Everything else is genuinely absent.
      Object.defineProperty(globalThis, k, {
        value: undefined, writable: true, configurable: true, enumerable: false
      });
    }
  }
  // setTimeout/console are ambient Node globals the library legitimately uses;
  // they are never removed, otherwise every scenario that clicks a deferred
  // anchor would throw ReferenceError instead of testing real behaviour.

  // delete require cache so the module re-evaluates against the new globals
  const p = require.resolve('../src/FileSaver.js');
  delete require.cache[p];
  const saveAs = require('../src/FileSaver.js');

  // At module load the library probes `'download' in document.createElement('a')`,
  // creating and discarding one element. Anything recorded before this line is
  // a capability probe, not a save. Resetting here is what makes
  // "how many anchors did this save use" assertions trustworthy — without it
  // every count is off by one and the suite invents a library bug that is not
  // there.
  if (Array.isArray(env.anchors)) env.anchors.length = 0;
  if (Array.isArray(env.created)) env.created.length = 0;
  if (Array.isArray(env.revoked)) env.revoked.length = 0;

  return {
    saveAs,
    restore() {
      // Restore the original property descriptors, not just values — Node's
      // navigator is an accessor and assigning over it would silently keep our
      // fake installed for every later test in the file.
      for (const k of keys) {
        const d = saved[k];
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
      delete require.cache[p];
    }
  };
}

// ---------------------------------------------------------------------------
// Minimal fakes
// ---------------------------------------------------------------------------

class FakeBlob {
  constructor(parts = [], opts = {}) {
    this.parts = parts;
    this.type = opts.type || '';
  }
}

/**
 * Drain whatever the picker was handed — a real ReadableStream, a Blob, or an
 * ArrayBuffer — back into raw bytes.
 *
 * Returns a Uint8Array, not a string, on purpose: TextDecoder silently strips
 * a leading UTF-8 BOM, so decoding to text would hide exactly the thing these
 * assertions exist to check.
 */
async function readAll(payload) {
  if (payload == null) return new Uint8Array(0);
  if (typeof payload === 'string') return new TextEncoder().encode(payload);

  if (typeof payload.getReader === 'function') {
    const reader = payload.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      total += r.value.byteLength ?? r.value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength ?? c.length; }
    return out;
  }
  if (typeof payload.arrayBuffer === 'function') {
    return new Uint8Array(await payload.arrayBuffer());
  }
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer);
  return new TextEncoder().encode(String(payload));
}

const UTF8_BOM = [0xEF, 0xBB, 0xBF];
function hasUtf8Bom(bytes) {
  return bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2];
}

function makeElement() {
  const el = {
    _attrs: {},
    set href(v) { this._attrs.href = v; },
    get href() { return this._attrs.href; },
    set download(v) { this._attrs.download = v; },
    get download() { return this._attrs.download; },
    set rel(v) { this._attrs.rel = v; },
    dispatched: 0,
    dispatchEvent(ev) { this.dispatched++; this.lastEvent = ev.type; }
  };
  // The library gates on `'download' in HTMLAnchorElement.prototype`. A plain
  // object literal defines accessors as own properties, which `in` does find —
  // but we mirror the browser exactly so the check is meaningful, not accidental.
  el.hasDownloadProperty = true;
  return el;
}

function baseEnv(extra = {}) {
  const created = [];
  const revoked = [];
  const anchors = [];

  const doc = {
    baseURI: 'https://example.com/app/',
    createElement(tag) {
      if (tag === 'a') {
        const el = makeElement();
        anchors.push(el);
        return el;
      }
      return makeElement();
    },
    createElementNS(ns, tag) {
      return doc.createElement(tag);
    },
    createEvent() { throw new Error('legacy createEvent path should not be used'); }
  };

  // Node ships a spec-compliant URL, and the library's filename inference goes
  // through the real parser. Faking URL parsing here produced a false negative
  // that looked exactly like a library bug, so we reuse the built-in and only
  // attach the object-URL statics the code actually needs.
  const RealURL = globalThis.URL;
  class URLCtor extends RealURL {}
  URLCtor.createObjectURL = function (obj) {
    const u = 'blob:mock/' + (created.length + 1);
    created.push(obj);
    return u;
  };
  URLCtor.revokeObjectURL = function (u) { revoked.push(u); };

  return {
    window: undefined,
    document: doc,
    Blob: FakeBlob,
    MouseEvent: class { constructor(type) { this.type = type; } },
    URL: URLCtor,
    XMLHttpRequest: class {
      constructor() {
        this.status = 200;
      }
      open(m, u) { this._m = m; this._u = u; }
      // NOTE: do NOT implement this as `set responseType(v){ this.responseType = v }`.
      // That assigns through the setter and recurses until the stack overflows,
      // which made send() never run and looked like a library bug for hours.
      // Backing it with a private field breaks the cycle.
      set responseType(v) { this._responseType = v; }
      get responseType() { return this._responseType; }
      send() {
        this.response = new FakeBlob(['fetched'], { type: 'text/plain' });
        this.onload && this.onload();
      }
    },
    location: { href: '' },
    // A desktop-Chrome-shaped navigator by default. Every scenario starts from
    // one consistent baseline; individual tests override it via `extra`.
    // Without this, loadIn has to blank out Node's own navigator (an accessor
    // global), and that path proved unreliable.
    navigator: { userAgent: 'Mozilla/5.0 Chrome/120', platform: 'Win32' },
    created, revoked, anchors,
    ...extra
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('API shape is preserved: callable, .saveAs alias, module.exports', () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  assert.equal(typeof saveAs, 'function');
  assert.equal(saveAs.saveAs, saveAs, 'saveAs.saveAs must reference itself');
  assert.equal(env.window.saveAs, saveAs, 'must attach to window');

  restore();
});

test('Blob with no name falls back to "download"', async () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['x'], { type: 'text/plain' }));

  // The click is deliberately deferred by a 0ms timeout so that Safari has
  // committed the object URL before the navigation starts. Assert after the
  // macrotask, otherwise we are testing scheduling, not behaviour.
  await new Promise(r => setTimeout(r, 5));

  assert.equal(env.anchors.length, 1);
  assert.equal(env.anchors[0].download, 'download');
  assert.equal(env.anchors[0].dispatched, 1, 'anchor must be clicked');

  restore();
});

test('Explicit filename is preserved', () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['x']), 'rapor.csv');

  assert.equal(env.anchors[0].download, 'rapor.csv');
  restore();
});

test('File object name is used when no filename given', () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  const file = new FakeBlob(['x']);
  file.name = 'from-file.pdf';
  saveAs(file);

  assert.equal(env.anchors[0].download, 'from-file.pdf');
  restore();
});

test('URL string input infers the filename from the path', async () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs('https://example.com/reports/ozet.pdf');

  // The string path is asynchronous: the library fetches the URL into a Blob
  // (so both the filename and the download attribute are honoured) and only
  // then creates the anchor, whose click is itself deferred by a 0ms timeout.
  // Drain the microtask queue and then a macrotask before asserting.
  await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 10));

  assert.equal(env.created.length, 1,
    'the URL is fetched into a Blob (created=' + env.created.length + ')');
  assert.equal(env.anchors.length, 1,
    'the fetched blob is saved via an anchor (anchors=' + env.anchors.length + ')');
  assert.equal(env.anchors[0].download, 'ozet.pdf');
  restore();
});

test('object URL is created and revoked after the delay', async () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['data']));
  await new Promise(r => setTimeout(r, 10));

  assert.equal(env.created.length, 1, 'a blob URL must be created');
  assert.equal(env.anchors[0].dispatched, 1, 'click must be deferred, not sync');

  restore();
});

test('autoBom prepends exactly ONE BOM character, not two', () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['a,b\n1,2'], { type: 'text/csv;charset=utf-8' }), 'x.csv', { autoBom: true });

  // The wrapped blob must contain exactly one 0xFEFF prefix.
  const wrapped = env.created[0];
  const parts = wrapped.parts;
  const bomCount = parts.filter(p => p === String.fromCharCode(0xFEFF)).length;
  assert.equal(bomCount, 1, 'BOM must be applied once');
  assert.equal(parts.length, 2);

  restore();
});

test('autoBom does not fire for non-text types', () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob([new Uint8Array([1, 2])], { type: 'application/pdf' }), 'a.pdf', { autoBom: true });

  const wrapped = env.created[0];
  assert.equal(wrapped.parts.length, 1, 'no BOM should be added for binary types');
  restore();
});

test('legacy boolean third argument still maps to autoBom (deprecated form)', async () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['a'], { type: 'text/plain;charset=utf-8' }), 'a.txt', true);

  // The object URL — and therefore the wrapped Blob — is created synchronously,
  // but the click is deferred; wait for the turn to complete either way so this
  // assertion is not racing the scheduler.
  await new Promise(r => setTimeout(r, 5));

  const wrapped = env.created[0];
  assert.ok(wrapped, 'a blob must have been passed through createObjectURL');
  assert.equal(wrapped.parts.length, 2, 'boolean true should behave like autoBom:true');
  restore();
});

test('multiple sequential saves create separate URLs (bug #523)', async () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['one']), 'a.txt');
  saveAs(new FakeBlob(['two']), 'b.txt');
  saveAs(new FakeBlob(['three']), 'c.txt');

  await new Promise(r => setTimeout(r, 10));

  assert.equal(env.anchors.length, 3, 'each save must create its own anchor');
  assert.equal(env.created.length, 3, 'each save must get its own object URL');
  const names = env.anchors.map(a => a.download);
  assert.deepEqual(names, ['a.txt', 'b.txt', 'c.txt']);

  restore();
});

test('Chromium picker path applies autoBom (regression: opts were dropped)', async () => {
  let written = null;
  const env = baseEnv({
    // A real Blob, because the picker path writes blob.stream() and the BOM
    // logic inspects `.type`. The test double has neither, which is exactly
    // why the original regression slipped past the suite.
    Blob: RealBlob,
    showSaveFilePicker: () => Promise.resolve({
      createWritable: () => Promise.resolve({
        write: (chunk) => { written = chunk; return Promise.resolve(); },
        close: () => Promise.resolve()
      })
    }),
    navigator: { userAgent: 'Chrome', canShare: () => false, share: () => Promise.resolve() }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  // Use Node's real Blob so the BOM logic sees a genuine .type string. A fake
  // Blob is what let this regression ship in the first place.
  await saveAs(new RealBlob(['a,b\n1,2'], { type: 'text/csv;charset=utf-8' }), 'r.csv', { autoBom: true });

  assert.ok(written, 'the picker must receive a payload');
  const bytes = await readAll(written);
  assert.ok(hasUtf8Bom(bytes),
    'autoBom must prepend the UTF-8 BOM on the picker path too (was dropped)',
    'first bytes = ' + Array.from(bytes.slice(0, 3)).map(x => x.toString(16)).join(' '));
  assert.equal(new TextDecoder().decode(bytes.slice(3)), 'a,b\n1,2',
    'original content must be intact after the BOM');

  restore();
});

test('Chromium picker path leaves non-text blobs untouched', async () => {
  let written = null;
  const env = baseEnv({
    Blob: RealBlob,
    showSaveFilePicker: () => Promise.resolve({
      createWritable: () => Promise.resolve({
        write: (c) => { written = c; return Promise.resolve(); },
        close: () => Promise.resolve()
      })
    }),
    navigator: { userAgent: 'Chrome', canShare: () => false, share: () => Promise.resolve() }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  await saveAs(new RealBlob(['%PDF-1.4'], { type: 'application/pdf' }), 'd.pdf', { autoBom: true });

  const bytes = await readAll(written);
  assert.equal(hasUtf8Bom(bytes), false, 'binary types must not get a BOM');
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.4', 'binary content unchanged');

  restore();
});

test('iOS: uses Web Share API when available (the real fix)', () => {
  const shared = [];
  const env = baseEnv({
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      canShare: (d) => Array.isArray(d.files) && d.files.length > 0,
      share: (d) => { shared.push(d); return Promise.resolve(); }
    },
    File: class { constructor(parts, name, opts) { this.name = name; this.type = opts.type; } }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  const result = saveAs(new FakeBlob(['x'], { type: 'text/csv' }), 'rapor.csv');

  assert.equal(shared.length, 1, 'share sheet must be invoked on iOS');
  assert.equal(shared[0].files[0].name, 'rapor.csv');
  assert.ok(result && typeof result.then === 'function', 'share path returns a Promise');
  assert.equal(env.anchors.length, 0, 'must NOT use the broken anchor path on iOS');

  restore();
});

test('iOS: falls through to anchor when canShare returns false', () => {
  const env = baseEnv({
    navigator: {
      userAgent: 'iPhone Safari',
      platform: 'iPhone',
      canShare: () => false,
      share: () => Promise.resolve()
    }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['x']), 'a.txt');

  assert.equal(env.anchors.length, 1, 'must fall back when share unsupported');
  restore();
});

test('Chromium: prefers showSaveFilePicker and streams the blob', async () => {
  const written = [];
  const closed = [];
  let pickerArgs = null;

  const env = baseEnv({
    showSaveFilePicker: (opts) => {
      pickerArgs = opts;
      return Promise.resolve({
        createWritable: () => Promise.resolve({
          write: (chunk) => { written.push(chunk); return Promise.resolve(); },
          close: () => { closed.push(true); return Promise.resolve(); }
        })
      });
    },
    navigator: { userAgent: 'Chrome', canShare: () => false, share: () => Promise.resolve() }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  const p = saveAs(new FakeBlob(['payload'], { type: 'application/pdf' }), 'doc.pdf');
  await p;

  assert.equal(pickerArgs.suggestedName, 'doc.pdf', 'picker must receive the filename');
  assert.equal(written.length, 1, 'blob must be written to the handle');
  assert.equal(closed.length, 1, 'writable must be closed');
  assert.equal(env.anchors.length, 0, 'must not also fire the anchor path');

  restore();
});

test('Chromium: user cancelling the picker does NOT trigger a fallback save', async () => {
  const abort = new Error('cancelled');
  abort.name = 'AbortError';

  const env = baseEnv({
    showSaveFilePicker: () => Promise.reject(abort),
    navigator: { userAgent: 'Chrome', canShare: () => false, share: () => Promise.resolve() }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  await saveAs(new FakeBlob(['x']), 'a.txt');

  assert.equal(env.anchors.length, 0, 'AbortError must not fall back — user said no');
  restore();
});

test('Chromium: a genuine picker failure DOES fall back to the anchor path', async () => {
  const env = baseEnv({
    showSaveFilePicker: () => Promise.reject(new Error('SecurityError')),
    navigator: { userAgent: 'Chrome', canShare: () => false, share: () => Promise.resolve() }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  await saveAs(new FakeBlob(['x']), 'a.txt');

  assert.equal(env.anchors.length, 1, 'non-abort failure must degrade gracefully');
  restore();
});

test('legacy Edge/IE uses msSaveOrOpenBlob', () => {
  const calls = [];
  const env = baseEnv({
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edge/18',
      msSaveOrOpenBlob: (blob, name) => calls.push({ blob, name })
    }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['x'], { type: 'text/plain' }), 'legacy.txt');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'legacy.txt');
  assert.equal(env.anchors.length, 0, 'must not use the anchor path');

  restore();
});

test('macOS WebView is excluded from the download-attribute path', () => {
  const env = baseEnv({
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36' }
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  saveAs(new FakeBlob(['x']));

  assert.equal(env.anchors.length, 0, 'macOS WebView must not rely on download attr');
  restore();
});

test('null/undefined input warns and does nothing', () => {
  const env = baseEnv();
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    saveAs(null);
    saveAs(undefined);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(env.anchors.length, 0);
  assert.equal(env.created.length, 0);
  assert.equal(warnings.length, 2, 'should warn once per bad call');
  restore();
});

test('silent:true suppresses warnings and returns undefined (legacy behaviour)', () => {
  const env = baseEnv({
    showSaveFilePicker: () => Promise.resolve({ createWritable: () => Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }) })
  });
  env.window = env;
  const { saveAs, restore } = loadIn(env);

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  let result;
  try {
    result = saveAs(new FakeBlob(['x']), 'a.txt', { silent: true });
  } finally {
    console.warn = origWarn;
  }

  assert.equal(result, undefined, 'silent mode must return undefined like v2');
  assert.equal(warnings.length, 0);
  restore();
});

test('no DOM at all (worker): does not throw', () => {
  const env = baseEnv();
  // deliberately no window
  const { saveAs, restore } = loadIn(env);

  assert.doesNotThrow(() => saveAs(new FakeBlob(['x']), 'a.txt'));
  restore();
});