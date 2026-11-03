import type { LedgerEntry, LedgerStatus } from "./ledger-types.js";
import { readJsonFile, writeJsonFileSecure } from "./storage.js";

export type { LedgerEntry, LedgerStatus } from "./ledger-types.js";

interface LedgerFile {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

export class Ledger {
  private entries = new Map<string, LedgerEntry>();

  constructor(private readonly file: string) {
    const data = readJsonFile<LedgerFile>(file);
    if (!data) return;
    if (data.version !== 1 || typeof data.entries !== "object" || data.entries === null) {
      throw new Error("Local ledger is malformed; refusing to start (no offers will be sent)");
    }
    for (const [listingId, entry] of Object.entries(data.entries)) {
      if (!entry || entry.listingId !== listingId) {
        throw new Error("Local ledger is malformed; refusing to start (no offers will be sent)");
      }
      this.entries.set(listingId, entry);
    }
  }

  get(listingId: string): LedgerEntry | null {
    const entry = this.entries.get(listingId);
    return entry ? { ...entry } : null;
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  set(entry: LedgerEntry): LedgerEntry {
    const next = { ...entry, updatedAt: new Date().toISOString() };
    this.entries.set(entry.listingId, next);
    this.save();
    return { ...next };
  }

  update(listingId: string, patch: Partial<LedgerEntry>): LedgerEntry {
    const current = this.entries.get(listingId);
    if (!current) throw new Error(`ledger entry missing for listing ${listingId}`);
    const next: LedgerEntry = {
      ...current,
      ...patch,
      listingId,
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(listingId, next);
    this.save();
    return { ...next };
  }

  private save(): void {
    const file: LedgerFile = {
      version: 1,
      entries: Object.fromEntries(this.entries.entries()),
    };
    writeJsonFileSecure(this.file, file);
  }
}
