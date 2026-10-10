export const MAX_FILE_NAME_LENGTH = 255;
export const FALLBACK_FILE_NAME = 'image.jpg';

/** C0 and C1 control characters, incl. NUL, TAB, CR/LF and DEL. */
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * Invisible characters that change how a name is displayed without being seen:
 * zero-width chars and LRM/RLM (200B-200F), bidi embeddings and overrides
 * (202A-202E), bidi isolates (2066-2069) and the BOM (FEFF). U+202E, the
 * right-to-left override, can make a name ending in ".exe" display as ".jpg".
 *
 * Code points are written as numbers on purpose: these characters must never
 * appear literally in source code.
 */
function isInvisible(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

/**
 * Turns a client-supplied original file name into a safe display name
 * (SPEC A9). It is only a label: files are stored as <uuid>.jpg, so this never
 * touches the disk path. Content-Disposition encoding at download is a second,
 * separate layer.
 */
export function sanitizeFileName(raw: string): string {
  let name = raw.normalize('NFC');

  // Keep only the last path segment, for both separators.
  name = name.split(/[/\\]/).pop() ?? '';

  name = Array.from(name)
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return !isControl(cp) && !isInvisible(cp);
    })
    .join('')
    .trim();

  if (name === '' || /^\.+$/.test(name)) return FALLBACK_FILE_NAME;

  return truncate(name, MAX_FILE_NAME_LENGTH);
}

/**
 * Cuts to `max` characters, counted as code points so a multi-byte character
 * or an emoji is never split, and keeps the extension.
 */
function truncate(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;

  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
  if (ext.length === 0 || ext.length >= max) {
    return chars.slice(0, max).join('');
  }

  const base = Array.from(name.slice(0, dot));
  return base.slice(0, max - ext.length).join('') + ext.join('');
}
