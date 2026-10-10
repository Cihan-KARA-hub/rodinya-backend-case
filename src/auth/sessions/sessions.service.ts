import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session } from './schemas/session.schema';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async create(
    sessionId: Types.ObjectId,
    userId: string,
    jti: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.sessionModel.create({
      _id: sessionId,
      userId: new Types.ObjectId(userId),
      currentJti: jti,
      expiresAt,
    });
  }

  /**
   * Swaps the session to `nextJti` if `presentedJti` is still the current one.
   * The check and the swap are one atomic update, so a refresh token can be
   * redeemed only once even under concurrent requests.
   *
   * An outdated jti on a live session means an already-used refresh token came
   * back, i.e. it was copied. The session is then deleted, logging out both the
   * thief and the real user (SPEC A1).
   *
   * @returns true if rotated; false if the token must be rejected.
   */
  async rotate(
    sessionId: string,
    userId: string,
    presentedJti: string,
    nextJti: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const rotated = await this.sessionModel
      .findOneAndUpdate(
        {
          _id: sessionId,
          userId,
          currentJti: presentedJti,
          expiresAt: { $gt: new Date() },
        },
        { currentJti: nextJti, expiresAt },
      )
      .exec();
    if (rotated) return true;

    const reused = await this.sessionModel
      .findOneAndDelete({ _id: sessionId, userId })
      .exec();
    if (reused) {
      this.logger.warn(
        `Refresh token reuse on session ${sessionId}; session revoked`,
      );
    }
    return false;
  }

  /** Used on every authenticated request (JwtStrategy). */
  async isActive(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.sessionModel
      .exists({ _id: sessionId, userId, expiresAt: { $gt: new Date() } })
      .exec();
    return session !== null;
  }

  /** Logs a user out everywhere, e.g. after their password was reset. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { deletedCount } = await this.sessionModel
      .deleteMany({ userId })
      .exec();
    return deletedCount;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessionModel.deleteOne({ _id: sessionId }).exec();
  }
}
