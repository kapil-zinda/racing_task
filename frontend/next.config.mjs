/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // When building for the mobile app (Capacitor) we emit a static export
  // into `out/`. Normal web dev/build/start is unaffected.
  ...(process.env.BUILD_TARGET === "app"
    ? { output: "export", images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
