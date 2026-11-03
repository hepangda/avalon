import { randomBytes } from "node:crypto";

/**
 * Returns the manifest files the CDN origin does not already serve unchanged.
 * Keys are content-addressed, so a matching size, type and immutable cache policy
 * means the same bytes; anything else, including a failed probe, is uploaded again.
 */
export async function unpublishedFiles(files, base, fetchImpl = fetch) {
  // A fresh query string per run keeps probes out of the asset's own cache entry:
  // the CDN caches 404s, and one cached before the upload would outlive it.
  const nonce = randomBytes(8).toString("hex");
  const pending = [...files];
  const missing = new Set();
  async function probe() {
    for (let file; (file = pending.shift());) {
      if (!(await isPublished(file, base, nonce, fetchImpl))) missing.add(file);
    }
  }
  await Promise.all(Array.from({ length: 8 }, probe));
  return files.filter((file) => missing.has(file));
}

async function isPublished(file, base, nonce, fetchImpl) {
  const url = new URL(file.file, base);
  url.searchParams.set("publish", nonce);
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      // Compressed responses omit Content-Length.
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(15_000),
    });
    const headers = response.headers;
    return (
      response.status === 200 &&
      Number(headers.get("content-length")) === file.size &&
      headers.get("content-type")?.split(";")[0] === file.contentType.split(";")[0] &&
      /max-age=31536000.*immutable/.test(headers.get("cache-control") ?? "")
    );
  } catch {
    return false;
  }
}
