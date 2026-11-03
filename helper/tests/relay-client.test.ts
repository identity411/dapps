import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { RelayClient, RelayHttpError } from "../src/relay.js";

async function server(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const instance = http.createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("no test server port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => instance.close(() => resolve())),
  };
}

test("helper relay client pairs, fetches funded orders, and sends auth on helper routes", async () => {
  const seen: Array<{ path: string; auth: string | undefined }> = [];
  const s = await server((req, res) => {
    seen.push({ path: String(req.url), auth: req.headers.authorization });
    if (req.url === "/helper/pair") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ token: "sp_helper_test", seller: "0xseller", expiresAt: 1 }));
      return;
    }
    if (req.url?.startsWith("/helper/orders")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ orders: [] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
  try {
    const relay = new RelayClient(s.url, 2_000);
    const paired = await relay.pair("123456");
    assert.equal(paired.seller, "0xseller");
    relay.setToken(paired.token);
    assert.deepEqual(await relay.getOrders(), []);
    assert.equal(seen[0]?.auth, undefined);
    assert.equal(seen[1]?.auth, "Bearer sp_helper_test");
  } finally {
    await s.close();
  }
});

test("helper relay client surfaces error codes without response bodies", async () => {
  const s = await server((_req, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "helper_auth_invalid", detail: "should not surface" }));
  });
  try {
    const relay = new RelayClient(s.url, 2_000);
    relay.setToken("sp_helper_bad");
    await assert.rejects(
      () => relay.getProfile(),
      (error) =>
        error instanceof RelayHttpError &&
        error.status === 401 &&
        error.code === "helper_auth_invalid" &&
        !error.message.includes("should not surface"),
    );
  } finally {
    await s.close();
  }
});
