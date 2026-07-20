/**
 * One invoice, end to end — the whole merchant lifecycle in one file:
 *
 *   create → share (link + QR) → wallet fields → payment arrives → match
 *   → underpaid? ask for the remainder → overpaid? refund instructions
 *
 *   node examples/merchant-flow.ts
 *
 * Runs offline in milliseconds: this library is pure, so the example is too.
 * The "payments" are hand-built; in production they come from your data
 * client via `fromReceipt` (see the README's watch-loop example).
 * Needs `npm install && npm run build`.
 */
import {
  createRequest,
  toLink,
  toQRTerminal,
  paymentInstructions,
  formatBaseUnits,
  parseDecimalAmount,
  match,
  remainderRequest,
  refundInstructions,
  type Payment,
  type PaymentRequest,
} from "@hiero-hackers/hiero-payment-requests";

const USDC = {
  kind: "token",
  network: "mainnet",
  id: { shard: 0n, realm: 0n, num: 720n },
} as const;
const DECIMALS = 6;

// ── 1. Create. The price arrives as human text; parsing is exact or fatal. ──
const request: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: parseDecimalAmount("100.50", DECIMALS), // → 100_500000n, no float involved
  reference: "INV-2026-041",
  label: "Workshop ticket",
};
createRequest(request); // validates NOW — not three weeks from now
console.log(
  `\n1 · created  ${request.reference} for ${formatBaseUnits(request.amount, DECIMALS)} USDC`,
);

// ── 2. Share. The link opens on any phone; the QR is the same URI. ──
console.log(`2 · share    ${toLink(request, "https://pay.example.com/")}`);
console.log(toQRTerminal(request, { invert: true }));

// ── 3. What a wallet adapter needs — CAIP parsing stays in the library. ──
const wallet = paymentInstructions(request);
console.log(
  `3 · wallet   send ${wallet.amount} base units of token ${"id" in wallet.asset ? wallet.asset.id : "HBAR"}` +
    ` to ${wallet.recipient}, memo "${wallet.memo}"`,
);

// ── 4. A payment arrives (underpaid: the customer sent 60). ──
const pay = (amount: bigint, id: string, at: string): Payment => ({
  transactionId: id,
  consensusTimestamp: at,
  network: "mainnet",
  memo: "INV-2026-041",
  succeeded: true,
  credits: [{ account: "0.0.1234", asset: USDC, amount }],
});
const first = pay(60_000000n, "0.0.9@1783012000.000000000", "1783012000.000000000");

const verdict = match(request, [first]);
console.log(
  `4 · match    ${verdict.status}`,
  verdict.status === "underpaid" ? `— short ${formatBaseUnits(verdict.shortfall, DECIMALS)}` : "",
);

// ── 5. Ask for the remainder — SAME reference, so it accumulates. ──
if (verdict.status !== "underpaid") throw new Error("example expects underpaid here");
const remainder = remainderRequest(request, verdict);
console.log(
  `5 · re-ask   ${formatBaseUnits(remainder.amount, DECIMALS)} USDC, reference unchanged (${remainder.reference})`,
);

// The customer pays the remainder QR… generously. Both payments, one match:
const second = pay(50_000000n, "0.0.9@1783012100.000000000", "1783012100.000000000");
const settled = match(request, [first, second]);
console.log(
  `6 · match    ${settled.status}`,
  settled.status === "overpaid" ? `— excess ${formatBaseUnits(settled.excess, DECIMALS)}` : "",
);

// ── 7. Overpaid → what is owed back. Facts, not actions. ──
for (const refund of refundInstructions(request, settled)) {
  console.log(
    `7 · refund   ${formatBaseUnits(refund.amount, DECIMALS)} USDC → ${refund.to ?? "⚠ confirm with customer"} ` +
      `(memo "${refund.memo}", for ${refund.forTransaction})`,
  );
}
console.log();
