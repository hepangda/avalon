export function withPublicOrigin(request: Request, publicOrigin: string): Request {
  // Use a configured origin, never arbitrary forwarded headers, for OIDC callbacks/cookies.
  const incoming = new URL(request.url);
  // Hono's lightweight Request cannot be used as RequestInit: native getters such
  // as duplex require a real Request instance. Copy the incoming HTTP fields.
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  };
  if (init.body) init.duplex = "half";
  return new Request(
    `${publicOrigin}${incoming.pathname}${incoming.search}`,
    init,
  );
}
