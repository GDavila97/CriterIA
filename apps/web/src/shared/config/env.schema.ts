import { z } from 'zod';

// Zod probes for eval support with new Function(), which the strict CSP blocks in the browser.
z.config({ jitless: true });

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

const httpUrl = z.url({ protocol: /^https?$/ });

const flag = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : value === 'true'),
  z.boolean().default(false),
);

export const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: z.enum(['development', 'test', 'production']),
    NEXT_PUBLIC_API_URL: httpUrl,
    NEXT_PUBLIC_SENTRY_DSN: z.preprocess(
      emptyAsUndefined,
      z.url({ protocol: /^https$/ }).optional(),
    ),
    // The office view arrives in F9; until then the view switch stays hidden.
    NEXT_PUBLIC_OFFICE_VIEW: flag,
  })
  .refine(
    (env) =>
      env.NEXT_PUBLIC_APP_ENV !== 'production' || env.NEXT_PUBLIC_API_URL.startsWith('https:'),
    { path: ['NEXT_PUBLIC_API_URL'], message: 'must use https in production' },
  );

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export class EnvError extends Error {
  override name = 'EnvError';
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')} (${issue.message})`)
      .join(', ');
    throw new EnvError(`Invalid web configuration: ${problems}`);
  }
  return result.data;
}
