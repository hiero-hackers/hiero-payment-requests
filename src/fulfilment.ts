// SPDX-License-Identifier: Apache-2.0
/**
 * The JSON codec for a `Fulfilment` — the other half of the vocabulary made
 * storable. The moment a merchant webhooks a verdict, writes it to a database,
 * or posts it between workers, `JSON.stringify` throws on the first `bigint`
 * ("Do not know how to serialize a BigInt") — and everyone hand-rolls a
 * slightly different replacer, on money fields. This is that codec, once:
 * amounts as exact strings, assets as their CAIP-19 text, versioned and
 * strict like the request wire format.
 *
 * `decodeFulfilment(encodeFulfilment(f))` is the identity — pinned by a
 * property test over verdicts produced by `match` itself.
 */
import { formatAsset, parseAsset } from "./caip/index.js";
import { RequestError } from "./request.js";
import type { Credit, Fulfilment, Payment } from "./types.js";

/** Version of this JSON encoding — independent of the request wire format. */
export const FULFILMENT_VERSION = 1;

const STATUSES = ["unpaid", "expired", "wrong-asset", "underpaid", "paid", "overpaid"] as const;

/** Encode a fulfilment as canonical JSON: exact-string amounts, CAIP-19
 *  assets, stable key order (same verdict, same bytes). */
export function encodeFulfilment(fulfilment: Fulfilment): string {
  const base: Record<string, unknown> = { v: FULFILMENT_VERSION, status: fulfilment.status };
  if (fulfilment.status === "unpaid" || fulfilment.status === "expired") {
    return JSON.stringify(base);
  }
  if (fulfilment.status === "wrong-asset") {
    return JSON.stringify({ ...base, payments: fulfilment.payments.map(encodePayment) });
  }
  return JSON.stringify({
    ...base,
    received: fulfilment.received.toString(),
    ...(fulfilment.status === "underpaid" ? { shortfall: fulfilment.shortfall.toString() } : {}),
    ...(fulfilment.status === "overpaid" ? { excess: fulfilment.excess.toString() } : {}),
    late: fulfilment.late,
    payments: fulfilment.payments.map(encodePayment),
  });
}

/** Decode and VALIDATE the JSON form. Strict like `decodeRequest`: unknown
 *  keys, missing fields, and non-integer amounts are errors, never guesses. */
export function decodeFulfilment(json: string): Fulfilment {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new RequestError("not valid JSON", { cause: err });
  }
  const record = asRecord(raw, "fulfilment");
  const version = record.v;
  if (version !== FULFILMENT_VERSION) {
    throw new RequestError(
      `fulfilment version ${JSON.stringify(version)} is not ${FULFILMENT_VERSION} — ` +
        `was it encoded by a newer build?`,
    );
  }
  const status = record.status;
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) {
    throw new RequestError(`unknown fulfilment status ${JSON.stringify(status)}`);
  }

  switch (status as (typeof STATUSES)[number]) {
    case "unpaid":
    case "expired":
      rejectUnknownKeys(record, ["v", "status"]);
      return { status: status as "unpaid" | "expired" };
    case "wrong-asset":
      rejectUnknownKeys(record, ["v", "status", "payments"]);
      return { status: "wrong-asset", payments: decodePayments(record.payments) };
    case "underpaid": {
      rejectUnknownKeys(record, ["v", "status", "received", "shortfall", "late", "payments"]);
      return {
        status: "underpaid",
        received: integer(record.received, "received"),
        shortfall: integer(record.shortfall, "shortfall"),
        late: bool(record.late, "late"),
        payments: decodePayments(record.payments),
      };
    }
    case "paid":
      rejectUnknownKeys(record, ["v", "status", "received", "late", "payments"]);
      return {
        status: "paid",
        received: integer(record.received, "received"),
        late: bool(record.late, "late"),
        payments: decodePayments(record.payments),
      };
    case "overpaid":
      rejectUnknownKeys(record, ["v", "status", "received", "excess", "late", "payments"]);
      return {
        status: "overpaid",
        received: integer(record.received, "received"),
        excess: integer(record.excess, "excess"),
        late: bool(record.late, "late"),
        payments: decodePayments(record.payments),
      };
  }
}

// ── Payments and credits, same discipline ───────────────────────────────────

function encodePayment(payment: Payment): Record<string, unknown> {
  return {
    transactionId: payment.transactionId,
    consensusTimestamp: payment.consensusTimestamp,
    network: payment.network,
    memo: payment.memo,
    succeeded: payment.succeeded,
    credits: payment.credits.map((credit) => ({
      account: credit.account,
      asset: formatAsset(credit.asset),
      amount: credit.amount.toString(),
    })),
  };
}

function decodePayments(value: unknown): Payment[] {
  if (!Array.isArray(value)) throw new RequestError('"payments" must be an array');
  return value.map((entry, index) => {
    const record = asRecord(entry, `payments[${index}]`);
    rejectUnknownKeys(record, [
      "transactionId",
      "consensusTimestamp",
      "network",
      "memo",
      "succeeded",
      "credits",
    ]);
    if (!Array.isArray(record.credits)) {
      throw new RequestError(`payments[${index}].credits must be an array`);
    }
    const credits: Credit[] = record.credits.map((raw, creditIndex) => {
      const credit = asRecord(raw, `payments[${index}].credits[${creditIndex}]`);
      rejectUnknownKeys(credit, ["account", "asset", "amount"]);
      return {
        account: str(credit.account, "account"),
        asset: parseAsset(str(credit.asset, "asset")),
        amount: integer(credit.amount, "amount"),
      };
    });
    return {
      transactionId: str(record.transactionId, "transactionId"),
      consensusTimestamp: str(record.consensusTimestamp, "consensusTimestamp"),
      network: str(record.network, "network"),
      memo: str(record.memo, "memo"),
      succeeded: bool(record.succeeded, "succeeded"),
      credits,
    };
  });
}

// ── Small strict readers ────────────────────────────────────────────────────

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestError(`${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(record: Record<string, unknown>, known: readonly string[]): void {
  const unknown = Object.keys(record).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new RequestError(`unknown key(s): ${unknown.join(", ")}`);
}

function str(value: unknown, name: string): string {
  if (typeof value !== "string") throw new RequestError(`"${name}" must be a string`);
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new RequestError(`"${name}" must be a boolean`);
  return value;
}

/** Exact-string integers only — the same rule as the request wire. */
function integer(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new RequestError(
      `"${name}" must be an integer string of base units (got ${JSON.stringify(value)})`,
    );
  }
  return BigInt(value);
}
