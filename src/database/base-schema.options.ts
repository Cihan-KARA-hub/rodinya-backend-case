import { SchemaOptions } from 'mongoose';

/**
 * Shared options for every schema: timestamps, and a JSON shape that exposes
 * `id` instead of `_id`, drops `__v` and strips the given sensitive fields.
 */
export function createSchemaOptions(
  hiddenFields: string[] = [],
): SchemaOptions {
  return {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        for (const field of hiddenFields) delete ret[field];
        return ret;
      },
    },
  };
}
