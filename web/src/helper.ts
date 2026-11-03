import { HELPER_URL } from "./config";

export class HelperError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
  ) {
    super(code);
  }
}

export type HelperSteamState = "logged_out" | "qr_pending" | "logged_in" | "error";

export interface HelperStatus {
  paired: boolean;
  seller: string | null;
  steam: {
    status: HelperSteamState;
    steamId64: string | null;
    error: string | null;
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

export interface HelperLoginStart {
  status: "qr" | "logged_in";
  qrDataUrl?: string;
  steamId64?: string;
  qrVersion?: number;
  qrIssuedAt?: string | null;
  remoteInteraction?: boolean;
}

async function helperFetch<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${HELPER_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: "omit",
    });
    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const code = parsed && typeof parsed.error === "string" ? parsed.error : `http_${response.status}`;
      throw new HelperError(code, response.status);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof HelperError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HelperError("helper_timeout");
    }
    throw new HelperError("helper_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

export function getHelperStatus(): Promise<HelperStatus> {
  return helperFetch<HelperStatus>("/api/status", { timeoutMs: 3_000 });
}

export function pairHelper(code: string): Promise<{ seller: string }> {
  return helperFetch<{ seller: string }>("/api/pair", {
    method: "POST",
    body: { code },
    timeoutMs: 20_000,
  });
}

export function startHelperLogin(): Promise<HelperLoginStart> {
  return helperFetch<HelperLoginStart>("/api/login/start", {
    method: "POST",
    timeoutMs: 25_000,
  });
}
