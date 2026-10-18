/**
 * FileSaver.js — community-maintained continuation
 *
 * Original work by Eli Grey (http://eligrey.com) — MIT licensed.
 * See LICENSE for the full notice.
 *
 * This is a drop-in modernisation: same saveAs(blob, name, opts) API,
 * with working iOS/Web Share support, a real Chromium save dialog, and no
 * synchronous XHR.
 */
@typedef {Blob|File|ArrayBuffer|string} SaveableInput
 */

export interface SaveAsOptions {
  /**
   * Prepend a UTF-8 BOM to text-ish blobs (text/*, application/xml, *\/*+xml)
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
 *   3. Anchor element with the `download` attribute — every desktop browser
 *   4. Blob URL navigation — last resort
 *
 * @param input   The Blob/File to save, or a URL string to download.
 * @param name    Filename. Inferred from a File's name or a URL's path when omitted.
 * @param options See {@link SaveAsOptions}. A boolean is accepted for backwards
 *                compatibility and treated as `autoBom`.
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
