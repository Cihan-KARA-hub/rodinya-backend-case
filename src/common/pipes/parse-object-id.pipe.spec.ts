import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { isObjectIdString } from '../utils/object-id';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('isObjectIdString', () => {
  it.each(['6706f1c2a4b5e8d9f0123456', '6706F1C2A4B5E8D9F0123456'])(
    'accepts 24 hex characters (%s)',
    (value) => {
      expect(isObjectIdString(value)).toBe(true);
    },
  );

  it.each([
    ['a 12-char string mongoose would accept', 'aaaaaaaaaaaa'],
    ['too short', '6706f1c2a4b5e8d9f012345'],
    ['too long', '6706f1c2a4b5e8d9f01234567'],
    ['a non-hex character', '6706f1c2a4b5e8d9f012345g'],
    ['surrounding spaces', ' 6706f1c2a4b5e8d9f0123456 '],
    ['a traversal', '../../etc/passwd'],
    ['empty', ''],
    ['a number', 123],
    ['undefined', undefined],
  ])('rejects %s', (_case, value) => {
    expect(isObjectIdString(value)).toBe(false);
  });
});

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('converts a valid id to Types.ObjectId', () => {
    const id = '6706f1c2a4b5e8d9f0123456';

    const result = pipe.transform(id);

    expect(result).toBeInstanceOf(Types.ObjectId);
    expect(result.toString()).toBe(id);
  });

  it.each(['abc', 'aaaaaaaaaaaa', 'my', ''])('throws 400 for "%s"', (value) => {
    expect(() => pipe.transform(value)).toThrow(
      new BadRequestException('Invalid id'),
    );
  });
});
