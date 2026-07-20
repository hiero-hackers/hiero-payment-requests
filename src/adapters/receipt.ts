// SPDX-License-Identifier: Apache-2.0
/**
 * Adapter: a `hiero-receipts` receipt → a `Payment`.
 *
 * `ReceiptLike` is structural, so this library takes **no dependency** on
 * `hiero-receipts` — the same decoupling that library uses for its own mirror
 * adapter. Anything with these fields works.
 *
 * Why a receipt is the right input: `Receipt.movements` is the account's **net**
 * position, so an HTS custom fee is already deducted. It is what the recipient
 * actually received, which is exactly what matching must read.
 */
import type { Credit, Payment } from "../types.js";
import { parseEntityId, type Network } from "../caip/index.js";

export interface MovementLike {
  /** `"HBAR"` or a token id such as `"0.0.720"`. */
  readonly asset: string;
  /** Net for this account, in the smallest unit. Negative when sent. */
  readonly amount: bigint;
  readonly kind: "hbar" | "token";
}

/** One NFT the account sent or received — `Receipt.nft` in hiero-receipts. */
export interface NftMovementLike {
  readonly tokenId: string;
  readonly serial: bigint;
  readonly direction: "in" | "out";
}

export interface ReceiptLike {
  readonly account: string;
  readonly transactionId: string;
  readonly consensusTimestamp: string;
  readonly status: "success" | "failed";
  readonly movements: readonly MovementLike[];
  /** NFTs travel separately from fungible movements — a serial is not a sum. */
  readonly nft?: readonly NftMovementLike[];
  readonly memo?: string;
  /** Since hiero-receipts 0.1.0 a receipt can carry its network here. */
  readonly provenance?: { readonly network?: string };
}

/**
 * Convert a receipt into a candidate payment on `network`.
 *
 * Receipts built with `fromMirror(tx, { network })` carry their network in
 * `provenance.network` (hiero-receipts ≥ 0.1.0) — when present it must AGREE
 * with the `network` argument, and a mismatch throws rather than silently
 * producing a payment on the wrong chain, because passing the wrong network
 * was the one way to defeat the cross-network check in `match`. Receipts
 * without a stamped network fall back to the argument alone: pass it from
 * the same config that built your data client.
 *
 * Only **positive** movements become credits: a receipt for an account that
 * *sent* funds is not a payment *to* it. Likewise only **incoming** NFTs — each
 * becomes one credit of amount 1 for `nft:<token>/<serial>`, so a request for a
 * specific serial matches exactly that serial and nothing else.
 */
export function fromReceipt(receipt: ReceiptLike, network: Network): Payment {
  const stamped = receipt.provenance?.network;
  if (stamped !== undefined && stamped !== network) {
    throw new Error(
      `receipt ${receipt.transactionId} is stamped "${stamped}" but was presented as "${network}" — ` +
        `a cross-network mix-up upstream, not a payment`,
    );
  }
  const credits: Credit[] = [];
  for (const movement of receipt.movements) {
    if (movement.amount <= 0n) continue;
    credits.push({
      account: receipt.account,
      asset:
        movement.kind === "hbar"
          ? { kind: "hbar", network }
          : {
              kind: "token",
              network,
              id: parseEntityId(movement.asset, `movement asset "${movement.asset}"`),
            },
      amount: movement.amount,
    });
  }
  for (const movement of receipt.nft ?? []) {
    if (movement.direction !== "in") continue;
    credits.push({
      account: receipt.account,
      asset: {
        kind: "nft",
        network,
        id: parseEntityId(movement.tokenId, `NFT token "${movement.tokenId}"`),
        serial: movement.serial,
      },
      amount: 1n,
    });
  }
  return {
    transactionId: receipt.transactionId,
    consensusTimestamp: receipt.consensusTimestamp,
    network,
    memo: receipt.memo ?? "",
    succeeded: receipt.status === "success",
    credits,
  };
}
