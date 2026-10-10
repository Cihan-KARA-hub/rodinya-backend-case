import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';

/**
 * Loads .env and validates it (fails fast on missing values). Shared by the
 * app and the seed scripts so both see exactly the same configuration.
 */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  validationSchema: envValidationSchema,
  validationOptions: { abortEarly: false },
});
