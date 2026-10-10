import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { createSchemaOptions } from '../../../database/base-schema.options';
import { User } from '../../../users/schemas/user.schema';

/**
 * One login on one device (SPEC A1). `_id` is the `sid` claim in both tokens.
 * Only the id of the current refresh token is stored, never the token itself.
 */
@Schema(createSchemaOptions())
export class Session {
  // Schema.Types.ObjectId, not Types.ObjectId: the latter is the value class and
  // would make this a Mixed path, so string ids in queries would not be cast.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  /** `jti` of the only refresh token this session still accepts. */
  @Prop({ required: true })
  currentJti!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;

export const SessionSchema = SchemaFactory.createForClass(Session);

// TTL: MongoDB deletes a session once `expiresAt` passes. Its sweeper runs about
// once a minute, so reads also check `expiresAt` themselves.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
