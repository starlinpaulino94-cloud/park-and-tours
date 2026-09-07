import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placeholders.io",
      }
    ]
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  allowedDevOrigins: ["*"],
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];

    // Only cache-control headers here. CSP and CORS are handled exclusively in middleware.ts
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/.git/**',
          '**/playwright-screenshots/**',
          '**/.playwright-mcp/**',
          '**/playwright-dev-server.log',
          '**/npm-start.log',
          '**/frontend.log',
          '**/project-docs/**',
        ],
      };
    }
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // La subida de source maps solo ocurre con SENTRY_AUTH_TOKEN presente
  // (CI/Vercel). Sin token, el plugin la salta y el build no falla.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
  },
});
