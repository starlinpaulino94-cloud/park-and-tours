import path from "path";
import type { NextConfig } from "next";

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
    /**
     * ⭐⭐ SOURCE TAGS FOR THE VISUAL EDITOR — see scripts/totalum-source-tags.js.
     *
     * Every JSX element in `src/` gets `data-tlm-loc="file:line:col"`, which is what
     * lets the platform's visual editor edit the exact element the user clicked instead
     * of inferring it from classes and text (and sometimes refusing, because a `cn()`
     * merge or three identical cards are genuinely ambiguous from the outside).
     *
     * ⚠️ `enforce: "pre"` IS LOAD-BEARING: the transform reads TSX and must run BEFORE
     * next-swc compiles it away. Set `TOTALUM_SOURCE_TAGS=0` to turn it off — the
     * cloudflare deploy build does, so a published app carries no file paths.
     */
    config.module.rules.push({
      test: /\.(tsx|jsx)$/,
      include: path.join(process.cwd(), "src"),
      exclude: /node_modules/,
      enforce: "pre",
      use: [{ loader: path.join(process.cwd(), "scripts", "totalum-source-tags.js") }],
    });

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

export default nextConfig;

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
// conditionally initialize based on environment variable
if (process.env.DISABLE_OPENNEXT !== 'true') {
  try {
    const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
    initOpenNextCloudflareForDev();
  } catch (error) {
    console.warn("OpenNext Cloudflare dev initialization failed:", error instanceof Error ? error.message : String(error));
    console.warn("Falling back to standard Next.js development mode");
  }
}
