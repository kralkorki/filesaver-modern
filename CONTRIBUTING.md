# Contributing

Thanks for considering it. This is a small library with a wide blast radius — a bug here breaks
downloads for every app that uses it — so the bar for a change is that it is *proven*, not just
plausible.

## Ground rules

1. **The API does not change.** `saveAs(blob, name, opts)` must keep working exactly as it does in
   [file-saver 2.x](https://github.com/eligrey/FileSaver.js) unless the change is a major version.
   Returning a Promise where `undefined` used to be returned is allowed, because existing callers
   ignore the return value.
2. **Every fix needs a test that fails without it.** If you cannot make it fail first, you have not
   proven there was a bug.
3. **Test real behaviour.** Assert on what the library *did* — the bytes written, the filename used,
   the strategy chosen — not on internal function calls.

## Getting set up

```sh
git clone https://github.com/<owner>/filesaver-modern
cd filesaver-modern
npm test
```

No install step and no dependencies. The test runner is Node's built-in one.

## Running the browser tests

```sh
npm run test:browser
# open http://localhost:8899/test/browser-test.html
```

Click each button and confirm every line reports PASS. The browser suite is the one that catches
things the Node suite cannot, because the Node suite simulates the DOM and the real Chromium does not
forgive a fake.

## Before you open a pull request

```sh
npm test        # 22 tests must pass
npm run build   # then commit dist/ if it changed
```

CI checks that `dist/` matches the source. If you forget to build, the build fails loudly rather than
shipping something stale.

## Reporting a bug

A bug report is much more useful with:

- Your browser and version, and whether you are on desktop, iOS or Android
- Whether `showSaveFilePicker`, `navigator.share` and `navigator.canShare` exist in your browser —
  the page's console can tell you, and it decides which code path you hit
- A minimal reproduction, preferably as a CodePen

## Licence

By contributing you agree that your work is licensed under the MIT licence, the same as the original.