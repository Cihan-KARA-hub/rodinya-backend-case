import { Types, model } from 'mongoose';
import { Media, MediaSchema } from './media.schema';

describe('MediaSchema', () => {
  const MediaModel = model(Media.name, MediaSchema);
  const valid = () => ({
    ownerId: new Types.ObjectId(),
    fileName: 'photo.jpg',
    filePath: 'abc/def.jpg',
    mimeType: 'image/jpeg',
    size: 123,
  });

  it('defaults allowedUserIds to an empty list', () => {
    expect(new MediaModel(valid()).allowedUserIds).toEqual([]);
  });

  it('requires owner, names, type and size', () => {
    const errors = new MediaModel({}).validateSync()?.errors;

    for (const field of [
      'ownerId',
      'fileName',
      'filePath',
      'mimeType',
      'size',
    ]) {
      expect(errors).toHaveProperty(field);
    }
  });

  it('types ownerId and allowedUserIds as ObjectId (not Mixed)', () => {
    expect(MediaSchema.path('ownerId').instance).toBe('ObjectId');
    expect(MediaSchema.path('allowedUserIds').instance).toBe('Array');
    expect(
      (
        MediaSchema.path('allowedUserIds') as unknown as {
          caster: { instance: string };
        }
      ).caster.instance,
    ).toBe('ObjectId');
  });

  it('indexes owner + newest first, and allowedUserIds', () => {
    const indexes = MediaSchema.indexes().map(([fields]) => fields);

    expect(indexes).toContainEqual({ ownerId: 1, createdAt: -1 });
    expect(indexes).toContainEqual({ allowedUserIds: 1 });
  });

  it('never serializes filePath', () => {
    const json = new MediaModel(valid()).toJSON();

    expect(json).not.toHaveProperty('filePath');
    expect(json).toHaveProperty('fileName', 'photo.jpg');
  });
});
