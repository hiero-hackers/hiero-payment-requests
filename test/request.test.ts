import { describe, it, expect } from "vitest";
import { createRequest, RequestError } from "../src/request.js";
import { CaipError } from "../src/caip/index.js";
import type { PaymentRequest } from "../src/types.js";

const base: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n,
  reference: "INV-2026-041",
};

describe("createRequest — fail at build time, not three weeks later", () => {
  it("resolves a valid request", () => {
    const resolved = createRequest(base);
    expect(resolved.recipient.network).toBe("mainnet");
    expect(resolved.asset.kind).toBe("token");
  });

  it("accepts an HBAR request via the provisional native identifier", () => {
    expect(createRequest({ ...base, asset: "hedera:mainnet/slip44:3030" }).asset.kind).toBe("hbar");
  });

  it("rejects a request that spans networks", () => {
    expect(() => createRequest({ ...base, asset: "hedera:testnet/token:0.0.720" })).toThrow(RequestError);
  });

  it.each([
    [{ amount: 0n }, "zero amount"],
    [{ amount: -1n }, "negative amount"],
    [{ reference: "" }, "empty reference"],
    [{ expiresAt: "not-a-timestamp" }, "bad expiry"],
    [{ expiresAt: "2026-07-15T00:00:00Z" }, "wall-clock expiry instead of consensus"],
  ])("rejects %o (%s)", (over) => {
    expect(() => createRequest({ ...base, ...over })).toThrow(RequestError);
  });

  it("rejects a bare account id — the recipient must carry its network", () => {
    expect(() => createRequest({ ...base, recipient: "0.0.1234" })).toThrow(CaipError);
  });

  it("accepts a request with no expiry", () => {
    expect(() => createRequest(base)).not.toThrow();
  });
});
