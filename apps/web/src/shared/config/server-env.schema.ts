import { z } from 'zod';

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyAsUndefined, schema.optional());

export const EMAIL_PROVIDERS = ['none', 'smtp', 'resend'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: z.enum(['development', 'test', 'production']),
    BETTER_AUTH_SECRET: z.string().min(32, 'must have at least 32 characters'),
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    AUTH_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // The API checks both claims; they default to the web origin.
    AUTH_JWT_ISSUER: optional(z.string().min(1)),
    AUTH_JWT_AUDIENCE: optional(z.string().min(1)),
    EMAIL_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(EMAIL_PROVIDERS).default('none')),
    EMAIL_FROM: optional(z.string().min(3)),
    SMTP_URL: optional(z.url({ protocol: /^smtps?$/ })),
    RESEND_API_KEY: optional(z.string().min(1)),
    GITHUB_CLIENT_ID: optional(z.string().min(1)),
    GITHUB_CLIENT_SECRET: optional(z.string().min(1)),
    GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
    // End-to-end tests only: GitHub's server-side calls go to a local stub.
    GITHUB_STUB_URL: optional(z.url({ protocol: /^http$/ })),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, message: string) => {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message });
    };
    if (env.EMAIL_PROVIDER !== 'none') require('EMAIL_FROM', 'required to send email');
    if (env.EMAIL_PROVIDER === 'smtp') require('SMTP_URL', 'required with EMAIL_PROVIDER=smtp');
    if (env.EMAIL_PROVIDER === 'resend') {
      require('RESEND_API_KEY', 'required with EMAIL_PROVIDER=resend');
    }
    for (const [id, secret] of [
      ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ] as const) {
      if (Boolean(env[id]) !== Boolean(env[secret])) {
        ctx.addIssue({ code: 'custom', path: [secret], message: `set together with ${id}` });
      }
    }
    if (env.GITHUB_STUB_URL && env.NEXT_PUBLIC_APP_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['GITHUB_STUB_URL'],
        message: 'only allowed with NEXT_PUBLIC_APP_ENV=test',
      });
    }
    if (env.NEXT_PUBLIC_APP_ENV === 'production' && !env.BETTER_AUTH_URL.startsWith('https:')) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'must use https in production',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ServerEnvError extends Error {
  override name = 'ServerEnvError';
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    // Only names and rules: values may be secrets.
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')} (${issue.message})`)
      .join(', ');
    throw new ServerEnvError(`Invalid server configuration: ${problems}`);
  }
  return result.data;
}
