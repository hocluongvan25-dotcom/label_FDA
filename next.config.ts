import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
  outputFileTracingIncludes: { "/api/v1/*": ["./public/fonts/*.ttf"] },
  serverExternalPackages: [
    "tesseract.js",
    "sharp",
    "@napi-rs/canvas",
    "pdfjs-dist",
  ],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
