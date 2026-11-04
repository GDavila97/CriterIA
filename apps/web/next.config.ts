import type { NextConfig } from 'next';

import './src/shared/config/env';
import { staticSecurityHeaders } from './src/shared/lib/security/headers';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: [...staticSecurityHeaders] }];
  },
};

export default nextConfig;
