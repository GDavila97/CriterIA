import type { NextConfig } from 'next';

import './src/shared/config/env';
import { staticSecurityHeaders } from './src/shared/lib/security/headers';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: [...staticSecurityHeaders] }];
  },
  async redirects() {
    // The page was renamed; old links and bookmarks keep working.
    return [{ source: '/corrida/:path*', destination: '/analisis/:path*', permanent: true }];
  },
};

export default nextConfig;
