/** Parse the one supported CDN path. An unset build base serves from the app origin. */
export function staticBase(value) {
  if (!value) return "/";
  return staticPublishConfig({ STATIC_ASSET_BASE_URL: value });
}

export function staticPublishConfig(env) {
  if (!env.STATIC_ASSET_BASE_URL) {
    throw new Error('Set STATIC_ASSET_BASE_URL to the HTTPS CDN URL used for this build');
  }
  const base = new URL(env.STATIC_ASSET_BASE_URL);
  if (
    base.protocol !== 'https:' || base.username || base.password ||
    base.search || base.hash || base.pathname !== '/avalon/'
  ) {
    throw new Error('STATIC_ASSET_BASE_URL must be an HTTPS URL ending in /avalon/ without credentials, query or fragment');
  }
  return base.href;
}
