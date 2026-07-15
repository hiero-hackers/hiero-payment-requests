/**
 * Stage 2 — **what did the recipient actually receive?**
 *
 * ────────────────────────────────────────────────────────────────────────
 * The single subtlest rule in the library, and the one every hand-rolled
 * integration gets wrong:
 *
 *   **Read the recipient's CREDIT, never the sender's debit.**
 *
 * An HTS token can carry custom fees. A customer sends 100, a fractional fee
 * skims 2, and you are credited 98. Match on what the sender *intended* and you
 * mark that paid and are 2 short — silently, forever, on every transaction.
 *
 * This is also why a `hiero-receipts` receipt is the natural input: its
 * `movements` are the account's **net** position, so the fee is already
 * deducted by the time it reaches us.
 * ────────────────────────────────────────────────────────────────────────
 */
import { sameAsset, sameEntity, tryParseEntityId, type AccountRef } from "../caip/index.js";
import type { ResolvedRequest } from "../request.js";
import type { Payment } from "../types.js";

/**
 * A tally shows its working — what was examined, what counted, and the total.
 *
 * `claimed` is carried through deliberately. The next stage needs it: "three
 * payments carried the reference but none credited us" is a *different fact*
 * from "nobody paid", and only the difference between `claimed` and `paying`
 * can tell them apart.
 */
export interface Tally {
  /** Everything that claimed to be for this request — what stage 1 handed us. */
  readonly claimed: readonly Payment[];
  /** Of those, the ones that actually credited the recipient in the requested
   *  asset. A payment can claim (right reference) yet contribute nothing. */
  readonly paying: readonly Payment[];
  /** Total credited to the recipient, in the requested asset, smallest unit. */
  readonly received: bigint;
}

/** Sum what these payments credited the recipient, in the requested asset. */
export function tally(claimed: readonly Payment[], resolved: ResolvedRequest): Tally {
  const { recipient, asset } = resolved;
  let received = 0n;
  const paying: Payment[] = [];

  for (const payment of claimed) {
    let credited = 0n;
    for (const credit of payment.credits) {
      if (!creditsRecipient(credit.account, recipient)) continue;
      if (!sameAsset(credit.asset, asset)) continue;
      credited += credit.amount;
    }
    if (credited > 0n) {
      received += credited;
      paying.push(payment);
    }
  }
  return { claimed, paying, received };
}

function creditsRecipient(account: string, recipient: AccountRef): boolean {
  const id = tryParseEntityId(account);
  return id !== undefined && sameEntity(id, recipient.id);
}
