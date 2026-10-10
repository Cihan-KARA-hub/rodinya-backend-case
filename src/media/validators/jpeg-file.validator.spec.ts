import { JpegFileValidator } from './jpeg-file.validator';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const file = (mimetype: string, buffer: Buffer) =>
  ({ mimetype, buffer, size: buffer.length }) as Express.Multer.File;

describe('JpegFileValidator', () => {
  const validator = new JpegFileValidator();

  it('accepts JPEG bytes declared as image/jpeg', () => {
    expect(validator.isValid(file('image/jpeg', JPEG_BYTES))).toBe(true);
  });

  it('rejects a PNG', () => {
    expect(validator.isValid(file('image/png', PNG_BYTES))).toBe(false);
  });

  it('rejects PNG bytes disguised as image/jpeg (renamed .png → .jpg)', () => {
    expect(validator.isValid(file('image/jpeg', PNG_BYTES))).toBe(false);
  });

  it('rejects JPEG bytes declared with another mimetype', () => {
    expect(validator.isValid(file('image/png', JPEG_BYTES))).toBe(false);
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['shorter than the magic', Buffer.from([0xff, 0xd8])],
  ])('rejects a buffer that is %s', (_case, buffer) => {
    expect(validator.isValid(file('image/jpeg', buffer))).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['without a buffer', { mimetype: 'image/jpeg' }],
    ['an array of files', [file('image/jpeg', JPEG_BYTES)]],
  ])('rejects input that is %s', (_case, input) => {
    expect(validator.isValid(input)).toBe(false);
  });

  it('explains the rejection', () => {
    expect(validator.buildErrorMessage()).toBe('File must be a JPEG image');
  });
});
