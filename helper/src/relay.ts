import type { HelperOrder } from "@skinpact/shared";

export class RelayHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export interface RelayProfile {
  seller: string;
  steamId64: string | null;
}

export interface PairResult {
  token: string;
  seller: string;
  expiresAt: number;
}

export class RelayClient {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  async pair(code: string): Promise<PairResult> {
    const body = await this.request<PairResult>("/helper/pair", {
      method: "POST",
      body: { code },
      auth: false,
    });
    if (!body?.token || !body.seller) throw new RelayHttpError(502, "relay_pair_invalid");
    return body;
  }

  async getProfile(): Promise<RelayProfile> {
    return this.request<RelayProfile>("/helper/profile", { method: "GET" });
  }

  async getOrders(): Promise<HelperOrder[]> {
    const body = await this.request<{ orders: HelperOrder[] }>("/helper/orders?status=funded", {
      method: "GET",
    });
    if (!Array.isArray(body?.orders)) throw new RelayHttpError(502, "relay_orders_invalid");
    return body.orders;
  }

  async reportOffer(listingId: string, tradeOfferId: string): Promise<{ offerIdHash: string }> {
    return this.request<{ offerIdHash: string }>(`/helper/listings/${listingId}/offer`, {
      method: "POST",
      body: { tradeOfferId },
    });
  }

  async reportAccepted(
    listingId: string,
    tradeOfferId: string,
    observedAt: string,
  ): Promise<{ evidenceHash: string }> {
    return this.request<{ evidenceHash: string }>(`/helper/listings/${listingId}/accepted`, {
      method: "POST",
      body: { tradeOfferId, observedAt },
    });
  }

  private async request<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown; auth?: boolean },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.auth !== false) {
        if (!this.token) throw new RelayHttpError(401, "helper_auth_required");
        headers.Authorization = `Bearer ${this.token}`;
      }
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
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
        const code =
          parsed && typeof parsed.error === "string" ? parsed.error : `http_${response.status}`;
        throw new RelayHttpError(response.status, code);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof RelayHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new RelayHttpError(504, "relay_timeout");
      }
      throw new RelayHttpError(503, "relay_unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}
