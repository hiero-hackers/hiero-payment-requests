import { describe, it, expect } from "vitest";
import { fromReceipt, type ReceiptLike } from "../../src/adapters/receipt.js";
import { CaipError } from "../../src/caip/index.js";

const receipt: ReceiptLike = {
  account: "0.0.1234",
  transactionId: "0.0.999@1783012000.000000000",
  consensusTimestamp: "1783012000.000000000",
  status: "success",
  memo: "INV-2026-041",
  movements: [{ asset: "0.0.720", amount: 100_000000n, kind: "token" }],
};

describe("fromReceipt", () => {
  it("turns a receipt's net movements into credits", () => {
    expect(fromReceipt(receipt, "mainnet").credits).toEqual([
      {
        account: "0.0.1234",
        asset: { kind: "token", network: "mainnet", id: { shard: 0n, realm: 0n, num: 720n } },
        amount: 100_000000n,
      },
    ]);
  });

  it("drops negative movements — a receipt for money SENT is not a payment received", () => {
    const sent = fromReceipt({ ...receipt, movements: [{ asset: "0.0.720", amount: -100_000000n, kind: "token" }] }, "mainnet");
    expect(sent.credits).toEqual([]);
  });

  it("drops a zero movement", () => {
    expect(fromReceipt({ ...receipt, movements: [{ asset: "0.0.720", amount: 0n, kind: "token" }] }, "mainnet").credits).toEqual([]);
  });

  it("maps an HBAR movement to the provisional native asset", () => {
    const hbar = fromReceipt({ ...receipt, movements: [{ asset: "HBAR", amount: 5n, kind: "hbar" }] }, "mainnet");
    expect(hbar.credits[0]?.asset).toEqual({ kind: "hbar", network: "mainnet" });
  });

  it("carries several movements through independently", () => {
    const both = fromReceipt(
      { ...receipt, movements: [{ asset: "HBAR", amount: 5n, kind: "hbar" }, { asset: "0.0.720", amount: 7n, kind: "token" }] },
      "mainnet",
    );
    expect(both.credits).toHaveLength(2);
  });

  it("defaults a missing memo to empty rather than undefined", () => {
    const { memo, ...noMemo } = receipt;
    expect(fromReceipt(noMemo, "mainnet").memo).toBe("");
  });

  it("carries failure through — a transaction can reach consensus and still fail", () => {
    expect(fromReceipt({ ...receipt, status: "failed" }, "mainnet").succeeded).toBe(false);
  });

  it("stamps the network it was told, because a receipt does not carry one", () => {
    // The one way to defeat the cross-network check in `match`: pass the wrong
    // network here. Pass it from the same config that built your data client.
    expect(fromReceipt(receipt, "testnet").network).toBe("testnet");
  });
});

describe("fromReceipt reuses the real id parser (regression)", () => {
  it("rejects a malformed token id rather than coercing it", () => {
    // The old hand-rolled parser used BigInt() directly, so a NEGATIVE shard
    // sailed through as a valid id. parseEntityId rejects it.
    expect(() => fromReceipt({ ...receipt, movements: [{ asset: "-1.0.720", amount: 1n, kind: "token" }] }, "mainnet"))
      .toThrow(CaipError);
    expect(() => fromReceipt({ ...receipt, movements: [{ asset: "0.720", amount: 1n, kind: "token" }] }, "mainnet"))
      .toThrow(CaipError);
  });
});
