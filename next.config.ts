import type { NextConfig } from 'next';

/**
 * NEXORA OFFICE 3D — Next.js configuration.
 *
 * The 3D scene is client-only; there is no remote image or asset host,
 * because every architectural asset in this project is generated
 * procedurally from application code (see docs/ASSET-PROVENANCE.md).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev-server previews are proxied by the hosting sandbox on *.e2b.app.
  allowedDevOrigins: ['*.e2b.app', 'localhost:3000', '127.0.0.1:3000'],
  experimental: {
    // Keep the heavy 3D bundle optimised for the client boundary.
    optimizePackageImports: ['three'],
  },
};

export default nextConfig;
