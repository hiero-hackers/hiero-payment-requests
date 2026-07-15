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

export interface ReceiptLike {
  readonly account: string;
  readonly transactionId: string;
  readonly consensusTimestamp: string;
  readonly status: "success" | "failed";
  readonly movements: readonly MovementLike[];
  readonly memo?: string;
}

/**
 * Convert a receipt into a candidate payment on `network`.
 *
 * The network is a parameter because a receipt doesn't carry one — the caller
 * knows which network they queried. Passing the wrong one is the one way to
 * defeat the cross-network check in `match`, so pass it from the same config
 * that built your data client.
 *
 * Only **positive** movements become credits: a receipt for an account that
 * *sent* funds is not a payment *to* it.
 */
export function fromReceipt(receipt: ReceiptLike, network: Network): Payment {
  const credits: Credit[] = [];
  for (const movement of receipt.movements) {
    if (movement.amount <= 0n) continue;
    credits.push({
      account: receipt.account,
      asset:
        movement.kind === "hbar"
          ? { kind: "hbar", network }
          : { kind: "token", network, id: parseEntityId(movement.asset, `movement asset "${movement.asset}"`) },
      amount: movement.amount,
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
