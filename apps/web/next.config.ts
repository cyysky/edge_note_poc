import type { NextConfig } from 'next';

/** Server-side API origin; the browser reaches the API through the rewrite below. */
const apiOrigin = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@displayer/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default config;
