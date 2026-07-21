// SPDX-License-Identifier: Apache-2.0
/**
 * `byTransactionId` — correlation when the caller already knows which
 * transaction is supposed to have paid (x402 settlements, scheduled
 * transactions, wallet callbacks). The claim is identity, not a memo bet —
 * so the memo is irrelevant, other transactions never claim, and the richer
 * verdicts still come from what the identified transaction actually credited.
 */
import { describe, expect, it } from "vitest";
import { byTransactionId, match } from "../../src/index.js";
import { BASE, payment } from "../fixtures.js";

const SDK_ID = "0.0.999@1783012000.000000000";
const REST_ID = "0.0.999-1783012000-000000000";

describe("byTransactionId", () => {
  it("claims the identified transaction, memo or no memo", () => {
    const memoless = payment({ memo: "" });
    expect(match(BASE, [memoless]).status).toBe("unpaid"); // default memo strategy
    expect(match(BASE, [memoless], { correlate: byTransactionId(SDK_ID) }).status).toBe("paid");
  });

  it("accepts either spelling on either side — SDK and mirror REST are the same id", () => {
    const restPayment = payment({ transactionId: REST_ID, memo: "" });
    expect(match(BASE, [restPayment], { correlate: byTransactionId(SDK_ID) }).status).toBe("paid");
    const sdkPayment = payment({ transactionId: SDK_ID, memo: "" });
    expect(match(BASE, [sdkPayment], { correlate: byTransactionId(REST_ID) }).status).toBe("paid");
  });

  it("normalizes unpadded nanos — @1.5 and -1-000000005 are the same instant", () => {
    const p = payment({ transactionId: "0.0.9-1-000000005", memo: "" });
    expect(match(BASE, [p], { correlate: byTransactionId("0.0.9@1.5") }).status).toBe("paid");
  });

  it("never lets another transaction claim, however perfect it looks", () => {
    const impostor = payment({ transactionId: "0.0.7@1783012000.000000000" }); // right memo, amount
    expect(match(BASE, [impostor], { correlate: byTransactionId(SDK_ID) }).status).toBe("unpaid");
  });

  it("keeps the real-and-on-network guards", () => {
    const failed = payment({ succeeded: false });
    expect(match(BASE, [failed], { correlate: byTransactionId(SDK_ID) }).status).toBe("unpaid");
    const wrongNetwork = payment({ network: "testnet" });
    expect(match(BASE, [wrongNetwork], { correlate: byTransactionId(SDK_ID) }).status).toBe(
      "unpaid",
    );
  });

  it("reports the richer verdicts from what the transaction actually credited", () => {
    const short = payment({
      memo: "",
      credits: [{ ...payment().credits[0]!, amount: BASE.amount - 5n }],
    });
    const verdict = match(BASE, [short], { correlate: byTransactionId(SDK_ID) });
    expect(verdict.status).toBe("underpaid");
    if (verdict.status === "underpaid") expect(verdict.shortfall).toBe(5n);
  });

  it("a candidate with an unparseable id simply never matches", () => {
    const weird = payment({ transactionId: "not-a-hedera-id" });
    expect(match(BASE, [weird], { correlate: byTransactionId(SDK_ID) }).status).toBe("unpaid");
  });

  it("validates the id you pass, loudly — a typo must not silently match nothing", () => {
    for (const bad of ["", "0.0.999", "0xdeadbeef", "0.0.9@1-5", "0.0.9-1.5"]) {
      expect(() => byTransactionId(bad)).toThrow(/transaction id/);
    }
  });

  it("pipeline invariants hold — re-delivered settlement rows count once", () => {
    const p = payment({ memo: "" });
    const verdict = match(BASE, [p, p], { correlate: byTransactionId(SDK_ID) });
    expect(verdict.status).toBe("paid"); // not overpaid: canonicalize deduped
  });
});
