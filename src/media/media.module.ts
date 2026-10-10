import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { EnvVars } from '../config/env.validation';
import { UsersModule } from '../users/users.module';
import { MediaStorageService } from './media-storage.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Media, MediaSchema } from './schemas/media.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Media.name, schema: MediaSchema }]),
    UsersModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        // Validate in memory first, write to disk only once it passed (SPEC A9).
        storage: memoryStorage(),
        limits: {
          // Multer stops reading past this and Nest maps it to 413 (SPEC A8).
          fileSize: config.get('MAX_FILE_SIZE', { infer: true }),
          files: 1,
        },
        // Read the original file name as UTF-8; the default (latin1) turns
        // "fotoğraf.jpg" into "fotoÄŸraf.jpg".
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaStorageService],
})
export class MediaModule {}
