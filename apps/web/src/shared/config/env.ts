import { parsePublicEnv } from './env.schema';

// Each variable is referenced literally so Next.js can inline it into the client bundle.
export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_OFFICE_VIEW: process.env.NEXT_PUBLIC_OFFICE_VIEW,
});
