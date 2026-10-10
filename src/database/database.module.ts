import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { EnvVars } from '../config/env.validation';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => {
        const logger = new Logger('Database');
        return {
          uri: config.get('MONGO_URI', { infer: true }),
          // Indexes are declared on the schemas; no migration tooling (SPEC A18).
          autoIndex: true,
          connectionFactory: (connection: Connection) => {
            connection.on('connected', () => logger.log('MongoDB connected'));
            connection.on('disconnected', () =>
              logger.warn('MongoDB disconnected'),
            );
            return connection;
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
