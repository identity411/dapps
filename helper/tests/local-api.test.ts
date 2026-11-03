import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import {
  createLocalApiServer,
  HelperApiError,
  type HelperController,
  type HelperStatus,
  type LocalApiServer,
} from "../src/local-api.js";

const SELLER = "0x0000000000000000000000000000000000000001";
const ALLOWED_ORIGIN = "http://localhost:5173";

function fakeController(): HelperController & { pairedCodes: string[] } {
  const state: HelperStatus = {
    paired: false,
    seller: null,
    steam: { status: "logged_out", steamId64: null, error: null },
    profile: { steamId64: null, bound: false, matches: false },
    relayError: null,
    polling: false,
  };
  const pairedCodes: string[] = [];
  return {
    pairedCodes,
    getStatus: () => ({ ...state, steam: { ...state.steam }, profile: { ...state.profile } }),
    pair: async (code) => {
      if (code !== "123456") throw new HelperApiError(422, "pairing_code_invalid");
      pairedCodes.push(code);
      state.paired = true;
      state.seller = SELLER;
      return { seller: SELLER };
    },
    startLogin: async () => {
      state.steam = { status: "qr_pending", steamId64: null, error: null };
      return { status: "qr", qrDataUrl: "data:image/png;base64,AA==" };
    },
  };
}

interface ApiResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: any = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function withServer(
  run: (server: LocalApiServer, port: number) => Promise<void>,
): Promise<void> {
  const controller = fakeController();
  const server = await createLocalApiServer({
    port: 0,
    allowedOrigins: [ALLOWED_ORIGIN],
    controller,
  });
  try {
    await run(server, server.port);
  } finally {
    await server.close();
  }
}

test("local helper API exposes status without Steam or Relay tokens", async () => {
  await withServer(async (server, port) => {
    const health = await request(port, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "skinpact-helper");

    const status = await request(port, "/api/status", {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(status.status, 200);
    assert.equal(status.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(status.headers["cache-control"], "no-store");
    assert.equal(status.body.paired, false);
    assert.equal(status.body.steam.status, "logged_out");
    assert.equal(JSON.stringify(status.body).includes("token"), false);
    assert.equal(JSON.stringify(status.body).includes("qrDataUrl"), false);
  });
});

test("pairing and login start accept JSON only from the local Web origin", async () => {
  await withServer(async (_server, port) => {
    const noContentType = await request(port, "/api/pair", {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ code: "123456" }),
    });
    assert.equal(noContentType.status, 415);

    const wrongOrigin = await request(port, "/api/pair", {
      method: "POST",
      headers: {
        Origin: "http://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "123456" }),
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.body.error, "origin_not_allowed");

    const invalidCode = await request(port, "/api/pair", {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    assert.equal(invalidCode.status, 422);
    assert.equal(invalidCode.body.error, "pairing_code_invalid");

    const paired = await request(port, "/api/pair", {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    assert.equal(paired.status, 200);
    assert.equal(paired.body.seller, SELLER);
    assert.equal(JSON.stringify(paired.body).includes("sp_helper_"), false);

    const login = await request(port, "/api/login/start", {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.status, "qr");
    assert.equal(login.body.qrDataUrl, "data:image/png;base64,AA==");
  });
});

test("rejects DNS-rebinding hosts and serves CORS preflight only for allowed origins", async () => {
  await withServer(async (_server, port) => {
    const rebinding = await request(port, "/api/status", {
      headers: { Host: "evil.example" },
    });
    assert.equal(rebinding.status, 403);
    assert.equal(rebinding.body.error, "loopback_host_required");

    const preflight = await request(port, "/api/pair", {
      method: "OPTIONS",
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], ALLOWED_ORIGIN);

    const badPreflight = await request(port, "/api/pair", {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example" },
    });
    assert.equal(badPreflight.status, 403);
  });
});

test("unknown routes return not_found and login status omits the QR payload", async () => {
  await withServer(async (_server, port) => {
    const missing = await request(port, "/api/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "not_found");

    const loginStatus = await request(port, "/api/login/status", {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(loginStatus.status, 200);
    assert.deepEqual(Object.keys(loginStatus.body).sort(), ["paired", "profile", "steam"]);
    assert.equal(JSON.stringify(loginStatus.body).includes("qrDataUrl"), false);
  });
});
