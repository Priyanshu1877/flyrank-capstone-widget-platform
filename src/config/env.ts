import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5000'),
  DATABASE_URL: z
    .string()
    .default('postgresql://postgres:postgres_dev_password@localhost:5432/flyrank_widgets'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().default('postgres_dev_password'),
  POSTGRES_DB: z.string().default('flyrank_widgets'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  JWT_SECRET: z.string().default('change-this-to-a-secure-secret-in-production'),
  WIDGET_BASE_URL: z.string().default('http://localhost:4000'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  throw new Error('Environment variable validation failed');
}

export const env = parsedEnv.data;
export type Env = z.infer<typeof envSchema>;
