import * as Sentry from '@sentry/nextjs';

import { publicEnv } from '@/shared/config';
import { sentryOptions } from '@/shared/lib/sentry';

export function register() {
  const options = sentryOptions(publicEnv);
  if (options) {
    Sentry.init(options);
  }
}

export const onRequestError = Sentry.captureRequestError;
