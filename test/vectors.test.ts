/**
 * The official wire vectors, enforced. `vectors/wire.v1.json` ships in the
 * package for OTHER implementations of `hiero-pay:` to test against — which
 * makes it the one file that must never drift from this implementation. Every
 * valid vector must decode to exactly its fields and re-encode to exactly its
 * strings (canonicality, both forms); every invalid vector must be rejected.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromURI, toURI, decodeRequest, encodeRequest, fromAny } from "../src/index.js";
import type { PaymentRequest } from "../src/index.js";

interface ValidVector {
  readonly name: string;
  readonly uri: string;
  readonly json: string;
  readonly request: Record<string, string>;
}
interface InvalidVector {
  readonly name: string;
  readonly uri: string;
  readonly reason: string;
}

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/wire.v1.json", import.meta.url), "utf8"),
) as { wireVersion: number; valid: ValidVector[]; invalid: InvalidVector[] };

const toRequest = (fields: Record<string, string>): PaymentRequest =>
  ({ ...fields, amount: BigInt(fields.amount!) }) as unknown as PaymentRequest;

describe("official vectors: valid entries round-trip exactly, both forms", () => {
  it("covers a healthy spread and unique names", () => {
    expect(vectors.wireVersion).toBe(1);
    expect(vectors.valid.length).toBeGreaterThanOrEqual(10);
    expect(vectors.invalid.length).toBeGreaterThanOrEqual(15);
    const names = [...vectors.valid, ...vectors.invalid].map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const vector of vectors.valid) {
    it(vector.name, () => {
      const request = toRequest(vector.request);
      // Decode: the strings yield exactly the documented fields.
      expect(fromURI(vector.uri)).toEqual(request);
      expect(decodeRequest(vector.json)).toEqual(request);
      expect(fromAny(vector.uri)).toEqual(request);
      // Encode: the documented fields yield exactly the strings — the
      // canonicality promise the $comment makes to other implementations.
      expect(toURI(request)).toBe(vector.uri);
      expect(encodeRequest(request)).toBe(vector.json);
    });
  }
});

describe("official vectors: invalid entries are rejected", () => {
  for (const vector of vectors.invalid) {
    it(`${vector.name} — ${vector.reason}`, () => {
      expect(() => fromURI(vector.uri)).toThrow();
    });
  }
});
