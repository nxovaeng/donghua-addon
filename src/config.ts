import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_PATH: z.string().default('./data/aggregator.db'),
  TMDB_API_KEY: z.string().optional(),
  BANGUMI_API_URL: z.string().default('https://api.bgm.tv'),
  MEDIAFLOW_PROXY_URL: z.string().optional(),
  MEDIAFLOW_API_PASSWORD: z.string().optional(),
  MACCMS_BASE: z.string().default('https://donghuafun.com/api.php/provide/vod/at/json'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const config = configSchema.parse(process.env);

export type Config = z.infer<typeof configSchema>;
