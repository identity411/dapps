import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Ledger } from "../src/ledger.js";

function tempFile(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skinpact-ledger-"));
  return { dir, file: path.join(dir, "ledger.json") };
}

test("ledger persists offer bookkeeping locally with 600 permissions and no Trade URL", () => {
  const { dir, file } = tempFile();
  try {
    const ledger = new Ledger(file);
    assert.equal(ledger.get("7"), null);

    const created = ledger.set({
      listingId: "7",
      status: "sent",
      tradeOfferId: "9464202838",
      offerReported: true,
      offerIdHash: "0x" + "12".repeat(32),
      buyerSteamId: "76561198000000002",
      assetId: "12345678901",
      lastState: 2,
      note: "test",
    });
    assert.equal(created.status, "sent");

    const loaded = new Ledger(file);
    const entry = loaded.get("7");
    assert.equal(entry?.tradeOfferId, "9464202838");
    assert.equal(entry?.offerReported, true);

    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.includes("https://steamcommunity.com"), false);
    assert.equal(text.includes("token="), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    const updated = loaded.update("7", { status: "accepted_reported", evidenceHash: "0xabc" });
    assert.equal(updated.status, "accepted_reported");
    assert.equal(new Ledger(file).get("7")?.evidenceHash, "0xabc");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed local ledger refuses to start instead of risking duplicate offers", () => {
  const { dir, file } = tempFile();
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { "7": { listingId: "8" } } }));
    assert.throws(() => new Ledger(file), /malformed/);

    fs.writeFileSync(file, "{not-json");
    assert.throws(() => new Ledger(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
