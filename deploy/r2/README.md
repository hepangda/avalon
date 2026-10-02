# Optional public static storage

The default build serves assets from the application origin. To use Cloudflare
R2, provision your own public-only bucket and custom domain, with an `avalon/`
prefix reserved for this application. Account IDs, zone IDs and production bucket
names belong in private operations configuration.

Configure the bucket using Cloudflare's [public bucket documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/)
and [CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).
The included `cors.json` allows credential-free GET/HEAD from any origin; use it
only for public assets and preserve other applications' rules in shared buckets.
Configure caching for the published JavaScript, CSS and images as well.

Install Wrangler separately and authenticate with access to your target bucket.
The upload tools require an explicit bucket and HTTPS base URL; they have no
production destination defaults. The base must end in `/avalon/`.

```sh
export STATIC_ASSET_BASE_URL=https://static.example.com/avalon/
export STATIC_R2_BUCKET=your-public-assets-bucket
export PUBLIC_ORIGIN=https://avalon.example.com
npm run build
npm run static:check
npm run static:upload
npm run static:verify
```

Replace the example destinations before running. `static:check` validates local
files only; `static:upload` writes to the selected bucket; `static:verify` fetches
the public CDN resources and checks content, MIME, CORS, cache policy and cache hits.
These scripts read exported environment variables, not `.env` files.

The Vite plugin emits content-addressed images and hashed JS/CSS, plus a manifest
computed from the final files. The publisher validates paths, sizes and SHA-256
before upload, and writes only manifest entries under `avalon/`. HTML, source
maps, credentials and unversioned public copies are excluded. Each uploaded asset
uses `Cache-Control: public, max-age=31536000, immutable`.

For Docker, pass `--build-arg STATIC_ASSET_BASE_URL` with the same URL, extract
`/app/dist/client` from that exact image, and export `STATIC_BUILD_DIR` to the
extracted directory when checking, uploading and verifying. Complete these steps
before rolling out the application container.

Retain previous hashed resources for open tabs and application rollbacks. The
publisher never deletes objects or synchronizes the bucket root. HTML, API,
OIDC and WebSocket traffic remain on the application origin. Development always
uses local assets.
