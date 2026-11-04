import * as Sentry from '@sentry/nextjs';

import { publicEnv } from '@/shared/config';
import { sentryOptions } from '@/shared/lib/sentry';

const options = sentryOptions(publicEnv);
if (options) {
  Sentry.init(options);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
