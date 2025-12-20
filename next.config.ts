import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Security: Limit RSC payload size to prevent DoS attacks (CVE-2025-55184)
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb', // Limit Server Action payload size
    },
  },
  // Security headers are now handled in middleware.ts with full CSP support
  // This section provides fallback headers for static assets
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Prevent clickjacking
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // Control referrer information
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Force HTTPS
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // Restrict browser features
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // NOTE: X-XSS-Protection is intentionally removed - it's deprecated
          // CSP in middleware.ts is the modern replacement
        ],
      },
    ];
  },
};

export default nextConfig;
