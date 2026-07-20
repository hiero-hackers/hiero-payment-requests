/**
 * The request as a QR code — in your terminal, right now.
 *
 *   node examples/qr.ts
 *
 * Prints a scannable code (point a phone at your terminal) and writes the
 * same request as a standalone SVG to examples/output/. The QR carries
 * exactly the `hiero-pay:` wire URI — any wallet that reads the wire format
 * reads the code. Runs offline: encoding is pure.
 * Needs `npm install && npm run build`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import {
  toURI,
  toQRSVG,
  toQRTerminal,
  type PaymentRequest,
} from "@hiero-hackers/hiero-payment-requests";

const request: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n, // 100 USDC at 6 decimals — base units, always
  reference: "INV-2026-041",
  label: "Coffee subscription, July",
};

console.log(`${toURI(request)}\n`);
// invert: terminals are usually light-on-dark; a scanner needs dark-on-light.
console.log(toQRTerminal(request, { invert: true }));

const outDir = fileURLToPath(new URL("./output/", import.meta.url));
mkdirSync(outDir, { recursive: true });
const svgPath = join(outDir, "payment-qr.svg");
writeFileSync(svgPath, `${toQRSVG(request)}\n`);
console.log(`\nwrote ${relative(process.cwd(), svgPath)} — same request, embeddable anywhere`);
