import {
  FALLBACK_FILE_NAME,
  MAX_FILE_NAME_LENGTH,
  sanitizeFileName,
} from './sanitize-file-name';

describe('sanitizeFileName', () => {
  it.each([
    ['plain name', 'photo.jpg', 'photo.jpg'],
    ['Turkish characters', 'fotoğraf çekimi.jpg', 'fotoğraf çekimi.jpg'],
    ['inner spaces kept', 'my  holiday.jpg', 'my  holiday.jpg'],
  ])('keeps a %s as is', (_case, input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it.each([
    ['unix traversal', '../../etc/passwd.jpg', 'passwd.jpg'],
    ['windows path', 'C:\\Users\\ali\\Desktop\\a.jpg', 'a.jpg'],
    ['mixed separators', 'x/y\\z.jpg', 'z.jpg'],
  ])('drops path segments (%s)', (_case, input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it.each([
    [
      'CR/LF (header injection)',
      'a\r\nSet-Cookie: x.jpg',
      'aSet-Cookie: x.jpg',
    ],
    ['NUL byte', 'a\u0000b.jpg', 'ab.jpg'],
    ['tab and DEL', 'a\tb\u007f.jpg', 'ab.jpg'],
  ])('removes control characters (%s)', (_case, input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('removes the right-to-left override used to fake extensions', () => {
    // Would render as "resimexe.jpg" while really ending in .exe.
    expect(sanitizeFileName('resim\u202Egpj.exe')).toBe('resimgpj.exe');
  });

  it('removes zero-width characters and the BOM', () => {
    expect(sanitizeFileName('\ufeffa\u200bb\u200d.jpg')).toBe('ab.jpg');
  });

  it('normalizes to NFC so macOS (NFD) names match', () => {
    const nfd = 'fotog\u0306raf.jpg'; // "g" + combining breve
    const result = sanitizeFileName(nfd);

    expect(result).toBe('fotoğraf.jpg');
    expect(result).toHaveLength('fotoğraf.jpg'.length);
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeFileName('  photo.jpg \n')).toBe('photo.jpg');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['a trailing separator', '../'],
    ['dots only', '..'],
    ['only invisible characters', '\u202e\u200b'],
  ])('falls back to image.jpg when the name is %s', (_case, input) => {
    expect(sanitizeFileName(input)).toBe(FALLBACK_FILE_NAME);
  });

  describe('length limit', () => {
    it('cuts long names to 255 characters, keeping the extension', () => {
      const result = sanitizeFileName('a'.repeat(1000) + '.jpg');

      expect(Array.from(result)).toHaveLength(MAX_FILE_NAME_LENGTH);
      expect(result.endsWith('.jpg')).toBe(true);
    });

    it('never splits a multi-byte character', () => {
      const result = sanitizeFileName('ğ'.repeat(300) + '.jpg');

      expect(result).toBe('ğ'.repeat(251) + '.jpg');
    });

    it('never splits an emoji (surrogate pair)', () => {
      const result = sanitizeFileName('😀'.repeat(300));

      expect(Array.from(result)).toHaveLength(MAX_FILE_NAME_LENGTH);
      expect(result).toBe('😀'.repeat(MAX_FILE_NAME_LENGTH));
    });

    it('keeps a name of exactly 255 characters', () => {
      const name = 'a'.repeat(251) + '.jpg';

      expect(sanitizeFileName(name)).toBe(name);
    });
  });
});
