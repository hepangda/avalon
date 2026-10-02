import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFrontendApp } from "./static-files";

const root = mkdtempSync(join(tmpdir(), "avalon-static-"));
const image = "/assets/public/0123456789abcdef/assets/game/card.webp";
for (const path of [
  image,
  "/assets/index-ABcd1234.js",
  "/assets/game/card.webp",
  "/index.html",
]) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(
    join(root, path),
    path.endsWith(".html") ? "<html>app</html>" : "asset",
  );
}
const app = createFrontendApp(root);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("static origin caching", () => {
  it("allows cross-origin modules and caches content-addressed assets for a year", async () => {
    for (const path of [image, "/assets/index-ABcd1234.js"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await app.request(path, { method });
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe(
          "public, max-age=31536000, immutable",
        );
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(response.headers.get("Set-Cookie")).toBeNull();
        expect(response.headers.get("Content-Type")).not.toContain("html");
        await response.arrayBuffer();
      }
    }
  });
  it("keeps mutable legacy art short-lived", async () => {
    const response = await app.request("/assets/game/card.webp");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
    await response.arrayBuffer();
  });
  it("does not cache the SPA or return it for missing static files", async () => {
    for (const path of [
      "/zh/room/1234",
      "/index.html",
      "/assets/missing.js",
      "/favicon.ico",
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(
        path.startsWith("/assets/") || path === "/favicon.ico" ? 404 : 200,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await response.arrayBuffer();
    }
  });
  it("rejects writes to public files", async () => {
    const response = await app.request(image, { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
