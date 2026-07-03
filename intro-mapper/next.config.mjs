/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The warm-intro core logic lives in the `@whop-copilot/shared` workspace
  // package (../shared). It ships as TypeScript source (main: src/index.ts), so
  // transpilePackages tells Next to compile it as part of this app's build.
  // This resolves via the workspace symlink, so it works both locally and on
  // Vercel (Root Directory = intro-mapper) with no extra configuration.
  transpilePackages: ["@whop-copilot/shared"],
};

export default nextConfig;
