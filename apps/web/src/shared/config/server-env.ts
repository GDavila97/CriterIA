import { parseServerEnv, type ServerEnv } from './server-env.schema';

let cached: ServerEnv | undefined;

/** Server-only settings, validated on first use rather than at build time. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
