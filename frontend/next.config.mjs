import { fileURLToPath } from 'node:url';

// Where the API lives. It is read when the app is BUILT: Next bakes rewrites into the build output, so in Docker
// this is a build argument (see frontend/Dockerfile) and changing it means rebuilding.
const apiUrl = process.env.API_URL ?? 'http://localhost:4100';

/**
 * Headers every page should carry. The CSP is the strict part: nothing may be framed by another site, loaded
 * from another origin, or submitted to one. `script-src` still allows inline scripts because Next injects
 * small bootstrap scripts without a nonce, and `style-src` allows inline styles for the same reason; that is
 * the usual trade-off for a Next app without a nonce middleware. Development also needs eval for hot reload,
 * so the CSP is only applied to production builds.
 */
export function securityHeaders(production = process.env.NODE_ENV === 'production') {
  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
  if (production) {
    headers.push({
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        // the live-update socket is same-origin, over ws:// in development and wss:// when served over https
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; '),
    });
  }
  return headers;
}

/** @type {import('next').NextConfig} */
const config = {
  // Self-contained server output for the Docker image
  output: 'standalone',
  // In a monorepo, trace files from the repository root so the shared package is included in the output
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
  transpilePackages: ['@opsflow/shared'],
  // Hide the floating Next.js dev badge so the UI is seen as users will see it
  devIndicators: false,
  // Security headers for every page. The API sends its own (helmet); these cover the pages Next serves.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  // Proxy /api to the backend so the browser sees one origin and the auth cookie is first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
