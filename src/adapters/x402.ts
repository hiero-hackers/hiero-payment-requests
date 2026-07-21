// SPDX-License-Identifier: Apache-2.0
/**
 * x402 adapter — the bridge between this library's request language and the
 * x402 payment standard (HTTP 402 for agents; https://x402.org). Extracted
 * here after hiero-x402 and hiero-checkout had independently grown the same
 * mapping: third copy wanted = library code.
 *
 * The two languages already agree on what matters — CAIP-style network ids
 * and string amounts in atomic units — so this is a mapping, not a
 * conversion. Field conventions on the x402 side are the official Hedera
 * scheme's: asset `"0.0.0"` means the native coin in its smallest unit,
 * otherwise a token id; `extra.feePayer` names the fee-sponsoring account.
 *
 * Shapes are structural (no dependency on any x402 package), and everything
 * returned has been through the full `createRequest` validation — what comes
 * out is what a renderer or `match` can trust.
 */
import { createRequest } from "../request.js";
import type { PaymentRequest } from "../types.js";
import { paymentInstructions } from "../instructions.js";

/** The official Hedera scheme's sentinel for the native coin. */
const NATIVE_ASSET = "0.0.0";
const ENTITY_ID = /^\d+\.\d+\.\d+$/;

/** The subset of an x402 `PaymentRequirements` this adapter reads (v2 —
 *  `amount` — with the v1 `maxAmountRequired` spelling tolerated). */
export interface X402RequirementsLike {
  readonly scheme?: unknown;
  readonly network?: unknown;
  readonly asset?: unknown;
  readonly amount?: unknown;
  readonly maxAmountRequired?: unknown;
  readonly payTo?: unknown;
}

export interface FromX402Options {
  /** The request's correlator. x402 has no correlation field (settlements
   *  correlate by transaction id — see `byTransactionId`), so the caller
   *  names one; default: the challenge's `resource.url`, else `"x402"`. */
  readonly reference?: string;
}

/**
 * An x402 challenge as a validated `PaymentRequest`, or `undefined` when the
 * input isn't x402-shaped at all (so a caller's own error handling stands).
 *
 * Accepts the three spellings a challenge travels as:
 *   1. the full 402 body            `{"x402Version":2,"accepts":[…]}`
 *   2. one requirements object      `{"scheme":"exact","network":…}`
 *   3. the raw base64 `payment-required` HEADER value (decoded, then read
 *      as 1) — what an agent actually holds
 * plus already-parsed objects of shapes 1 and 2.
 *
 * Something x402-shaped but unusable throws its own honest reason (foreign
 * scheme, no network this library knows, malformed terms) — a payer
 * deserves better than "not a hiero-pay URI" for a real challenge.
 */
export function fromX402(
  input: string | object,
  opts: FromX402Options = {},
): PaymentRequest | undefined {
  const parsed = typeof input === "string" ? candidateJson(input.trim()) : input;
  if (parsed === null || parsed === undefined || typeof parsed !== "object") return undefined;

  const body = parsed as { accepts?: unknown; resource?: { url?: unknown } };
  const options: unknown[] = Array.isArray(body.accepts) ? body.accepts : [parsed];
  const looksLikeRequirements = (option: unknown): option is X402RequirementsLike =>
    typeof option === "object" &&
    option !== null &&
    "scheme" in option &&
    "payTo" in option &&
    "asset" in option;
  const candidates = options.filter(looksLikeRequirements);
  if (candidates.length === 0) return undefined;

  const exact = candidates.filter((option) => option.scheme === "exact");
  if (exact.length === 0) {
    throw new Error(
      'this x402 challenge offers no "exact"-scheme payment option — the only scheme this adapter speaks',
    );
  }

  const resourceUrl = typeof body.resource?.url === "string" ? body.resource.url : undefined;
  const reference = opts.reference ?? resourceUrl ?? "x402";

  // Multi-chain challenges list options for networks this library has never
  // heard of (EVM addresses, Solana mints…). The network table is the
  // arbiter: the first option that VALIDATES wins; if none do, the last
  // honest failure explains why.
  let lastError: unknown;
  for (const option of exact) {
    try {
      return toRequest(option, reference);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** One requirements-like option → a validated request. Throws on bad terms. */
function toRequest(option: X402RequirementsLike, reference: string): PaymentRequest {
  const network = String(option.network);
  const payTo = String(option.payTo);
  const asset = String(option.asset);
  const amount = String(option.amount ?? option.maxAmountRequired);
  if (!ENTITY_ID.test(payTo)) {
    throw new Error(`x402 payTo must be a bare entity id "shard.realm.num" (got "${payTo}")`);
  }
  if (asset !== NATIVE_ASSET && !ENTITY_ID.test(asset)) {
    throw new Error(
      `x402 asset must be "${NATIVE_ASSET}" (the native coin) or a token id (got "${asset}")`,
    );
  }
  if (!/^\d+$/.test(amount)) {
    throw new Error(`x402 amount must be an integer string in atomic units (got "${amount}")`);
  }
  const request: PaymentRequest = {
    recipient: `${network}:${payTo}`,
    asset: asset === NATIVE_ASSET ? nativeAssetOf(network) : `${network}/token:${asset}`,
    amount: BigInt(amount),
    reference,
  };
  createRequest(request); // the full gauntlet — networks, checksums, amounts
  return request;
}

/** The provisional native-coin CAIP form for a chain (see caip/asset.ts). */
function nativeAssetOf(network: string): string {
  return `${network}/slip44:3030`;
}

export interface ToX402Options {
  /** Account that sponsors network fees (the facilitator's) — the official
   *  Hedera scheme requires it in `extra.feePayer`. Bare entity id. */
  readonly feePayer: string;
  /** Seconds the payer has to present payment. Default 180 — the value both
   *  x402 reference implementations use. */
  readonly maxTimeoutSeconds?: number;
}

/** What `toX402` emits — structurally an x402 v2 `PaymentRequirements`. */
export interface X402Requirements {
  readonly scheme: "exact";
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra: { readonly feePayer: string };
}

/**
 * A validated `PaymentRequest` as x402 `PaymentRequirements` (v2, official
 * Hedera scheme conventions). Validation is this library's own — an invalid
 * request fails here, not inside a facilitator. NFTs are refused: x402's
 * `exact` scheme prices by fungible amount.
 */
export function toX402(request: PaymentRequest, opts: ToX402Options): X402Requirements {
  if (!ENTITY_ID.test(opts.feePayer)) {
    throw new Error(`feePayer must be a bare entity id "shard.realm.num" (got "${opts.feePayer}")`);
  }
  const { recipient, asset, amount } = paymentInstructions(request);
  if (asset.kind === "nft") {
    throw new Error(
      "x402's exact scheme covers native-coin and fungible-token amounts — an NFT cannot be priced by amount",
    );
  }
  // x402 wants the full CAIP-2 chain ("hedera:testnet"); the validated
  // recipient CAIP-10 string carries it as everything before its last segment.
  const chain = request.recipient.slice(0, request.recipient.lastIndexOf(":"));
  return {
    scheme: "exact",
    network: chain,
    asset: asset.kind === "hbar" ? NATIVE_ASSET : asset.id,
    amount: amount.toString(),
    payTo: recipient,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 180,
    extra: { feePayer: opts.feePayer },
  };
}

/** Direct JSON, or the base64 header value decoded then parsed; else undefined. */
function candidateJson(text: string): unknown {
  for (const attempt of [text, base64Decoded(text)]) {
    if (attempt === undefined) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      /* not this spelling — try the next */
    }
  }
  return undefined;
}

function base64Decoded(text: string): string | undefined {
  if (!/^[A-Za-z0-9+/]+=*$/.test(text) || text.length < 16) return undefined;
  try {
    return atob(text);
  } catch {
    return undefined;
  }
}
