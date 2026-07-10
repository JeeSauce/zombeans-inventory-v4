/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions are enabled by default in Next 15; keep body limit sane for photo uploads.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "placehold.co" },
      // Supabase Storage public bucket (host filled in per-project via env at runtime).
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
