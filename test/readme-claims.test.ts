/**
 * The README's concrete outputs, executed. Prose can't drift-test; printed
 * URIs, match results, and instruction objects can — and the very first run
 * of this suite caught the README showing a checksum the library itself
 * rejects (0.0.123's checksum pasted onto 0.0.1234). Same bargain as the
 * committed QR SVG: what the README shows is what the library does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toURI, match, paymentInstructions } from "../src/index.js";
import { BASE, payment } from "./fixtures.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("the README's outputs are real", () => {
  it("the example URI line is genuine toURI output (checksum included)", () => {
    const uri = toURI({ ...BASE, recipient: "hedera:mainnet:0.0.1234-pikcw" });
    // The README elides the asset param with an ellipsis; hold it to the
    // parts it does print — prefix (with a VERIFIED checksum) and tail.
    const prefix = "hiero-pay:hedera:mainnet:0.0.1234-pikcw?v=1";
    const tail = "amount=100000000&ref=INV-2026-041";
    expect(uri.startsWith(prefix)).toBe(true);
    expect(uri.endsWith(tail)).toBe(true);
    expect(README).toContain(prefix);
    expect(README).toContain(tail);
  });

  it("the quick-start match result is what match returns", () => {
    const result = match(BASE, [payment()]);
    expect(result).toMatchObject({ status: "paid", received: 100_000000n, late: false });
    expect(README).toContain('{ status: "paid", received: 100000000n, late: false }');
  });

  it("the paymentInstructions block matches the function", () => {
    expect(paymentInstructions(BASE)).toEqual({
      network: "mainnet",
      recipient: "0.0.1234",
      asset: { kind: "token", id: "0.0.720" },
      amount: 100_000000n,
      memo: "INV-2026-041",
    });
    for (const line of [
      'recipient: "0.0.1234"',
      '{ kind: "token", id: "0.0.720" }',
      'memo: "INV-2026-041"',
    ]) {
      expect(README).toContain(line);
    }
  });
});
