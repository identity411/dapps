import { Interface } from "ethers";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SKINPACT_ABI } from "./abi.js";

describe("SkinPact ABI", () => {
  it("parses all functions and events", () => {
    const iface = new Interface(SKINPACT_ABI);
    assert.ok(iface.getFunction("createListing"));
    assert.ok(iface.getFunction("finalizeClaim"));
    assert.ok(iface.getEvent("ClaimAccepted"));
  });
});
