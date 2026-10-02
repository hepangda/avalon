import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

export function createFrontendApp(root = "./dist/client") {
  const frontend = new Hono();
  frontend.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.notFound();
    await next();
    if (
      (c.res.status === 200 || c.res.status === 206) &&
      !c.res.headers.get("Content-Type")?.includes("text/html")
    ) {
      const path = c.req.path;
      if (
        path.startsWith("/assets/") ||
        path === "/favicon.ico" ||
        path === "/apple-touch-icon.png"
      ) {
        // No cookies or credentials are needed for public modules, fonts and art.
        c.header("Access-Control-Allow-Origin", "*");
        c.header("Cross-Origin-Resource-Policy", "cross-origin");
        const immutable =
          /^\/assets\/public\/[a-f0-9]{16}\//.test(path) ||
          /^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|woff2?|png|webp|svg)$/.test(
            path,
          );
        c.header(
          "Cache-Control",
          immutable
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, s-maxage=3600",
        );
      }
    }
  });
  frontend.use("*", serveStatic({ root }));
  // Never return the SPA shell (or cache a 200 HTML response) for a missing asset.
  frontend.get("/assets/*", (c) => c.notFound());
  frontend.get("/favicon.ico", (c) => c.notFound());
  frontend.get("/apple-touch-icon.png", (c) => c.notFound());
  frontend.get("*", serveStatic({ path: `${root}/index.html` }));
  return frontend;
}
