'use client';

import { createAuthClient } from 'better-auth/react';

/** Same-origin Better Auth client; the session lives in an httpOnly cookie. */
export const authClient = createAuthClient();
