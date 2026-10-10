import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

const DUPLICATE_KEY = 11000;

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  /**
   * Relies on the unique email index rather than a lookup first, so two
   * concurrent registrations with the same email still yield one 409.
   */
  async create(email: string, passwordHash: string): Promise<UserDocument> {
    try {
      return await this.userModel.create({ email, passwordHash });
    } catch (err) {
      if (err instanceof mongo.MongoServerError && err.code === DUPLICATE_KEY) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
  }

  /** The only lookup that loads passwordHash; meant for login. */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }
}
