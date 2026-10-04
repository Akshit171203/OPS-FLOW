import { fileURLToPath } from 'node:url';

// Where the API lives. It is read when the app is BUILT: Next bakes rewrites into the build output, so in Docker
// this is a build argument (see frontend/Dockerfile) and changing it means rebuilding.
const apiUrl = process.env.API_URL ?? 'http://localhost:4100';

/** @type {import('next').NextConfig} */
export default {
  // Self-contained server output for the Docker image
  output: 'standalone',
  // In a monorepo, trace files from the repository root so the shared package is included in the output
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
  transpilePackages: ['@opsflow/shared'],
  // Hide the floating Next.js dev badge so the UI is seen as users will see it
  devIndicators: false,
  // Proxy /api to the backend so the browser sees one origin and the auth cookie is first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};
