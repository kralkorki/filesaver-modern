/**
 * Build script — zero dependencies.
 *
 * Produces the four files npm consumers actually need from the single UMD
 * source in src/: a browser global, a CommonJS build, an ES module build, and
 * TypeScript declarations. Keeping this dependency-free means `npm install`
 * pulls nothing, which matters for a library that other people's builds depend
 * on.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const srcPath = path.join(root, 'src', 'FileSaver.js');
const distDir = path.join(root, 'dist');

const src = fs.readFileSync(srcPath, 'utf8');

fs.mkdirSync(distDir, { recursive: true });

const BANNER = [
  '/*!',
  ' * FileSaver.js — community-maintained continuation',
  ' *',
  ' * Original work by Eli Grey (http://eligrey.com) — MIT licensed.',
  ' * See LICENSE for the full notice.',
  ' *',
  ' * This is a drop-in modernisation: same saveAs(blob, name, opts) API,',
  ' * with working iOS/Web Share support, a real Chromium save dialog, and no',
  ' * synchronous XHR.',
  ' */',
  ''
].join('\n');

/**
 * Strip the UMD tail from the source so the wrappers can be appended cleanly.
 * Everything above that tail (all the real logic) is kept verbatim, so there is
 * exactly one implementation of the behaviour.
 */
const UMD_TAIL = /saveAs\.saveAs = saveAs;[\s\S]*$/;

const coreMatch = src.match(UMD_TAIL);
if (!coreMatch) {
  console.error('build: could not find the UMD tail in src/FileSaver.js');
  console.error('The build expects `saveAs.saveAs = saveAs;` near the end of the file.');
  process.exit(1);
}

const core = src.slice(0, coreMatch.index).trimEnd();

// Strip the source's own module/window export block — the wrappers re-add them.
const coreWithoutExports = core.replace(
  /if \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\n\}\n?/,
  ''
).replace(
  /if \(hasWindow\) \{\n  _global\.saveAs = saveAs;\n\}\n?/,
  ''
).trimEnd();

const files = {
  // Browser global: <script src> gives window.saveAs, and the UMD footer keeps
  // CommonJS interop for bundlers that pick this file up.
  'FileSaver.js': `${BANNER}
${coreWithoutExports}

saveAs.saveAs = saveAs;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = saveAs;
}
if (hasWindow) {
  _global.saveAs = saveAs;
}
`,

  // CommonJS
  'FileSaver.cjs': `${BANNER}
'use strict';

${coreWithoutExports}

saveAs.saveAs = saveAs;
if (hasWindow) {
  _global.saveAs = saveAs;
}
module.exports = saveAs;
module.exports.default = saveAs;
`,

  // ES module. Named .mjs because the package itself is CommonJS: without the
  // extension Node cannot tell this file is ESM without reparsing it, and it
  // warns about the mismatch on every import.
  'FileSaver.mjs': `${BANNER}
${coreWithoutExports}

saveAs.saveAs = saveAs;
if (hasWindow) {
  _global.saveAs = saveAs;
}
export default saveAs;
export { saveAs };
`
};

for (const [name, contents] of Object.entries(files)) {
  fs.writeFileSync(path.join(distDir, name), contents, 'utf8');
  const kb = (Buffer.byteLength(contents) / 1024).toFixed(1);
  console.log(`built dist/${name} (${kb} kB)`);
}

// TypeScript declarations, hand-written to match the real behaviour.
const dts = `${BANNER.replace('/*!', '/**')}@typedef {Blob|File|ArrayBuffer|string} SaveableInput
 */

export interface SaveAsOptions {
  /**
   * Prepend a UTF-8 BOM to text-ish blobs (text/*, application/xml, *\\/*+xml)
   * that declare charset=utf-8. Required for Excel to read UTF-8 CSV correctly.
   *
   * @default false
   */
  autoBom?: boolean;
  /**
   * Suppress console warnings and return undefined always, matching the
   * behaviour of file-saver 2.x exactly.
   *
   * @default false
   */
  silent?: boolean;
}

/**
 * Save a Blob, File or URL client-side.
 *
 * Strategy cascade, in order:
 *   1. File System Access API (showSaveFilePicker) — Chromium desktop
 *   2. Web Share API (navigator.share) — iOS and Android
 *   3. Anchor element with the \`download\` attribute — every desktop browser
 *   4. Blob URL navigation — last resort
 *
 * @param input   The Blob/File to save, or a URL string to download.
 * @param name    Filename. Inferred from a File's name or a URL's path when omitted.
 * @param options See {@link SaveAsOptions}. A boolean is accepted for backwards
 *                compatibility and treated as \`autoBom\`.
 * @returns A Promise when an async strategy (picker or share) is used, otherwise
 *          undefined. Always safe to ignore — existing callers do.
 */
declare function saveAs(
  input: SaveableInput | null | undefined,
  name?: string,
  options?: SaveAsOptions | boolean
): Promise<void> | undefined;

declare namespace saveAs {
  export { saveAs, SaveAsOptions, SaveableInput };
}

export default saveAs;
export { saveAs };
export type { SaveAsOptions, SaveableInput };
`;

fs.writeFileSync(path.join(distDir, 'FileSaver.d.ts'), dts, 'utf8');
console.log(`built dist/FileSaver.d.ts (${(Buffer.byteLength(dts) / 1024).toFixed(1)} kB)`);

console.log('build complete');