import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';
import { isObjectIdString } from '../utils/object-id';

/**
 * Validates a route param as a 24-hex ObjectId (400 otherwise) and converts it
 * to Types.ObjectId. Services take Types.ObjectId, so forgetting this pipe on a
 * route is a compile error rather than a Mongoose CastError (500) at runtime.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<
  unknown,
  Types.ObjectId
> {
  transform(value: unknown): Types.ObjectId {
    if (!isObjectIdString(value)) {
      throw new BadRequestException('Invalid id');
    }
    return new Types.ObjectId(value);
  }
}
