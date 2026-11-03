import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function bearer(req: Request): string | null {
  const value = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || null;
}

export function requireString(value: unknown, field: string, max = 4096): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, `${field}_required`);
  }
  const text = value.trim();
  if (text.length > max) throw new HttpError(422, `${field}_too_long`);
  return text;
}

export function requireDigits(value: unknown, field: string): string {
  const text = requireString(value, field, 128);
  if (!/^\d+$/.test(text)) throw new HttpError(422, `${field}_invalid`);
  return text;
}

export function normalizeAddress(value: unknown, field = "address"): string {
  const text = requireString(value, field, 128);
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) throw new HttpError(422, `${field}_invalid`);
  return text.toLowerCase();
}

export function requireSteamId64(value: unknown, field = "steamId64"): string {
  const text = requireString(value, field, 32);
  if (!/^\d{17}$/.test(text)) throw new HttpError(422, `${field}_invalid`);
  return text;
}

export function requireListingId(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^\d{1,78}$/.test(text) || text === "0") {
    throw new HttpError(422, "listing_id_invalid");
  }
  return text;
}

export function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}
