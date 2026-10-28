/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Local bundled WebP previews need no runtime resizer or image-cache writes.
  images: { unoptimized: process.env.OPEN_BACKUP_UI_DESKTOP_BUILD === '1' },
  // Using top-level turbopack key as experimental.turbo is deprecated
  turbopack: {
    root: __dirname,
  }
};

module.exports = nextConfig;
