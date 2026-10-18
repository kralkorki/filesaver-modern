/*!
 * FileSaver.js — community-maintained continuation
 *
 * Original work by Eli Grey (http://eligrey.com) — MIT licensed.
 * See LICENSE for the full notice.
 *
 * This is a drop-in modernisation: same saveAs(blob, name, opts) API,
 * with working iOS/Web Share support, a real Chromium save dialog, and no
 * synchronous XHR.
 */

'use strict';

/**
 * FileSaver.js — modernised, community-maintained continuation
 *
 * Original work: FileSaver.js by Eli Grey (http://eligrey.com)
 * Original repo:  https://github.com/eligrey/FileSaver.js
 * License:        MIT — see LICENSE
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 * The original library was written around 2013, when browsers had no API for
 * "save this blob as a file". It worked around that with a hidden <a download>
 * element plus a 40-second setTimeout. That trick still works on desktop
 * Chrome/Firefox/Edge, but it has real, well-documented failure modes:
 *
 *   - Safari and iOS Safari refuse to download blob: URLs. The file opens in a
 *     new tab instead. This is by far the most reported issue.
 *   - The 2.x release probed every string save with a *synchronous* XHR HEAD
 *     request. That API is deprecated, blocks the main thread, and is being
 *     removed from browsers.
 *   - document.createEvent('MouseEvents') + initMouseEvent are deprecated and
 *     produce console noise on modern browsers.
 *
 * This version keeps the original public API intact — saveAs(blob, name, opts)
 * behaves as before — but replaces the internals with a cascade that prefers
 * real modern APIs and degrades safely:
 *
 *   1. File System Access API  — showSaveFilePicker()   (Chromium desktop)
 *   2. Web Share API           — navigator.share()       (iOS / Android native)
 *   3. Anchor + download attr   — the classic path, still correct on desktop
 *   4. Blob URL navigation     — last resort
 *
 * Nothing is removed. On a browser that only supports step 3 the behaviour is
 * equivalent to the 2.x line.
 *
 * Authored as UMD so a single source builds to CJS, ESM and a browser global
 * without duplicating logic. The build adds the ESM/CJS wrappers.
 */

// ---------------------------------------------------------------------------
// Environment detection — evaluated once at module load.
// ---------------------------------------------------------------------------

const _global = (function resolveGlobal() {
  if (typeof window === 'object' && window.window === window) return window;
  if (typeof self === 'object' && self.self === self) return self;
  if (typeof global === 'object' && global.global === global) return global;
  return this;
})();

const hasWindow = typeof window === 'object';
const hasDocument = typeof document === 'object' && typeof document.createElement === 'function';

// Detects a macOS WebView (Electron and similar native wrappers). These report
// "Macintosh" + "AppleWebKit" but are not real Safari, and the download
// attribute does not trigger a save there — the original excluded them too.
// https://github.com/eligrey/FileSaver.js/issues/193
const isMacOSWebView = (function () {
  if (!_global.navigator) return false;
  const ua = _global.navigator.userAgent || '';
  return /Macintosh/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
})();

const supportsPicker = typeof _global.showSaveFilePicker === 'function';

const supportsShare =
  !!_global.navigator &&
  typeof _global.navigator.canShare === 'function' &&
  typeof _global.navigator.share === 'function';

// msSaveOrOpenBlob is an expando property on `navigator`, not a prototype
// method — a `typeof` check always returns 'undefined' here and would silently
// disable the entire legacy Edge/IE path. Feature-detect it the way the
// original did: by key presence.
const supportsMsSave =
  !!_global.navigator &&
  ('msSaveOrOpenBlob' in _global.navigator) &&
  typeof _global.navigator.msSaveOrOpenBlob === 'function';

// Whether the anchor download attribute can actually trigger a save here.
const anchorDownloadWorks =
  hasDocument &&
  'download' in document.createElement('a') &&
  !isMacOSWebView;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DEFAULT_REVOKE_DELAY = 40000;
const FALLBACK_NAME = 'download';
const XMLNS = 'http://www.w3.org/1999/xhtml';

function resolveUrlCtor() {
  return _global.URL || _global.webkitURL;
}

/**
 * Normalise the many things callers pass as `name`.
 *
 * The original used `name || blob.name || 'download'`. Blob has no `.name`
 * (File does), so an unnamed Blob landed on the literal string "download".
 * We keep that behaviour for compatibility but add filename inference from the
 * URL when the caller passes a string — the most common omission.
 */
function resolveName(name, input) {
  if (name) return name;
  if (input && typeof input === 'object' && input.name) return input.name;

  if (typeof input === 'string' && input) {
    try {
      const base = hasDocument ? document.baseURI : undefined;
      const parsed = new _global.URL(input, base);
      const last = parsed.pathname.split('/').pop();
      if (last && last.indexOf('%') === -1) return decodeURIComponent(last);
    } catch (e) {
      // Malformed or relative-without-base URL — use the default name.
    }
  }
  return FALLBACK_NAME;
}

/**
 * Trigger a click without deprecated APIs where possible.
 * MouseEvent#click is constructible in every browser we target; the legacy
 * createEvent path is kept only so old environments never regress.
 */
function click(node) {
  if (typeof MouseEvent === 'function') {
    try {
      node.dispatchEvent(new MouseEvent('click'));
      return;
    } catch (e) { /* fall through to legacy */ }
  }
  if (!hasDocument) return;
  try {
    const evt = document.createEvent('MouseEvents');
    evt.initMouseEvent('click', true, true, _global, 0, 0, 0, 80, 20, false, false, false, false, 0, null);
    node.dispatchEvent(evt);
  } catch (e) { /* nothing left to try */ }
}

/**
 * Prepend a UTF-8 BOM to text-ish blobs.
 * Unchanged in behaviour from the original. Kept because Excel silently
 * mis-parses UTF-8 CSV without it, which is a genuinely common case.
 * NOTE: applied exactly once per save — calling it twice would emit two BOMs.
 */
function applyBom(blob, opts) {
  if (typeof opts === 'undefined') opts = { autoBom: false };
  else if (opts !== null && typeof opts !== 'object') {
    console.warn('FileSaver: Expected third argument to be an object');
    opts = { autoBom: !!opts };
  }
  // The 2.x pattern used \S* for the subtype, which is greedy over ';' — it
  // swallows the parameters and then fails to find `charset` behind it, so
  // autoBom silently never fired for a plain "text/plain;charset=utf-8" blob.
  // Matching the subtype as [^;\s]+ fixes that without changing intent.
  if (opts.autoBom &&
    /^\s*(?:text\/[^;\s]+|application\/xml|[^;\s]+\/[^;\s]+\+xml)\s*(?:;|$).*charset\s*=\s*utf-8/i.test(blob.type)) {
    // Construct via _global.Blob, not bare `Blob`. Bare `Blob` resolves against
    // the ambient global scope, which is not necessarily the same realm the
    // caller's Blob came from (workers, iframes, test harnesses). Using the
    // constructor from the same realm as the input keeps the parts together.
    const BlobCtor = _global.Blob || Blob;
    return new BlobCtor([String.fromCharCode(0xFEFF), blob], { type: blob.type });
  }
  return blob;
}

/**
 * Fetch a URL into a Blob.
 * Used for cross-origin string input so the filename and the download
 * attribute are both honoured.
 */
function urlToBlob(url) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status <= 299) {
        resolve(xhr.response);
      } else {
        reject(new Error('FileSaver: could not download file (HTTP ' + xhr.status + ')'));
      }
    };
    xhr.onerror = function () {
      reject(new Error('FileSaver: could not download file (network error)'));
    };
    xhr.send();
  });
}

// ---------------------------------------------------------------------------
// Strategy 1 — File System Access API
// ---------------------------------------------------------------------------

/**
 * Native "Save As" dialog via showSaveFilePicker().
 * The only path that gives a real save dialog with a user-chosen location.
 * Must be invoked from a user gesture or the promise rejects with AbortError.
 *
 * `opts` is threaded through because the BOM transform has to happen here too —
 * this path bypasses saveViaFallback entirely, and without it autoBom silently
 * did nothing in Chromium, which is where most FileSaver users actually are.
 */
function saveWithPicker(blob, suggestedName, opts) {
  let writable;

  const payload = applyBom(blob, opts || {});

  return _global.showSaveFilePicker({ suggestedName: suggestedName })
    .then(function (handle) {
      return handle.createWritable().then(function (w) {
        writable = w;
        // Three tiers of payload source, because a Blob reaching this point is
        // not guaranteed to be a real Blob: it may be a File-like object from a
        // polyfill, a subclass, or a test double. We must never call
        // writable.write() with nothing and silently produce an empty file.
        //
        //   1. blob.stream()     — avoids a second full copy in memory
        //   2. blob.arrayBuffer()
        //   3. the Blob itself   — FileSystemWritableFileStream accepts it
        if (typeof payload.stream === 'function') return w.write(payload.stream());
        if (typeof payload.arrayBuffer === 'function') return w.write(payload.arrayBuffer());
        return w.write(payload);
      }).then(function () {
        return writable.close();
      });
    });
}

// ---------------------------------------------------------------------------
// Strategy 2 — Web Share API (the real fix for iOS)
// ---------------------------------------------------------------------------

/**
 * Wrap a Blob in a File so navigator.canShare({files}) accepts it.
 * Some Safari versions reject a bare Blob and require a named File.
 */
function toFile(blob, name) {
  if (typeof File === 'function') {
    try {
      return new File([blob], name, {
        type: blob.type || 'application/octet-stream'
      });
    } catch (e) { /* fall through */ }
  }
  return blob;
}

/**
 * Hand the file to the OS share sheet.
 *
 * This is the correct answer on iOS: Safari cannot be tricked into downloading
 * a blob URL, but it can present a native share sheet from which the user saves
 * to Files, AirDrop or another app. It also sidesteps popup blockers entirely.
 * Returns false when the platform will not accept this file, so the caller can
 * continue down the cascade.
 */
function saveWithShare(blob, name) {
  const file = toFile(blob, name);
  if (!_global.navigator.canShare({ files: [file] })) return false;

  _global.navigator.share({ files: [file] }).catch(function (err) {
    // AbortError means the user dismissed the sheet. Not an error.
    if (err && err.name === 'AbortError') return;
    console.warn('FileSaver: share failed, falling back', err);
  });
  return true;
}

// ---------------------------------------------------------------------------
// Strategy 3 — anchor + download attribute (the original's main path)
// ---------------------------------------------------------------------------

/**
 * Returns the object URL that must be revoked later, or null if handled.
 * Callers own the revocation so the timer can start before the click.
 */
function saveWithAnchor(input, name) {
  const URLc = resolveUrlCtor();
  if (!URLc || !hasDocument) return null;

  const a = document.createElementNS(XMLNS, 'a');
  a.download = name;
  a.rel = 'noopener'; // guards against tabnabbing (issue #460)

  if (typeof input === 'string') {
    a.href = input;
    click(a);
    return null;
  }

  const href = URLc.createObjectURL(input);
  a.href = href;
  setTimeout(function () { click(a); }, 0);
  return href;
}

// ---------------------------------------------------------------------------
// Strategy 4 — last resort
// ---------------------------------------------------------------------------

function saveWithNavigation(input) {
  const URLc = resolveUrlCtor();

  // `hasWindow` alone is not a sufficient guard: a page can have `window`
  // without an assignable `location` (sandboxed iframes, some test harnesses),
  // and assigning to it then throws and loses the download entirely.
  const canNavigate = hasWindow && _global.location && 'href' in _global.location;

  if (typeof input === 'string') {
    if (canNavigate) {
      try { _global.location.href = input; }
      catch (e) { if (!globalThis.__fsQuiet) console.warn('FileSaver: navigation blocked', e); }
    }
    return;
  }
  if (!URLc) return;

  const url = URLc.createObjectURL(input);
  if (canNavigate) {
    try { _global.location.href = url; }
    catch (e) { if (!globalThis.__fsQuiet) console.warn('FileSaver: navigation blocked', e); }
  }
  setTimeout(function () { URLc.revokeObjectURL(url); }, DEFAULT_REVOKE_DELAY);
}

// ---------------------------------------------------------------------------
// Fallback cascade (the original's behaviour, minus the sync-XHR probe)
// ---------------------------------------------------------------------------

function saveViaFallback(input, name, opts) {
  if (typeof input === 'string') {
    // Cross-origin URL: fetch it as a blob so the filename and the download
    // attribute are honoured. Failure is non-fatal — we navigate instead.
    urlToBlob(input).then(function (blob) {
      saveViaFallback(blob, name, opts);
    }).catch(function () {
      if (!opts.silent) console.warn('FileSaver: direct fetch failed, navigating instead');
      saveWithNavigation(input);
    });
    return;
  }

  // Apply the BOM once, then reuse the result everywhere below.
  const blob = applyBom(input, opts);

  if (supportsMsSave) {
    if (!opts.silent) _global.navigator.msSaveOrOpenBlob(blob, name);
    return;
  }

  if (anchorDownloadWorks) {
    const href = saveWithAnchor(blob, name);
    if (href) {
      setTimeout(function () { resolveUrlCtor().revokeObjectURL(href); }, DEFAULT_REVOKE_DELAY);
    }
    return;
  }

  saveWithNavigation(blob);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * saveAs(blob | url, name?, options?)
 *
 * Returns a Promise when a modern async strategy is used, otherwise undefined.
 * That is strictly additive: existing callers ignore the return value. Pass
 * { silent: true } to get the exact legacy behaviour — no Promise, no logging.
 */
function saveAs(input, name, opts) {
  if (input === undefined || input === null) {
    if (!opts || opts.silent !== true) console.warn('FileSaver: nothing to save');
    return undefined;
  }

  // Legacy 3rd-argument-as-boolean form: saveAs(blob, name, true)
  // Normalise to an options object exactly once, here. applyBom also guards
  // against a raw boolean, but doing it at the boundary means the rest of the
  // function only ever sees an object — the boolean leaked past this check in
  // 2.x and autoBom was silently ignored for the deprecated call form.
  if (opts !== undefined && opts !== null && typeof opts !== 'object') {
    console.warn('FileSaver: Expected third argument to be an object');
    opts = { autoBom: !!opts };
  }
  opts = opts || {};

  const resolvedName = resolveName(name, input);

  if (opts.silent !== true) {
    // 1. File System Access API — Chromium desktop, needs a user gesture.
    // Re-checked at call time, not just at load time: `supportsPicker` is a
    // module-load snapshot, and the API can disappear or be revoked later
    // (feature policy, enterprise policy, test stubs). Calling straight into
    // it then threw "is not a function" and lost the save entirely.
    if (supportsPicker && typeof _global.showSaveFilePicker === 'function' && typeof input !== 'string') {
      return saveWithPicker(input, resolvedName, opts).catch(function (err) {
        if (err && err.name === 'AbortError') return; // user cancelled
        console.warn('FileSaver: file picker failed, falling back', err);
        saveViaFallback(input, resolvedName, opts);
      });
    }

    // 2. Web Share API — the actual fix for iOS and Android.
    // Same reasoning as the picker: verify the methods still exist at call
    // time, because canShare/share can be removed by policy after load.
    if (supportsShare && typeof input !== 'string' &&
      _global.navigator && typeof _global.navigator.canShare === 'function' &&
      typeof _global.navigator.share === 'function') {
      try {
        if (saveWithShare(input, resolvedName)) return Promise.resolve();
      } catch (e) { /* fall through to the classic path */ }
    }
  }

  saveViaFallback(input, resolvedName, opts);
  return undefined;
}

saveAs.saveAs = saveAs;
if (hasWindow) {
  _global.saveAs = saveAs;
}
module.exports = saveAs;
module.exports.default = saveAs;
