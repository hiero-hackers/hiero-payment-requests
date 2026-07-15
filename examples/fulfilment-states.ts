/**
 * Every answer the matcher can give — the reason this library exists.
 *
 *   node examples/fulfilment-states.ts
 *
 * One invoice, eight things a customer might actually do. Each is a *different
 * fact*, and a hand-rolled `if (amount === expected)` collapses all of them into
 * "paid / not paid" — which is how merchants end up short, refunding nothing on
 * duplicates, and arguing with customers who did pay.
 *
 * Runs offline in milliseconds: this library is pure, so the example is too.
 * The payments below are hand-built rather than fetched — in a real integration
 * they'd come from `fromReceipt(...)` over a mirror or stream client.
 * Needs `npm install && npm run build`.
 */
import { match, type Payment, type PaymentRequest, type Fulfilment } from "../dist/index.js";

const USDC = { kind: "token", network: "mainnet", id: { shard: 0n, realm: 0n, num: 720n } } as const;
const DECIMALS = 6;

// A 100 USDC invoice, expiring at a known consensus timestamp.
const invoice: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n, // smallest unit — always an integer, never a decimal
  reference: "INV-2026-041",
  expiresAt: "1783012345.000000000",
};

/** A payment crediting our account, with sensible defaults per scenario. */
function paid(amount: bigint, over: Partial<Payment> = {}): Payment {
  return {
    transactionId: "0.0.999@1783012000.000000000",
    consensusTimestamp: "1783012000.000000000",
    network: "mainnet",
    memo: "INV-2026-041",
    succeeded: true,
    credits: [{ account: "0.0.1234", asset: USDC, amount }],
    ...over,
  };
}

interface Scenario {
  readonly what: string;
  readonly payments: Payment[];
  readonly why: string;
  /** Consensus timestamp to judge from. Defaults to before the deadline. */
  readonly now?: string;
}

const BEFORE_DEADLINE = "1783012100.000000000";
const AFTER_DEADLINE = "1783012999.000000000";

const scenarios: Scenario[] = [
  { what: "nobody has paid yet", payments: [], why: "the request is still open" },

  {
    what: "nobody paid, and the deadline has passed",
    payments: [],
    now: AFTER_DEADLINE,
    why: "the only difference from the row above is `now` — that's why match takes it",
  },

  { what: "pays exactly 100", payments: [paid(100_000000n)], why: "the boring case, and the only one a naive matcher gets right" },

  { what: "pays only 60", payments: [paid(60_000000n)], why: "you need the SHORTFALL, not just 'false'" },

  {
    what: "pays twice (100 + 100)",
    payments: [paid(100_000000n, { transactionId: "a" }), paid(100_000000n, { transactionId: "b" })],
    why: "surfaced with BOTH transactions so you can refund one — not swallowed as 'already paid'",
  },

  {
    what: "pays in two halves (50 + 50)",
    payments: [paid(50_000000n, { transactionId: "a" }), paid(50_000000n, { transactionId: "b" })],
    why: "same reference aggregates into one running total",
  },

  {
    what: "sends 100, but the token skims a 2% custom fee",
    payments: [paid(98_000000n)],
    why: "THE TRAP: match the sender's intent and you'd call this paid, and be 2 short forever",
  },

  {
    what: "sends HBAR instead of USDC",
    payments: [paid(100_000000n, { credits: [{ account: "0.0.1234", asset: { kind: "hbar", network: "mainnet" }, amount: 100_000000n }] })],
    why: "someone DID send something — that's not 'unpaid', and the difference matters when they email you",
  },

  {
    what: "pays on testnet",
    payments: [paid(100_000000n, { network: "testnet" })],
    why: "reads as unpaid, correctly: the network rides inside the CAIP-10 recipient, so a testnet payment never even claims a mainnet invoice",
  },

  {
    what: "pays 100, an hour after the deadline",
    payments: [paid(100_000000n, { consensusTimestamp: "1783015999.000000000" })],
    now: AFTER_DEADLINE,
    why: "`late` is a FACT, not a rejection — whether you accept it is your call, not ours",
  },
];

// ── Report ───────────────────────────────────────────────────────────────

console.log(`\nInvoice ${invoice.reference} — ${format(invoice.amount)} USDC to ${invoice.recipient}`);
console.log(`Deadline: consensus ${invoice.expiresAt}\n`);

for (const { what, payments, why, now } of scenarios) {
  const result = match(invoice, payments, { now: now ?? BEFORE_DEADLINE });
  console.log(`  ${what}`);
  console.log(`    → ${describe(result)}`);
  console.log(`      ${why}\n`);
}

/** Render a Fulfilment the way a merchant's dashboard might. */
function describe(f: Fulfilment): string {
  const late = "late" in f && f.late ? "  [LATE]" : "";
  switch (f.status) {
    case "unpaid":
      return "UNPAID";
    case "expired":
      return "EXPIRED — nothing arrived before the deadline";
    case "wrong-asset":
      return `WRONG-ASSET — ${f.payments.length} payment(s) carried the reference, none credited USDC`;
    case "underpaid":
      return `UNDERPAID — received ${format(f.received)}, short ${format(f.shortfall)}${late}`;
    case "overpaid":
      return `OVERPAID — received ${format(f.received)} across ${f.payments.length} payment(s), excess ${format(f.excess)}${late}`;
    case "paid":
      return `PAID — received ${format(f.received)} across ${f.payments.length} payment(s)${late}`;
  }
}

/**
 * Whole units from smallest units, exactly — integer split, never a float.
 * Deliberately local: this library doesn't render money. Formatting needs the
 * token's decimals and a house style, which is `hiero-receipts`' job, not ours.
 */
function format(amount: bigint, decimals = DECIMALS): string {
  const scale = 10n ** BigInt(decimals);
  const frac = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${amount / scale}.${frac}` : `${amount / scale}`;
}
