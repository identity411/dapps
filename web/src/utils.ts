import { formatEther } from "ethers";
import { ListingStatus } from "@skinpact/shared";

export const STATUS_NAMES: Record<number, string> = {
  [ListingStatus.None]: "None",
  [ListingStatus.Active]: "Active",
  [ListingStatus.Funded]: "Funded",
  [ListingStatus.OfferSent]: "OfferSent",
  [ListingStatus.ClaimPending]: "ClaimPending",
  [ListingStatus.Completed]: "Completed",
  [ListingStatus.Refunded]: "Refunded",
};

export function statusName(status: number): string {
  return STATUS_NAMES[status] ?? `Unknown(${status})`;
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function formatEth(wei: bigint | string, digits = 6): string {
  try {
    const value = formatEther(BigInt(wei));
    const [whole, fraction = ""] = value.split(".");
    const trimmed = fraction.slice(0, digits).replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return "—";
  }
}

export function timestampLabel(seconds: bigint | number): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value * 1000).toLocaleString();
}

export function countdown(deadline: bigint | number, nowMs = Date.now()): string {
  const value = Number(deadline);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const remaining = Math.floor(value - nowMs / 1000);
  if (remaining <= 0) return "已到期";
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function isPast(deadline: bigint | number, nowMs = Date.now()): boolean {
  const value = Number(deadline);
  return Number.isFinite(value) && value > 0 && value <= Math.floor(nowMs / 1000);
}

export function extractSteamId64(input: string): string | null {
  const match = /(?:^|\D)(\d{17})(?:\D|$)/.exec(input.trim());
  return match?.[1] ?? null;
}

export function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      shortMessage?: string;
      reason?: string;
      message?: string;
      code?: string | number;
    };
    const text = candidate.shortMessage || candidate.reason || candidate.message || "";
    if (text) return text.slice(0, 280);
    if (candidate.code !== undefined) return `Request failed (${String(candidate.code)})`;
  }
  if (typeof error === "string") return error.slice(0, 280);
  return "操作失败，请重试并查看终端输出。";
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function isOfferWindowOpen(offerDeadline: bigint | number): boolean {
  const value = Number(offerDeadline);
  return value > 0 && value > Math.floor(Date.now() / 1000);
}
