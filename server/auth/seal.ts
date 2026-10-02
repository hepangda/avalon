import { AuthError } from './errors';

export async function seal(
  value: unknown,
  secret: string | undefined,
  aad: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: ownedBuffer(aad) },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function unseal(
  value: string,
  secret: string | undefined,
  aad: Uint8Array,
): Promise<unknown> {
  const [version, encodedIv, encodedCiphertext, extra] = value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedCiphertext ||
    extra !== undefined
  ) {
    throw new Error("invalid sealed value");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(base64UrlToBytes(encodedIv)),
      additionalData: ownedBuffer(aad),
    },
    await encryptionKey(secret),
    ownedBuffer(base64UrlToBytes(encodedCiphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

export async function encryptionKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret)
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_SESSION_SECRET is missing",
    );
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(secret);
  } catch {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_SESSION_SECRET is invalid",
    );
  }
  if (bytes.byteLength !== 32) {
    throw new AuthError(
      "OIDC_NOT_CONFIGURED",
      503,
      "OIDC_SESSION_SECRET must contain 32 bytes",
    );
  }
  return crypto.subtle.importKey("raw", ownedBuffer(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export function randomToken(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
