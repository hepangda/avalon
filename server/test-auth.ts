import { createServer } from 'node:http';
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** Local OIDC fixture for real server tests; never contacts a user's provider. */
export async function startTestAuth() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let issuer = '';
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/jwks') {
      response.end(JSON.stringify({ keys: [jwk] }));
    } else if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
      }));
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No auth fixture address');
  issuer = `http://127.0.0.1:${address.port}`;
  const resource = 'https://avalon.pangda.app/createRoom';
  return {
    env: {
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: 'avalon-test',
      OIDC_CLIENT_SECRET: 'test-only',
      OIDC_SESSION_SECRET: Buffer.alloc(32).toString('base64url'),
      OIDC_RESOURCE: resource,
    },
    async cookie() {
      const accessToken = await new SignJWT({ token_use: 'access_token' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'at+jwt' })
        .setIssuer(issuer).setAudience(resource).setSubject('test-user')
        .setIssuedAt().setExpirationTime('1h').sign(privateKey);
      const key = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt({
        name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('avalon:oidc-session:v1'),
      }, key, new TextEncoder().encode(JSON.stringify({
        accessToken, refreshToken: 'test-refresh', accessTokenExpiresAt: Date.now() + 3600_000,
        user: { id: 'test-user', username: 'Host' },
      })));
      return `avalon_oidc_session=v1.${Buffer.from(iv).toString('base64url')}.${Buffer.from(cipher).toString('base64url')}`;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
