import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { createSchemaOptions } from '../../database/base-schema.options';

export enum Role {
  User = 'user',
  Admin = 'admin',
}

@Schema(createSchemaOptions(['passwordHash']))
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  // Not selected by default; queries that need it (login) ask for it explicitly.
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, enum: Role, default: Role.User })
  role!: Role;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);
