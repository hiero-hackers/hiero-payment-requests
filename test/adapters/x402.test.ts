// SPDX-License-Identifier: Apache-2.0
/**
 * The x402 adapter — both directions. Ported from its two prior lives
 * (hiero-x402's `requirements.ts`, hiero-checkout's `x402.ts`): all three
 * pasteable spellings, the honest refusals, and round-trips that preserve
 * exactly what `match` needs.
 */
import { describe, expect, it } from "vitest";
import { fromX402, toX402 } from "../../src/index.js";

const FEE_PAYER = "0.0.7000001";

const REQUIREMENTS = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: "5000000",
  asset: "0.0.0",
  payTo: "0.0.4507290",
  maxTimeoutSeconds: 180,
  extra: { feePayer: FEE_PAYER },
};

const BODY = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://api.example.test/data/spot-price", mimeType: "application/json" },
  accepts: [REQUIREMENTS],
};

describe("fromX402", () => {
  it("reads a full 402 body: native terms, resource URL as the reference", () => {
    expect(fromX402(JSON.stringify(BODY))).toEqual({
      recipient: "hedera:testnet:0.0.4507290",
      asset: "hedera:testnet/slip44:3030",
      amount: 5_000_000n,
      reference: "https://api.example.test/data/spot-price",
    });
  });

  it("reads a bare requirements object and an already-parsed object alike", () => {
    const token = { ...REQUIREMENTS, asset: "0.0.5449", amount: "250" };
    for (const input of [JSON.stringify(token), token]) {
      const request = fromX402(input);
      expect(request?.asset).toBe("hedera:testnet/token:0.0.5449");
      expect(request?.amount).toBe(250n);
      expect(request?.reference).toBe("x402");
    }
  });

  it("reads the raw base64 payment-required header an agent holds", () => {
    expect(fromX402(btoa(JSON.stringify(BODY)))?.recipient).toBe("hedera:testnet:0.0.4507290");
  });

  it("honours a caller-chosen reference over the resource URL", () => {
    expect(fromX402(JSON.stringify(BODY), { reference: "INV-9" })?.reference).toBe("INV-9");
  });

  it("accepts the v1 spelling maxAmountRequired", () => {
    const { amount: _dropped, ...rest } = REQUIREMENTS;
    expect(fromX402(JSON.stringify({ ...rest, maxAmountRequired: "42" }))?.amount).toBe(42n);
  });

  it("picks the first option the network table validates from a multi-chain challenge", () => {
    const evm = { ...REQUIREMENTS, network: "base-sepolia", asset: "0x036c", payTo: "0x2096" };
    const request = fromX402(JSON.stringify({ ...BODY, accepts: [evm, REQUIREMENTS] }));
    expect(request?.recipient).toBe("hedera:testnet:0.0.4507290");
  });

  it("answers undefined for everything that isn't x402-shaped", () => {
    for (const text of ["", "hello", "hiero-pay:junk", "{}", '{"a":1}', "AAAA", "not json {"]) {
      expect(fromX402(text)).toBeUndefined();
    }
    expect(fromX402({ accepts: "nope" })).toBeUndefined();
  });

  it("refuses, with its own reason, a challenge it cannot render", () => {
    const upto = { ...BODY, accepts: [{ ...REQUIREMENTS, scheme: "upto" }] };
    expect(() => fromX402(JSON.stringify(upto))).toThrow(/exact/);
    const evmOnly = { ...BODY, accepts: [{ ...REQUIREMENTS, network: "base-sepolia" }] };
    expect(() => fromX402(JSON.stringify(evmOnly))).toThrow();
  });

  it("refuses malformed terms loudly — alias payTo, weird asset, float amount", () => {
    const bad = (patch: object): string =>
      JSON.stringify({ ...BODY, accepts: [{ ...REQUIREMENTS, ...patch }] });
    expect(() => fromX402(bad({ payTo: "0xdead" }))).toThrow(/payTo/);
    expect(() => fromX402(bad({ asset: "USDC" }))).toThrow(/asset/);
    expect(() => fromX402(bad({ amount: "1.5" }))).toThrow(/amount/);
    expect(() => fromX402(bad({ network: "hedera:notanet" }))).toThrow();
  });
});

describe("toX402", () => {
  const REQUEST = {
    recipient: "hedera:testnet:0.0.4507290",
    asset: "hedera:testnet/slip44:3030",
    amount: 5_000_000n,
    reference: "https://api.example.test/data/spot-price",
  };

  it("maps a native-coin request onto the official scheme's conventions", () => {
    expect(toX402(REQUEST, { feePayer: FEE_PAYER })).toEqual(REQUIREMENTS);
  });

  it("maps tokens to bare ids and honours a custom timeout", () => {
    const requirements = toX402(
      { ...REQUEST, asset: "hedera:testnet/token:0.0.5449", amount: 250n },
      { feePayer: FEE_PAYER, maxTimeoutSeconds: 60 },
    );
    expect(requirements.asset).toBe("0.0.5449");
    expect(requirements.maxTimeoutSeconds).toBe(60);
  });

  it("round-trips what match needs — canonical identity, asset, amount", () => {
    const back = fromX402(toX402(REQUEST, { feePayer: FEE_PAYER }), {
      reference: REQUEST.reference,
    });
    expect(back).toEqual(REQUEST);
  });

  it("verifies then strips a checksummed recipient — the wire carries bare ids", () => {
    const checksummed = { ...REQUEST, recipient: "hedera:mainnet:0.0.1234-pikcw" };
    const requirements = toX402(
      { ...checksummed, asset: "hedera:mainnet/token:0.0.720" },
      { feePayer: FEE_PAYER },
    );
    expect(requirements.payTo).toBe("0.0.1234");
    expect(requirements.network).toBe("hedera:mainnet");
  });

  it("refuses NFTs and malformed fee payers", () => {
    expect(() =>
      toX402(
        { ...REQUEST, asset: "hedera:testnet/nft:0.0.5449/7", amount: 1n },
        { feePayer: FEE_PAYER },
      ),
    ).toThrow(/NFT/);
    for (const bad of ["", "0.0.1-vfmkw", "0x1234"]) {
      expect(() => toX402(REQUEST, { feePayer: bad })).toThrow(/feePayer/);
    }
  });
});
