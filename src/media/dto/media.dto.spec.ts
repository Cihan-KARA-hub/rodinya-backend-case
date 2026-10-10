import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import type { AuthUser } from '../../auth/auth.types';
import { Role } from '../../users/schemas/user.schema';
import { MediaDocument } from '../schemas/media.schema';
import { MediaResponseDto } from './media-response.dto';
import { PaginationQueryDto } from './pagination-query.dto';

describe('PaginationQueryDto', () => {
  const parse = async (query: Record<string, string>) => {
    const dto = plainToInstance(PaginationQueryDto, query);
    const errors = await validate(dto);
    return { dto, failed: errors.map((e) => e.property) };
  };

  it('defaults to page 1, limit 20', async () => {
    await expect(parse({})).resolves.toEqual({
      dto: expect.objectContaining({ page: 1, limit: 20 }) as unknown,
      failed: [],
    });
  });

  it('converts query strings to numbers', async () => {
    const { dto, failed } = await parse({ page: '3', limit: '100' });

    expect(failed).toEqual([]);
    expect(dto).toMatchObject({ page: 3, limit: 100 });
  });

  it.each([
    ['page 0', { page: '0' }, 'page'],
    ['negative page', { page: '-1' }, 'page'],
    ['non-numeric page', { page: 'abc' }, 'page'],
    ['fractional page', { page: '1.5' }, 'page'],
    ['limit 0', { limit: '0' }, 'limit'],
    ['limit over 100', { limit: '101' }, 'limit'],
    ['non-numeric limit', { limit: 'ten' }, 'limit'],
  ])('rejects %s', async (_case, query, field) => {
    await expect(parse(query)).resolves.toMatchObject({ failed: [field] });
  });
});

describe('MediaResponseDto.from', () => {
  const ownerId = new Types.ObjectId();
  const allowed = new Types.ObjectId();
  const media = {
    _id: new Types.ObjectId(),
    ownerId,
    fileName: 'photo.jpg',
    filePath: `${ownerId.toString()}/secret.jpg`,
    mimeType: 'image/jpeg',
    size: 10,
    allowedUserIds: [allowed],
    createdAt: new Date(),
  } as unknown as MediaDocument;

  const viewer = (id: string, role = Role.User): AuthUser => ({
    id,
    email: 'x@test.com',
    role,
    sessionId: 's',
  });

  it('never includes filePath', () => {
    const dto = MediaResponseDto.from(media, viewer(ownerId.toString()));

    expect(dto).not.toHaveProperty('filePath');
    expect(Object.keys(dto).sort()).toEqual([
      'allowedUserIds',
      'createdAt',
      'fileName',
      'id',
      'mimeType',
      'ownerId',
      'size',
    ]);
  });

  it('shows allowedUserIds to the owner', () => {
    expect(
      MediaResponseDto.from(media, viewer(ownerId.toString())).allowedUserIds,
    ).toEqual([allowed.toString()]);
  });

  it('hides allowedUserIds from an admin who is not the owner (SPEC A3)', () => {
    const admin = viewer(new Types.ObjectId().toString(), Role.Admin);

    expect(MediaResponseDto.from(media, admin)).not.toHaveProperty(
      'allowedUserIds',
    );
  });

  it('hides allowedUserIds from anyone else, including allowed users', () => {
    const dto = MediaResponseDto.from(media, viewer(allowed.toString()));

    expect(dto).not.toHaveProperty('allowedUserIds');
  });
});
