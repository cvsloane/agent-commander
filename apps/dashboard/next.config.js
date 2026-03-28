const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  transpilePackages: ['@agent-command/schema'],

  async redirects() {
    return [
      // Redirect /workshop to /visualizer (permanent)
      {
        source: '/workshop',
        destination: '/visualizer',
        permanent: true,
      },
      // Redirect /workshop/* deep links to /visualizer/*
      {
        source: '/workshop/:path*',
        destination: '/visualizer/:path*',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
