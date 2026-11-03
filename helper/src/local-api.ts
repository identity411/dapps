import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export class HelperApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export type SteamLoginState = "logged_out" | "qr_pending" | "logged_in" | "error";

export interface HelperStatus {
  paired: boolean;
  seller: string | null;
  steam: {
    status: SteamLoginState;
    steamId64: string | null;
    error: string | null;
    /** Changes whenever a fresh QR is issued; never contains the QR itself. */
    qrVersion?: number;
    qrIssuedAt?: string | null;
    remoteInteraction?: boolean;
  };
  profile: {
    steamId64: string | null;
    bound: boolean;
    matches: boolean;
  };
  relayError: string | null;
  polling: boolean;
}

export interface LoginStartResult {
  status: "qr" | "logged_in";
  qrDataUrl?: string;
  steamId64?: string;
  qrVersion?: number;
  qrIssuedAt?: string | null;
  remoteInteraction?: boolean;
}

/** Implemented by the daemon; kept here so the HTTP layer is testable in isolation. */
export interface HelperController {
  getStatus(): HelperStatus;
  pair(code: string): Promise<{ seller: string }>;
  startLogin(): Promise<LoginStartResult>;
}

export interface LocalApiOptions {
  port: number;
  allowedOrigins: string[];
  controller: HelperController;
}

export interface LocalApiServer {
  port: number;
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const MAX_BODY_BYTES = 8 * 1024;

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  origin: string | undefined,
  allowedOrigins: Set<string>,
): void {
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = (String(req.headers["content-type"] || "").split(";")[0] ?? "")
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HelperApiError(415, "content_type_required");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HelperApiError(413, "request_body_too_large");
    chunks.push(buffer);
  }
  if (size === 0) throw new HelperApiError(400, "request_body_required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HelperApiError(400, "request_body_invalid");
  }
}

function hostIsLoopback(headers: IncomingMessage["headers"]): boolean {
  const host = headers.host;
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function allowedOriginFor(
  req: IncomingMessage,
  allowedOrigins: Set<string>,
): string | undefined {
  const origin = req.headers.origin;
  if (Array.isArray(origin)) return undefined;
  if (origin === undefined) return undefined;
  return allowedOrigins.has(origin) ? origin : undefined;
}

export async function createLocalApiServer(options: LocalApiOptions): Promise<LocalApiServer> {
  const allowedOrigins = new Set(options.allowedOrigins);
  const server: Server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowedOrigin = allowedOriginFor(req, allowedOrigins);

    if (!hostIsLoopback(req.headers)) {
      sendJson(res, 403, { error: "loopback_host_required" }, allowedOrigin, allowedOrigins);
      return;
    }
    if (typeof origin === "string" && !allowedOrigin) {
      sendJson(res, 403, { error: "origin_not_allowed" }, allowedOrigin, allowedOrigins);
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {}, allowedOrigin, allowedOrigins);
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
      sendJson(res, 400, { error: "bad_request" }, allowedOrigin, allowedOrigins);
      return;
    }

    try {
      if (req.method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "skinpact-helper" }, allowedOrigin, allowedOrigins);
        return;
      }
      if (req.method === "GET" && pathname === "/api/status") {
        sendJson(res, 200, options.controller.getStatus(), allowedOrigin, allowedOrigins);
        return;
      }
      if (req.method === "GET" && pathname === "/api/login/status") {
        const status = options.controller.getStatus();
        sendJson(
          res,
          200,
          { paired: status.paired, steam: status.steam, profile: status.profile },
          allowedOrigin,
          allowedOrigins,
        );
        return;
      }
      if (req.method === "POST" && pathname === "/api/pair") {
        const body = await readJsonBody(req);
        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as { code?: unknown }).code !== "string"
        ) {
          throw new HelperApiError(422, "pairing_code_required");
        }
        const result = await options.controller.pair((body as { code: string }).code);
        sendJson(res, 200, { ok: true, seller: result.seller }, allowedOrigin, allowedOrigins);
        return;
      }
      if (req.method === "POST" && pathname === "/api/login/start") {
        const result = await options.controller.startLogin();
        sendJson(res, 200, result, allowedOrigin, allowedOrigins);
        return;
      }

      sendJson(res, 404, { error: "not_found" }, allowedOrigin, allowedOrigins);
    } catch (error) {
      if (error instanceof HelperApiError) {
        sendJson(res, error.status, { error: error.code }, allowedOrigin, allowedOrigins);
        return;
      }
      sendJson(res, 500, { error: "helper_internal_error" }, allowedOrigin, allowedOrigins);
    }
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(
        error.code === "EADDRINUSE"
          ? new HelperApiError(409, "helper_api_port_in_use")
          : new HelperApiError(500, "helper_api_listen_failed"),
      );
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, "127.0.0.1");
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
