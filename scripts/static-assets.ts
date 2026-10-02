import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, posix } from "node:path";
import type { Plugin } from "vite";

/** Public assets use stable content addresses, including dynamically selected art. */
export function staticAssets(publicDir: string, base: string): Plugin {
  const files: { path: string; fileName: string; source: Buffer }[] = [];
  function walk(directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else if (
        entry.isFile() &&
        /\.(?:webp|png|ico|svg|woff2?|jpg|jpeg|avif)$/.test(path)
      ) {
        const source = readFileSync(join(directory, entry.name));
        const hash = createHash("sha256")
          .update(source)
          .digest("hex")
          .slice(0, 16);
        files.push({
          path: `/${path}`,
          fileName: `assets/public/${hash}/${path}`,
          source,
        });
      }
    }
  }
  walk(publicDir);
  const urls = Object.fromEntries(
    files.map((file) => [file.path, `${base}${file.fileName}`]),
  );
  return {
    name: "avalon-static-assets",
    apply: "build",
    config: () => ({ build: { copyPublicDir: false }, define: { __PUBLIC_ASSET_URLS__: JSON.stringify(urls) } }),
    buildStart() {
      for (const file of files)
        this.emitFile({
          type: "asset",
          fileName: file.fileName,
          source: file.source,
        });
    },
    writeBundle(options, bundle) {
      if (!options.dir)
        throw new Error("Static assets require an output directory");
      const types: Record<string, string> = {
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".webp": "image/webp",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".avif": "image/avif",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      };
      const entries = Object.values(bundle)
        .filter((file) => file.fileName.startsWith("assets/"))
        .map((file) => {
          const bytes = readFileSync(join(options.dir!, file.fileName));
          const contentType = types[extname(file.fileName)];
          if (!contentType)
            throw new Error(`Unsupported public asset: ${file.fileName}`);
          return {
            file: file.fileName,
            key: `avalon/${file.fileName}`,
            contentType,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.byteLength,
          };
        });
      writeFileSync(
        join(options.dir, "static-assets.json"),
        JSON.stringify({ base, files: entries }, null, 2),
      );
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Vite has already applied base to favicon and other public references.
        for (const file of files) {
          html = html.replaceAll(
            `"${base}${file.path.slice(1)}"`,
            `"${urls[file.path]}"`,
          );
        }
        return html;
      },
    },
  };
}
