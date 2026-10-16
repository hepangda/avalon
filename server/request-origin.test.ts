import { once } from "node:events";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withPublicOrigin } from "./request-origin";

const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const publicOrigin = "https://avalon.example";
let server: ServerType;
let origin: string;

beforeAll(async () => {
  const app = new Hono();
  app.all("*", async (c) => {
    const request = withPublicOrigin(c.req.raw, publicOrigin);
    return new Response(await request.text(), {
      headers: {
        "X-Request-URL": request.url,
        "X-Request-Method": request.method,
        "X-Request-Cookie": request.headers.get("Cookie") ?? "",
        "X-Request-Origin": request.headers.get("Origin") ?? "",
        "X-Request-Content-Type": request.headers.get("Content-Type") ?? "",
        "X-Request-Has-Body": String(request.body !== null),
      },
    });
  });
  // Exercise the adapter's lightweight incoming Request and default global overrides.
  server = createAdaptorServer({ fetch: app.fetch });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    globalThis.Request = NativeRequest;
    globalThis.Response = NativeResponse;
  }
});

describe("public origin request forwarding", () => {
  it.each(["GET", "HEAD"])("forwards %s without a body and keeps the configured origin", async (method) => {
    const path = "/api/auth/callback?state=hello%2Bworld&code=first&code=second";
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: "session=test",
        Forwarded: "proto=http;host=untrusted.example",
        "X-Forwarded-Host": "untrusted.example",
        "X-Forwarded-Proto": "http",
      },
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-URL")).toBe(`${publicOrigin}${path}`);
    expect(response.headers.get("X-Request-Method")).toBe(method);
    expect(response.headers.get("X-Request-Cookie")).toBe("session=test");
    expect(response.headers.get("X-Request-Has-Body")).toBe("false");
    expect(body).toBe("");
  });

  it.each(["POST", "PATCH"])("forwards a %s JSON body and authentication headers", async (method) => {
    const body = JSON.stringify({ alias: "梅林" });
    const response = await fetch(`${origin}/api/auth/alias`, {
      method,
      headers: {
        Cookie: "session=test",
        Origin: publicOrigin,
        "Content-Type": "application/json",
      },
      body,
    });
    const forwardedBody = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-URL")).toBe(`${publicOrigin}/api/auth/alias`);
    expect(response.headers.get("X-Request-Method")).toBe(method);
    expect(response.headers.get("X-Request-Cookie")).toBe("session=test");
    expect(response.headers.get("X-Request-Origin")).toBe(publicOrigin);
    expect(response.headers.get("X-Request-Content-Type")).toBe("application/json");
    expect(forwardedBody).toBe(body);
  });

  it("preserves cancellation for native requests", () => {
    const controller = new AbortController();
    const request = new NativeRequest("http://internal/api/auth/session", {
      signal: controller.signal,
    });
    const forwarded = withPublicOrigin(request, publicOrigin);
    expect(forwarded.signal.aborted).toBe(false);
    controller.abort(new Error("Client disconnected"));
    expect(forwarded.signal.aborted).toBe(true);
    expect(forwarded.signal.reason).toBe(controller.signal.reason);
  });
});
