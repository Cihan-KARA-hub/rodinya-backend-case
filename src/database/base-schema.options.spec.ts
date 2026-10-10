import { Schema, Types, model } from 'mongoose';
import { createSchemaOptions } from './base-schema.options';

describe('createSchemaOptions', () => {
  const ThingSchema = new Schema(
    { name: String, secret: String },
    createSchemaOptions(['secret']),
  );
  const Thing = model('Thing', ThingSchema);

  it('enables timestamps', () => {
    expect(ThingSchema.path('createdAt')).toBeDefined();
    expect(ThingSchema.path('updatedAt')).toBeDefined();
  });

  it('serializes _id as id and drops __v and hidden fields', () => {
    const _id = new Types.ObjectId();
    const json = new Thing({ _id, name: 'a', secret: 's' }).toJSON();

    expect(json).toMatchObject({ id: _id.toString(), name: 'a' });
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
    expect(json).not.toHaveProperty('secret');
  });
});
