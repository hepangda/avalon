import { createServer } from 'node:http';
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from './env';
import { SESSION_COOKIE, sealSession } from './auth/session';

/** Local OIDC fixture for real server tests; never contacts a user's provider. */
export async function startTestAuth() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const clientId = 'avalon-test';
  const user = { sub: 'test-user', preferred_username: 'Host' };
  const grants = new Map<string, { nonce: string; challenge: string }>();
  let issuer = '';
  const server = createServer(async (request, response) => {
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
    } else if (request.url === '/token' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const form = new URLSearchParams(body);
      const grant = grants.get(form.get('code') ?? '');
      grants.delete(form.get('code') ?? '');
      const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? ''))).toString('base64url');
      if (!grant || grant.challenge !== challenge) {
        response.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const idToken = await new SignJWT({ nonce: grant.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
        .setIssuer(issuer).setAudience(clientId).setSubject(user.sub)
        .setIssuedAt().setExpirationTime('5m').sign(privateKey);
      response.end(JSON.stringify({ access_token: 'test-access', id_token: idToken, token_type: 'Bearer', expires_in: 300 }));
    } else if (request.url === '/userinfo' && request.headers.authorization === 'Bearer test-access') {
      response.end(JSON.stringify(user));
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No auth fixture address');
  issuer = `http://127.0.0.1:${address.port}`;
  const env = {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: 'test-only',
    OIDC_SESSION_SECRET: Buffer.alloc(32).toString('base64url'),
  };
  return {
    env,
    /** Approve an authorization request and return the code its callback would receive. */
    authorize(authorizationUrl: string) {
      const params = new URL(authorizationUrl).searchParams;
      const code = crypto.randomUUID();
      grants.set(code, { nonce: params.get('nonce') ?? '', challenge: params.get('code_challenge') ?? '' });
      return code;
    },
    async cookie() {
      const value = await sealSession(env as Env, issuer, { id: user.sub, username: user.preferred_username });
      return `${SESSION_COOKIE}=${value}`;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
