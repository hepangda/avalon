declare const __PUBLIC_ASSET_URLS__: Record<string, string>;

/** Development keeps Vite's public paths; production resolves content-hashed CDN URLs. */
export function assetUrl(path: string): string {
  return typeof __PUBLIC_ASSET_URLS__ === "undefined"
    ? path
    : (__PUBLIC_ASSET_URLS__[path] ?? path);
}
