/**
 * The QR encoder held to account by an INDEPENDENT implementation: every
 * matrix is rasterized and decoded with jsQR, and must yield the exact input
 * string. A wrong Reed-Solomon table entry, mask formula, or format-info bit
 * cannot pass these tests — same adversarial pattern as the HIP-15 checksum
 * suite (verified against the official SDK's vectors).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import jsQRModule from "jsqr";
import {
  encodeQR,
  toQRMatrix,
  toQRSVG,
  toQRTerminal,
  QrError,
  toURI,
  CaipError,
  type QrEcc,
  type QrMatrix,
} from "../../src/index.js";
import { BASE, arbRequest } from "../fixtures.js";

// jsqr ships CJS; under NodeNext the default import binds the module
// namespace — the function itself lives on .default.
type JsQr = typeof jsQRModule.default;
const jsQR: JsQr = jsQRModule.default ?? (jsQRModule as unknown as JsQr);

/** Paint the matrix into RGBA pixels the way a camera would see it. */
function decode(qr: QrMatrix): string | undefined {
  const scale = 4;
  const quiet = 4;
  const span = (qr.size + 2 * quiet) * scale;
  const rgba = new Uint8ClampedArray(span * span * 4);
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const row = Math.floor(y / scale) - quiet;
      const col = Math.floor(x / scale) - quiet;
      const dark = row >= 0 && col >= 0 && row < qr.size && col < qr.size && qr.modules[row]![col]!;
      const value = dark ? 0 : 255;
      const i = 4 * (y * span + x);
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  }
  return jsQR(rgba, span, span)?.data;
}

describe("every version × level decodes back exactly (jsQR as the adversary)", () => {
  // The shortest payload that forces `version` — found by doubling + binary
  // search on the encoder itself, so the test cannot drift from the capacity
  // table it is checking. Probes force mask 0 to skip the 8-mask penalty
  // search; only the final, asserted encode chooses its mask properly.
  const shortestFor = (version: number, ecc: QrEcc): string => {
    const versionAt = (n: number): number => {
      try {
        return encodeQR("x".repeat(n), { ecc, mask: 0 }).version;
      } catch {
        return Infinity; // over capacity — "higher than any version"
      }
    };
    let high = 1;
    while (versionAt(high) < version) high *= 2;
    let low = Math.floor(high / 2); // versionAt(low) < version (or low = 0)
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (versionAt(mid) < version) low = mid;
      else high = mid;
    }
    return "x".repeat(high);
  };

  const LEVELS: readonly QrEcc[] = ["L", "M", "Q", "H"];
  for (const ecc of LEVELS) {
    for (let version = 1; version <= 10; version++) {
      it(`version ${version}, level ${ecc}`, { timeout: 30_000 }, () => {
        const text = shortestFor(version, ecc);
        const qr = encodeQR(text, { ecc });
        expect(qr.version).toBe(version);
        expect(qr.size).toBe(17 + 4 * version);
        expect(decode(qr)).toBe(text);
      });
    }
  }
});

describe("all eight masks decode", () => {
  for (let mask = 0; mask < 8; mask++) {
    it(`forced mask ${mask}`, () => {
      const qr = encodeQR(toURI(BASE), { mask });
      expect(qr.mask).toBe(mask);
      expect(decode(qr)).toBe(toURI(BASE));
    });
  }
});

describe("arbitrary requests survive the camera", () => {
  // Narrowed for speed (small payloads, one network), never forked: the
  // same canonical generator the wire suite uses.
  const arb = arbRequest({ networks: ["mainnet"], assets: ["hbar"], maxRefLength: 30 });

  it("decode(rasterize(toQRMatrix(r))) ≡ toURI(r) — unicode references included", () => {
    fc.assert(
      fc.property(arb, (r) => {
        expect(decode(toQRMatrix(r))).toBe(toURI(r));
      }),
      { numRuns: 30 },
    );
  });
});

describe("refusals are loud and name the fix", () => {
  it("an oversized payload names the capacity and the remedies", () => {
    expect(() => encodeQR("x".repeat(300), { ecc: "H" })).toThrow(QrError);
    expect(() => encodeQR("x".repeat(300), { ecc: "H" })).toThrow(/shorten the label/);
    expect(() => encodeQR("x".repeat(280), { ecc: "L" })).toThrow(QrError);
  });

  it("a nonsense mask is rejected", () => {
    expect(() => encodeQR("x", { mask: 8 })).toThrow(/mask must be 0–7/);
    expect(() => encodeQR("x", { mask: -1 })).toThrow(QrError);
  });

  it("toQRSVG VALIDATES the request — a bad checksum never becomes a code", () => {
    expect(() => toQRSVG({ ...BASE, recipient: "hedera:mainnet:0.0.1234-wrong" })).toThrow(
      CaipError,
    );
  });
});

describe("renderers", () => {
  it("the SVG is standalone, deterministic, and carries the quiet zone", () => {
    const svg = toQRSVG(BASE);
    const size = toQRMatrix(BASE).size;
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`); // 4 modules each side
    expect(svg).toContain('fill="#fff"'); // background painted, not assumed
    expect(svg).toContain('aria-label="QR code"');
    expect(toQRSVG(BASE)).toBe(svg);
  });

  it("SVG colours are configurable", () => {
    const svg = toQRSVG(BASE, { dark: "#123", light: "#eee", quiet: 2 });
    expect(svg).toContain('fill="#123"');
    expect(svg).toContain('fill="#eee"');
  });

  it("terminal output is two modules per line, and invert flips every cell", () => {
    const qr = toQRMatrix(BASE);
    const text = toQRTerminal(BASE);
    expect(text.split("\n")).toHaveLength(Math.ceil((qr.size + 4) / 2));
    const inverted = toQRTerminal(BASE, { invert: true });
    expect(inverted).not.toBe(text);
    // A full block in one is never a full block in the other.
    expect([...text].some((ch, i) => ch === "█" && inverted[i] === "█")).toBe(false);
  });
});
