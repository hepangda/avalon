import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma client must stay external to the server bundle.
  serverExternalPackages: ['@prisma/client', 'prisma'],
};

export default withNextIntl(nextConfig);
