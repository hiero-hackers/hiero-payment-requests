/**
 * The README's QR image is not a screenshot — it is committed encoder output,
 * and this test regenerates it byte-for-byte. If the encoder's output ever
 * changes shape, this fails and the fix is one command:
 *
 *   node -e "import('./dist/index.js').then(m => require('fs').writeFileSync(
 *     'docs/example-qr.svg', m.toQRSVG({ recipient: 'hedera:mainnet:0.0.1234',
 *     asset: 'hedera:mainnet/token:0.0.720', amount: 100000000n,
 *     reference: 'INV-2026-041' }) + '\n'))"
 *
 * So the image in the README can never quietly stop being what the library
 * actually produces — the same drift-test bargain as the README↔code checks
 * in the sibling repos.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toQRSVG } from "../../src/index.js";

describe("docs/example-qr.svg is real encoder output", () => {
  it("matches toQRSVG of the documented example request, byte for byte", () => {
    const committed = readFileSync(new URL("../../docs/example-qr.svg", import.meta.url), "utf8");
    const generated = toQRSVG({
      recipient: "hedera:mainnet:0.0.1234",
      asset: "hedera:mainnet/token:0.0.720",
      amount: 100_000000n,
      reference: "INV-2026-041",
    });
    expect(committed).toBe(`${generated}\n`);
  });
});
