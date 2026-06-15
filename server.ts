import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { initSocketServer } from './src/lib/socket/server/io';
import { routing } from './src/i18n/routing';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST ?? '0.0.0.0';
const port = parseInt(process.env.PORT ?? '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const LOCALES = routing.locales;
const DEFAULT_LOCALE = routing.defaultLocale;

/**
 * Next.js middleware does NOT run under a fully custom server, so we perform
 * next-intl's locale-prefix redirect here: any page request whose path lacks a
 * known locale prefix is redirected to /<defaultLocale><path>. API routes, the
 * Socket.IO endpoint, Next internals, and static files are passed through.
 */
function localeRedirect(pathname: string): string | null {
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/socket.io') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/_vercel') ||
    pathname.includes('.')
  ) {
    return null;
  }
  const hasLocale = LOCALES.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );
  if (hasLocale) return null;
  const suffix = pathname === '/' ? '' : pathname;
  return `/${DEFAULT_LOCALE}${suffix}`;
}

async function main() {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url ?? '', true);
      const pathname = parsedUrl.pathname ?? '/';

      const redirectTo = localeRedirect(pathname);
      if (redirectTo) {
        const search = parsedUrl.search ?? '';
        res.statusCode = 307;
        res.setHeader('Location', redirectTo + search);
        res.end();
        return;
      }

      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Attach Socket.IO to the same HTTP server (same process, same port).
  initSocketServer(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(`> Avalon ready on http://${hostname}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error('Fatal server error', err);
  process.exit(1);
});
