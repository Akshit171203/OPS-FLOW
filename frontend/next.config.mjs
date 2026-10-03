const apiUrl = process.env.API_URL ?? 'http://localhost:4100';

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@opsflow/shared'],
  // Proxy /api to the backend so the browser sees one origin and the auth cookie is first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};
