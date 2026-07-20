/**
 * The network-agreement contract added for hiero-receipts ≥ 0.1.0: a receipt
 * that KNOWS its network (provenance.network) must agree with the network it
 * is presented as — a mismatch is an upstream mix-up, never a payment.
 */
import { describe, expect, it } from "vitest";
import { fromReceipt } from "../../src/adapters/receipt.js";

const receipt = {
  account: "0.0.1234",
  transactionId: "0.0.99-1-2",
  consensusTimestamp: "1.0",
  status: "success" as const,
  movements: [{ asset: "HBAR", amount: 5n, kind: "hbar" as const }],
};

describe("fromReceipt network agreement", () => {
  it("a stamped network that agrees passes through", () => {
    const p = fromReceipt({ ...receipt, provenance: { network: "mainnet" } }, "mainnet");
    expect(p.network).toBe("mainnet");
  });

  it("a stamped network that disagrees throws, naming both", () => {
    expect(() =>
      fromReceipt({ ...receipt, provenance: { network: "testnet" } }, "mainnet"),
    ).toThrow(/stamped "testnet".*presented as "mainnet"/);
  });

  it("an unstamped receipt falls back to the argument (pre-0.1.0 shape)", () => {
    expect(fromReceipt(receipt, "previewnet").network).toBe("previewnet");
  });
});
