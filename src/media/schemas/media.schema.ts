import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { createSchemaOptions } from '../../database/base-schema.options';
import { User } from '../../users/schemas/user.schema';

// filePath is also stripped from toJSON, as a backstop to the response DTO (SPEC A9).
@Schema(createSchemaOptions(['filePath']))
export class Media {
  // Schema.Types.ObjectId (not Types.ObjectId, which would make a Mixed path).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  ownerId!: Types.ObjectId;

  /** Sanitized original name, for display and Content-Disposition only. */
  @Prop({ required: true })
  fileName!: string;

  /** `<userId>/<uuid>.jpg`, relative to UPLOAD_DIR. Never returned by the API. */
  @Prop({ required: true })
  filePath!: string;

  @Prop({ required: true })
  mimeType!: string;

  /** Bytes. */
  @Prop({ required: true })
  size!: number;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: User.name }],
    default: [],
    index: true,
  })
  allowedUserIds!: Types.ObjectId[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type MediaDocument = HydratedDocument<Media>;

export const MediaSchema = SchemaFactory.createForClass(Media);

// Serves GET /media/my: filter by owner, newest first. As a prefix it also
// covers plain ownerId lookups, so no separate ownerId index is needed.
MediaSchema.index({ ownerId: 1, createdAt: -1 });
