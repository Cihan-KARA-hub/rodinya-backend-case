import { FileValidator } from '@nestjs/common';

/** Every JPEG starts with the SOI marker FF D8 followed by another marker (FF). */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/**
 * SPEC A7: the client-declared mimetype must be image/jpeg AND the content
 * must start with the JPEG magic bytes. The mimetype alone is just a header
 * the client chose; the bytes catch a PNG renamed to .jpg.
 */
export class JpegFileValidator extends FileValidator {
  constructor() {
    super({});
  }

  isValid(file?: unknown): boolean {
    if (!isUploadedFile(file)) return false;
    return (
      file.mimetype === 'image/jpeg' &&
      JPEG_MAGIC.every((byte, i) => file.buffer[i] === byte)
    );
  }

  buildErrorMessage(): string {
    return 'File must be a JPEG image';
  }
}

function isUploadedFile(file: unknown): file is Express.Multer.File {
  return (
    typeof file === 'object' &&
    file !== null &&
    'buffer' in file &&
    Buffer.isBuffer(file.buffer) &&
    'mimetype' in file
  );
}
