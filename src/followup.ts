// SPDX-License-Identifier: Apache-2.0
/**
 * After the verdict — the two follow-ups a fulfilment can call for, as pure
 * derivations. `remainderRequest` re-presents an underpaid request for what's
 * left; `refundInstructions` states what an overpayment or wrong-asset
 * payment owes back. Facts both: this library never moves money.
 */
import { entityKey, sameEntity, tryParseEntityId, assetKey } from "./caip/index.js";
import type { AssetRef, EntityId, Network } from "./caip/index.js";
import { toInstructedAsset, type InstructedAsset } from "./instructions.js";
import { creditedTotal } from "./match/tally.js";
import { createRequest, RequestError } from "./request.js";
import type { Fulfilment, Payment, PaymentRequest } from "./types.js";

/**
 * The request to show an underpaying customer for what is still owed:
 * `{ ...request, amount: shortfall }` — **the same reference, deliberately**.
 *
 * The trap this function exists to close: minting a fresh reference for the
 * shortfall SPLITS THE CORRELATION. The first payment stays attached to the
 * old reference, the second to the new one — the original request sits at
 * `underpaid` forever and the new one shows a mysterious standalone payment.
 * With the same reference, the second payment accumulates into the original
 * match, which is already cumulative by design: 60 + 40 against 100 is
 * `paid`, and `fulfilsAccumulating` fires on the payment that completes it.
 *
 * Any status other than `underpaid` throws: there is no remainder to ask
 * for, and a QR for a nonexistent debt is a bug worth failing on.
 */
export function remainderRequest(request: PaymentRequest, fulfilment: Fulfilment): PaymentRequest {
  if (fulfilment.status !== "underpaid") {
    throw new RequestError(
      `no remainder to ask for: the request is ${fulfilment.status}, not underpaid`,
    );
  }
  const remainder = { ...request, amount: fulfilment.shortfall };
  createRequest(remainder); // same guarantees as any other request
  return remainder;
}

/** One refund the merchant owes — a fact, not an action. */
export interface RefundInstruction {
  /**
   * The refund target — **a heuristic, and the doc is the warning**: it is
   * the transaction's fee payer, read from the transaction id. `Payment`
   * deliberately carries only credits (the custom-fee lesson), so who was
   * DEBITED is not visible here. For a person paying from their own wallet
   * the fee payer is the sender; for a custodial sender it may be an
   * exchange's hot wallet, and refunding an exchange hot wallet is how
   * funds get lost. `undefined` when the transaction id carries no
   * parseable payer. A production merchant should confirm the refund
   * address with the customer when the payment looks custodial.
   */
  readonly to: string | undefined;
  readonly network: Network;
  readonly asset: InstructedAsset;
  /** Base units, positive. */
  readonly amount: bigint;
  /** `REFUND <reference>` — carries the original reference, so the payer's
   *  own matching can correlate the refund. The loop closes both ways. */
  readonly memo: string;
  /** The payment being refunded. */
  readonly forTransaction: string;
}

/**
 * What this fulfilment owes back, per contributing payment:
 *
 * - `overpaid` → the excess, in the requested asset, attributed to the
 *   LATEST payments first (consensus order): the request was first-come-
 *   first-served, so the payment that overshot is the one refunded — a
 *   double payment refunds exactly the second transaction.
 * - `wrong-asset` → each payment's full credited amount, in the asset that
 *   actually arrived (that is the only honest amount: nothing of it was
 *   asked for).
 * - every other status → `[]`: nothing is owed back. (Contrast
 *   `remainderRequest`, which throws — asking for a remainder that does not
 *   exist is a caller bug; owing no refund is just a fact.)
 */
export function refundInstructions(
  request: PaymentRequest,
  fulfilment: Fulfilment,
): RefundInstruction[] {
  const resolved = createRequest(request);
  const memo = `REFUND ${request.reference}`;
  const network = resolved.recipient.network;

  if (fulfilment.status === "overpaid") {
    const instructions: RefundInstruction[] = [];
    let remaining = fulfilment.excess;
    for (const payment of [...fulfilment.payments].reverse()) {
      if (remaining === 0n) break;
      const credited = creditedTotal(payment, resolved);
      const refund = credited < remaining ? credited : remaining;
      remaining -= refund;
      instructions.push({
        to: feePayer(payment.transactionId),
        network,
        asset: toInstructedAsset(resolved.asset),
        amount: refund,
        memo,
        forTransaction: payment.transactionId,
      });
    }
    return instructions.reverse(); // back to consensus order for the caller
  }

  if (fulfilment.status === "wrong-asset") {
    const instructions: RefundInstruction[] = [];
    for (const payment of fulfilment.payments) {
      for (const { asset, amount } of creditedByAsset(payment, resolved.recipient.id)) {
        instructions.push({
          to: feePayer(payment.transactionId),
          network,
          asset: toInstructedAsset(asset),
          amount,
          memo,
          forTransaction: payment.transactionId,
        });
      }
    }
    return instructions;
  }

  return [];
}

/** The fee payer named in a transaction id (`0.0.999@1783…` or mirror-style
 *  `0.0.999-1783…`), as a bare id — or `undefined` when there is none. */
function feePayer(transactionId: string): string | undefined {
  const match = /^(\d+\.\d+\.\d+)[@-]/.exec(transactionId);
  if (match === null) return undefined;
  const id = tryParseEntityId(match[1]!);
  return id === undefined ? undefined : entityKey(id);
}

/** Everything one payment credited `recipient`, summed per asset. */
function creditedByAsset(
  payment: Payment,
  recipient: EntityId,
): { asset: AssetRef; amount: bigint }[] {
  const byAsset = new Map<string, { asset: AssetRef; amount: bigint }>();
  for (const credit of payment.credits) {
    const account = tryParseEntityId(credit.account);
    if (account === undefined || !sameEntity(account, recipient)) continue;
    const key = assetKey(credit.asset);
    const entry = byAsset.get(key);
    if (entry === undefined) byAsset.set(key, { asset: credit.asset, amount: credit.amount });
    else entry.amount += credit.amount;
  }
  return [...byAsset.values()];
}
