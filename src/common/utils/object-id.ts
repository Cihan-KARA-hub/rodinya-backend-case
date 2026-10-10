/**
 * The only form an ObjectId takes in URLs and JSON: 24 hex characters.
 * Stricter than mongoose's Types.ObjectId.isValid, which also accepts any
 * 12-character string (e.g. "aaaaaaaaaaaa").
 */
export const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}
