/**
 * The canonical test fixtures — one request, one asset, one payment builder,
 * ONE property generator. The generator matters most: property tests are only
 * as good as their arbitraries, and two suites growing their own generators
 * had already drifted apart once. Narrow it per-suite via options; never fork
 * it.
 */
import fc from "fast-check";
import type { Payment, PaymentRequest } from "../src/index.js";

/** The example request every suite (and the README) speaks about. */
export const BASE: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n, // 100 USDC at 6 decimals
  reference: "INV-2026-041",
};

/** The requested asset of `BASE`, as a parsed `AssetRef`. */
export const USDC = {
  kind: "token",
  network: "mainnet",
  id: { shard: 0n, realm: 0n, num: 720n },
} as const;

/** A payment fulfilling `BASE` exactly — override what a test needs. */
export function payment(over: Partial<Payment> = {}): Payment {
  return {
    transactionId: "0.0.999@1783012000.000000000",
    consensusTimestamp: "1783012000.000000000",
    network: "mainnet",
    memo: "INV-2026-041",
    succeeded: true,
    credits: [{ account: "0.0.1234", asset: USDC, amount: 100_000000n }],
    ...over,
  };
}

/** Merchant-chosen text: separators, URI metacharacters, unicode, spaces —
 *  everything percent-encoding and QR byte mode must survive. */
export const arbReference = (maxLength = 40): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

export interface ArbRequestOptions {
  /** Restrict networks (default: all four). */
  readonly networks?: readonly ("mainnet" | "testnet" | "previewnet" | "devnet")[];
  /** Restrict asset kinds (default: both). */
  readonly assets?: readonly ("hbar" | "token")[];
  /** Cap reference/label length (default 40; QR suites use less for speed). */
  readonly maxRefLength?: number;
}

/** Arbitrary valid requests — 64-bit ids and amounts, hostile references,
 *  optional expiry and label. THE generator; see the module header. */
export function arbRequest(options: ArbRequestOptions = {}): fc.Arbitrary<PaymentRequest> {
  const networks = options.networks ?? ["mainnet", "testnet", "previewnet", "devnet"];
  const assets = options.assets ?? ["hbar", "token"];
  const maxRefLength = options.maxRefLength ?? 40;
  return fc
    .record({
      network: fc.constantFrom(...networks),
      kind: fc.constantFrom(...assets),
      account: fc.bigInt({ min: 1n, max: 9223372036854775807n }),
      token: fc.bigInt({ min: 1n, max: 999_999n }),
      amount: fc.bigInt({ min: 1n, max: 9223372036854775807n }),
      reference: arbReference(maxRefLength),
      expiresAt: fc.option(fc.integer({ min: 1, max: 2_000_000_000 }), { nil: undefined }),
      label: fc.option(arbReference(maxRefLength), { nil: undefined }),
    })
    .map(({ network, kind, account, token, amount, reference, expiresAt, label }) => ({
      recipient: `hedera:${network}:0.0.${account}`,
      asset:
        kind === "hbar" ? `hedera:${network}/slip44:3030` : `hedera:${network}/token:0.0.${token}`,
      amount,
      reference,
      ...(expiresAt !== undefined ? { expiresAt: `${expiresAt}.000000000` } : {}),
      ...(label !== undefined ? { label } : {}),
    }));
}
