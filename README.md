# filesaver-modern

Save `Blob` and `File` objects in the browser — with iOS and Chromium support that actually works.

[![CI](https://github.com/kralkorki/filesaver-modern/actions/workflows/ci.yml/badge.svg)](https://github.com/kralkorki/filesaver-modern/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/filesaver-modern)](https://www.npmjs.com/package/filesaver-modern)
[![npm downloads](https://img.shields.io/npm/dm/filesaver-modern)](https://www.npmjs.com/package/filesaver-modern)
[![license](https://img.shields.io/npm/l/filesaver-modern)](./LICENSE)

**A community-maintained continuation of [FileSaver.js](https://github.com/eligrey/FileSaver.js) by
[Eli Grey](http://eligrey.com).** Same `saveAs(blob, name, opts)` API. MIT licensed. Zero dependencies.

> Eli Grey wrote the original in 2013. It has served ~4.1 million downloads a week for over a decade.
> The repository has been quiet since 2023, and its
> [213 open issues](https://github.com/eligrey/FileSaver.js/issues) are overwhelmingly the same
> unanswered question: *"why does the download open in a new tab instead of saving on iPhone?"*
>
> This project exists to answer that question properly and keep the library maintained. All design
> credit belongs to Eli. This is unofficial — not affiliated with or endorsed by the original author.

**Looking for `file-saver`?** You are in the right place. If you arrived from npm or from the original
repository's issue tracker: this is a drop-in replacement for the `file-saver` package, with the same
`saveAs(blob, name, opts)` signature, and it fixes the iOS bug that package still has.

---

## Why this exists

The original works on desktop. What it does not do is adapt to the platform it now runs on. Three
concrete defects, each reproduced, fixed and covered by a test here:

| Problem | Root cause | Fix |
|---|---|---|
| **iOS opens the file in a new tab instead of saving** — issues [#467](https://github.com/eligrey/FileSaver.js/issues/467), [#581](https://github.com/eligrey/FileSaver.js/issues/581), [#686](https://github.com/eligrey/FileSaver.js/issues/686), [#479](https://github.com/eligrey/FileSaver.js/issues/479) | Safari and iOS Safari refuse to download `blob:` URLs at all. No anchor trickery can override that. | Use the **Web Share API** — the native share sheet, from which the user saves to Files, AirDrop or any installed app |
| **No real save dialog on Chrome** | The `download` attribute cannot ask *where* to save | Use the **File System Access API** (`showSaveFilePicker`) when available |
| **`autoBom` silently never fires** | The 2.x regex matched the MIME subtype with `\S*`, which is greedy over `;` and swallows `charset=utf-8` before it can match | Match the subtype as `[^;\s]+`. Verified in a real browser — the saved file starts with `ef bb bf` |

Also removed:

- **A synchronous XHR probe** that ran on every string save, blocking the main thread on a deprecated API
- **The deprecated `document.createEvent('MouseEvents')` click path**, no longer reached on any modern browser
- **Load-time-only feature detection** — `showSaveFilePicker` can be revoked by enterprise or feature
  policy after page load, which previously threw and lost the download

---

## Install

```sh
npm install filesaver-modern
```

Zero dependencies, no install scripts, nothing to build.

```js
import { saveAs } from 'filesaver-modern';           // ESM
const { saveAs } = require('filesaver-modern');     // CommonJS
```

```html
<!-- Script tag → window.saveAs -->
<script src="https://unpkg.com/filesaver-modern/dist/FileSaver.js"></script>
```

---

## Usage

```js
// A blob you generated client-side
const blob = new Blob([csvText], { type: 'text/csv' });
saveAs(blob, 'rapor.csv');

// Excel misreads UTF-8 CSV without a BOM — this fixes it
saveAs(blob, 'rapor.csv', { autoBom: true });

// Download from a URL; the filename is inferred from the path
saveAs('https://example.com/reports/ozet.pdf');
```

The API is unchanged from the original, so this is a drop-in swap:

```diff
- import { saveAs } from 'file-saver';
+ import { saveAs } from 'filesaver-modern';
```

`saveAs()` now returns a Promise when an async strategy (file picker or share sheet) runs, and
`undefined` otherwise. Existing callers ignore the return value, so nothing breaks. Pass
`{ silent: true }` for byte-for-byte identical 2.x behaviour.

### Should you switch?

Probably yes if any of these are true for you:

- Your "download" button opens a new tab or does nothing on iPhone — that bug is the reason this
  project exists
- You want a real Save As dialog on Chrome instead of files landing in `~/Downloads` unnamed
- You export UTF-8 CSV or XML and Excel shows mojibake — `autoBom` never worked in 2.x
- You want TypeScript types bundled rather than a stale `@types/file-saver`

Stay on `file-saver` if none of those apply. The 2.x line works fine on desktop browsers, and there is
no reason to change a working dependency. Eli Grey still owns that package and it is still the right
answer for many projects — this is an alternative, not a replacement.

### Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `autoBom` | `boolean` | `false` | Prepend a UTF-8 BOM to `text/*`, `application/xml` and `*/*+xml` blobs declaring `charset=utf-8` |
| `silent` | `boolean` | `false` | Suppress warnings; always return `undefined` |

---

## How it picks a strategy

1. **File System Access API** — `showSaveFilePicker()`. Chromium desktop. The only path that gives a real
   "Save As" dialog with a user-chosen location. Requires a user gesture.
2. **Web Share API** — `navigator.share()`. iOS and Android. The correct answer on iPhone.
3. **Anchor + `download` attribute** — the original's path. Still exactly right on desktop Firefox and Safari.
4. **Blob URL navigation** — last resort.

Detection runs **at call time**, not just at load. If the user cancels the native picker, nothing else
fires — cancelling is an answer, not a failure. If the picker fails for another reason, it falls back to
step 3 and logs why.

### Browser support

| Browser | Path used |
|---|---|
| Chrome, Edge, Opera (desktop) | File System Access API → anchor fallback |
| Firefox (desktop) | Anchor + `download` |
| Safari (macOS) | Anchor + `download` |
| Safari, Chrome (iOS / iPadOS) | Web Share API |
| Chrome, Firefox (Android) | Web Share API → anchor fallback |
| IE / legacy Edge | `msSaveOrOpenBlob` |
| macOS WebView (Electron) | Anchor path deliberately skipped |

---

## TypeScript

Types ship with the package — no `@types/` install needed.

```ts
import saveAs, { SaveAsOptions } from 'filesaver-modern';

const opts: SaveAsOptions = { autoBom: true };
saveAs(blob, 'data.csv', opts);
```

---

## Testing

```sh
npm test              # 22 tests on Node's built-in runner — no dependencies
npm run test:browser  # then open http://localhost:8899/test/browser-test.html
```

The Node suite simulates every environment the library branches on — Chromium, iOS, legacy Edge, macOS
WebView, a worker with no DOM — and asserts on observable behaviour rather than internals. The browser
suite runs against real Chromium and checks the actual bytes that would reach disk, which is how the
`autoBom` regression was caught after the fakes had hidden it.

### What has *not* been tested

Being straight about the limits of the above:

- **The iOS path has not run on a real iPhone.** It is exercised against a simulated
  `navigator.share` / `canShare`, and the fix follows the documented platform behaviour — but no
  physical device has confirmed it. If you test on iOS and it misbehaves, please open an issue; that
  is the most useful thing you could bring.
- **Safari on macOS has not been verified on hardware.** It takes the anchor path, which is the
  original's code and unchanged.
- **No automated browser matrix.** The browser suite was run manually in Chromium. There is no
  Playwright or WebDriver setup in this repo.

If you can check any of the above and tell us what happened, that is worth more than another
Node test.

---

## Credits

- **[Eli Grey](http://eligrey.com)** — the original FileSaver.js. This project would not exist without it,
  and every design decision here follows the original's.
- Everyone who filed the issues that pinpointed the real problems, especially the years-long iOS thread.

**License:** MIT — see [LICENSE](./LICENSE).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The bar is that every fix ships with a test that fails without it.

## A note on the original

If Eli wants these changes merged upstream, that would be the best outcome for everyone — they are
backwards compatible and apply cleanly against 2.x. A pull request against `eligrey/FileSaver.js` is
always welcome, from anyone.