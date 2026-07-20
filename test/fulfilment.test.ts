/**
 * The fulfilment codec, held to the same standard as the request wire:
 * exact round trips (property-tested over verdicts `match` itself produced),
 * canonical bytes, and strict refusal of everything else.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  match,
  encodeFulfilment,
  decodeFulfilment,
  RequestError,
  type Fulfilment,
} from "../src/index.js";
import { BASE, USDC, payment } from "./fixtures.js";

describe("round trips are exact — over verdicts match itself produced", () => {
  // Arbitrary payment sets against BASE: varying amounts (under/exact/over),
  // memos (right and wrong), success flags, duplicates — every status except
  // `expired` falls out of match; `expired` is covered concretely below.
  const arbPayments = fc.array(
    fc
      .record({
        amount: fc.bigInt({ min: 0n, max: 300_000000n }),
        carriesRef: fc.boolean(),
        succeeded: fc.boolean(),
        wrongAsset: fc.boolean(),
        at: fc.integer({ min: 1, max: 2_000_000_000 }),
      })
      .map(({ amount, carriesRef, succeeded, wrongAsset, at }) =>
        payment({
          transactionId: `0.0.9@${at}.0`,
          consensusTimestamp: `${at}.000000000`,
          memo: carriesRef ? "pay INV-2026-041 thanks" : "something else",
          succeeded,
          credits: [
            {
              account: "0.0.1234",
              asset: wrongAsset ? { ...USDC, id: { shard: 0n, realm: 0n, num: 999n } } : USDC,
              amount,
            },
          ],
        }),
      ),
    { maxLength: 6 },
  );

  it("decodeFulfilment(encodeFulfilment(f)) ≡ f", () => {
    fc.assert(
      fc.property(arbPayments, (payments) => {
        const fulfilment = match({ ...BASE, expiresAt: "1000000000.000000000" }, payments);
        expect(decodeFulfilment(encodeFulfilment(fulfilment))).toEqual(fulfilment);
      }),
    );
  });

  it("every status round-trips, expired included", () => {
    const cases: Fulfilment[] = [
      { status: "unpaid" },
      { status: "expired" },
      match(BASE, [payment({ memo: "INV-2026-041", credits: [] })]), // wrong-asset? no credits → unpaid…
      match(BASE, [payment()]), // paid
      match(BASE, [payment(), payment({ transactionId: "0.0.9@2.2" })]), // overpaid
    ];
    for (const fulfilment of cases) {
      expect(decodeFulfilment(encodeFulfilment(fulfilment))).toEqual(fulfilment);
    }
  });

  it("encoding is canonical — the same verdict always yields the same bytes", () => {
    const verdict = match(BASE, [payment()]);
    expect(encodeFulfilment(verdict)).toBe(encodeFulfilment(match(BASE, [payment()])));
  });

  it("amounts ride as exact strings — JSON.stringify alone would have thrown", () => {
    const encoded = encodeFulfilment(match(BASE, [payment()]));
    expect(encoded).toContain('"received":"100000000"');
    expect(() => JSON.stringify(match(BASE, [payment()]))).toThrow(/BigInt/);
  });
});

describe("strictness: the codec rejects, never guesses", () => {
  const paid = encodeFulfilment(match(BASE, [payment()]));

  it("unknown keys, statuses, and versions are refused with the reason", () => {
    expect(() => decodeFulfilment(paid.replace('"status":"paid"', '"status":"settled"'))).toThrow(
      /unknown fulfilment status/,
    );
    expect(() => decodeFulfilment(paid.replace('"v":1', '"v":2'))).toThrow(/newer build/);
    const extra = JSON.stringify({ ...JSON.parse(paid), surprise: 1 });
    expect(() => decodeFulfilment(extra)).toThrow(/unknown key/);
  });

  it("a decimal or numeric amount is refused — base units are strings", () => {
    expect(() =>
      decodeFulfilment(paid.replace('"received":"100000000"', '"received":"1.5"')),
    ).toThrow(RequestError);
    expect(() =>
      decodeFulfilment(paid.replace('"received":"100000000"', '"received":100000000')),
    ).toThrow(/integer string/);
  });

  it("a malformed credit asset fails through the real CAIP parser", () => {
    expect(() =>
      decodeFulfilment(paid.replace("hedera:mainnet/token:0.0.720", "hedera:mainnet/token:oops")),
    ).toThrow();
  });

  it("non-JSON and non-objects are named", () => {
    expect(() => decodeFulfilment("not json {")).toThrow(/not valid JSON/);
    expect(() => decodeFulfilment("[1]")).toThrow(/must be a JSON object/);
  });
});

describe("strictness reaches every layer of the shape", () => {
  const paid = JSON.parse(encodeFulfilment(match(BASE, [payment()]))) as {
    payments: Record<string, unknown>[];
    [k: string]: unknown;
  };
  const withPayment = (mutate: (p: Record<string, unknown>) => void): string => {
    const copy = structuredClone(paid);
    mutate(copy.payments[0]!);
    return JSON.stringify(copy);
  };

  it("payments must be an array of objects with known keys", () => {
    expect(() => decodeFulfilment(JSON.stringify({ ...paid, payments: "nope" }))).toThrow(
      /must be an array/,
    );
    expect(() => decodeFulfilment(JSON.stringify({ ...paid, payments: [7] }))).toThrow(
      /must be a JSON object/,
    );
    expect(() => decodeFulfilment(withPayment((p) => (p.surprise = 1)))).toThrow(/unknown key/);
  });

  it("credits must be an array; each credit strict, wrong types named", () => {
    expect(() => decodeFulfilment(withPayment((p) => (p.credits = "nope")))).toThrow(
      /credits must be an array/,
    );
    expect(() =>
      decodeFulfilment(withPayment((p) => ((p.credits as unknown[])[0] = { account: 1 }))),
    ).toThrow(/unknown key|must be a string/);
    expect(() => decodeFulfilment(withPayment((p) => (p.succeeded = "yes")))).toThrow(
      /must be a boolean/,
    );
    expect(() => decodeFulfilment(withPayment((p) => (p.memo = 5)))).toThrow(/must be a string/);
  });

  it("underpaid and wrong-asset decode their own shapes strictly", () => {
    const under = encodeFulfilment(
      match(BASE, [
        payment({ credits: [{ account: "0.0.1234", asset: USDC, amount: 60_000000n }] }),
      ]),
    );
    expect(decodeFulfilment(under)).toMatchObject({ status: "underpaid", shortfall: 40_000000n });
    expect(() =>
      decodeFulfilment(under.replace('"shortfall":"40000000"', '"shortfall":"x"')),
    ).toThrow(/integer string/);
    const wrong = encodeFulfilment(
      match(BASE, [
        payment({
          credits: [
            {
              account: "0.0.1234",
              asset: { ...USDC, id: { shard: 0n, realm: 0n, num: 999n } },
              amount: 60n,
            },
          ],
        }),
      ]),
    );
    expect(decodeFulfilment(wrong)).toMatchObject({ status: "wrong-asset" });
    expect(() => decodeFulfilment(JSON.stringify({ ...JSON.parse(wrong), late: false }))).toThrow(
      /unknown key/,
    );
  });
});
