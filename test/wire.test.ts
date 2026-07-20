/**
 * The wire format — round-trip exactness (property-based, with hostile
 * references), strict rejection of everything the design forbids, and the
 * JSON schema as an enforced contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import ajv2020 from "ajv/dist/2020.js";

// ajv ships CJS; under NodeNext its default import types as the module
// namespace — the class constructor lives on .default.
const Ajv2020 = ajv2020 as unknown as typeof ajv2020.default;
import {
  toURI,
  fromURI,
  toLink,
  fromLink,
  fromAny,
  encodeRequest,
  decodeRequest,
  RequestError,
} from "../src/index.js";
import { BASE, arbRequest } from "./fixtures.js";
import { WIRE_FIELDS } from "../src/wire.js";

describe("round trips are exact", () => {
  it("URI: fromURI(toURI(r)) ≡ r, for hostile references and 64-bit amounts", () => {
    fc.assert(
      fc.property(arbRequest(), (r) => {
        expect(fromURI(toURI(r))).toEqual(r);
      }),
    );
  });

  it("JSON: decodeRequest(encodeRequest(r)) ≡ r", () => {
    fc.assert(
      fc.property(arbRequest(), (r) => {
        expect(decodeRequest(encodeRequest(r))).toEqual(r);
      }),
    );
  });

  it("encoding is canonical — the same request always yields the same URI", () => {
    expect(toURI(BASE)).toBe(toURI({ ...BASE }));
  });
});

describe("strictness: the wire rejects, never guesses", () => {
  const uri = toURI(BASE);

  it("an unknown parameter is an error, with the reason in the message", () => {
    expect(() => fromURI(`${uri}&amonut=5`)).toThrow(/unknown parameter "amonut"/);
  });

  it("a decimal amount is rejected citing the base-units rule", () => {
    expect(() => fromURI(uri.replace("amount=100000000", "amount=1.5"))).toThrow(/never decimals/);
  });

  it("a newer wire version is rejected saying so", () => {
    expect(() => fromURI(uri.replace("v=1", "v=2"))).toThrow(/newer than this build/);
  });

  it("a missing version is rejected — versioning is not optional", () => {
    expect(() => fromURI(uri.replace("v=1&", ""))).toThrow(/missing version/);
  });

  it("duplicate parameters are rejected — ambiguity is not resolved silently", () => {
    expect(() => fromURI(`${uri}&amount=5`)).toThrow(/duplicate parameter "amount"/);
  });

  it("decoding VALIDATES: a bad checksum in a scanned URI fails at the scanner", () => {
    expect(() =>
      fromURI(
        "hiero-pay:hedera:mainnet:0.0.1234-wrong?v=1&asset=hedera%3Amainnet%2Ftoken%3A0.0.720&amount=1&ref=X",
      ),
    ).toThrow(); // CaipError from checksum verification
  });

  it("JSON: unknown keys and numeric amounts are rejected", () => {
    const good = JSON.parse(encodeRequest(BASE));
    expect(() => decodeRequest(JSON.stringify({ ...good, surprise: 1 }))).toThrow(/unknown key/);
    expect(() => decodeRequest(JSON.stringify({ ...good, amount: 100000000 }))).toThrow(
      RequestError,
    );
  });

  it("URI: a different scheme is refused, and long garbage is truncated in the error", () => {
    expect(() => fromURI("hedera:mainnet:0.0.1?v=1")).toThrow(/not a hiero-pay: URI/);
    // A wall of garbage must not be echoed back whole — errors end up in logs.
    expect(() => fromURI(`bitcoin:${"x".repeat(500)}`)).toThrow(/…/);
  });

  it("JSON: non-JSON and non-object payloads are refused", () => {
    expect(() => decodeRequest("not json {")).toThrow(/not valid JSON/);
    expect(() => decodeRequest("[1,2,3]")).toThrow(/expected a JSON object/);
    expect(() => decodeRequest("null")).toThrow(/expected a JSON object/);
    expect(() => decodeRequest('"hiero-pay:..."')).toThrow(/expected a JSON object/);
  });

  it("URI: structural damage is named — no query, a bare word, a missing required param", () => {
    expect(() => fromURI("hiero-pay:hedera:mainnet:0.0.1")).toThrow(/missing query/);
    expect(() => fromURI(`${uri}&junk`)).toThrow(/malformed parameter "junk"/);
    expect(() => fromURI(uri.replace(/&ref=[^&]*/, ""))).toThrow(
      /missing required parameter "ref"/,
    );
  });

  it("versions below 1 and non-numeric versions are refused", () => {
    expect(() => fromURI(uri.replace("v=1", "v=abc"))).toThrow(/bad version "abc"/);
    expect(() => fromURI(uri.replace("v=1", "v=0"))).toThrow(/bad version "0"/);
  });

  it("JSON: wrong-typed fields are named, and a string v is still understood", () => {
    const good = JSON.parse(encodeRequest(BASE));
    expect(() => decodeRequest(JSON.stringify({ ...good, reference: 5 }))).toThrow(
      /must be a string/,
    );
    // Tolerant in what shape the version arrives (1 vs "1"), strict in its value.
    expect(decodeRequest(JSON.stringify({ ...good, v: "1" }))).toEqual(BASE);
    expect(() => decodeRequest(JSON.stringify({ ...good, v: "2" }))).toThrow(/newer than/);
  });
});

const schema = JSON.parse(
  readFileSync(new URL("../schema/payment-request.v1.schema.json", import.meta.url), "utf8"),
) as object;

describe("the JSON schema is the contract", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);

  it("every encodeRequest output validates", () => {
    fc.assert(
      fc.property(arbRequest(), (r) => {
        const ok = validate(JSON.parse(encodeRequest(r)));
        expect(validate.errors ?? []).toEqual([]);
        expect(ok).toBe(true);
      }),
    );
  });

  it("the schema rejects what decodeRequest rejects", () => {
    const good = JSON.parse(encodeRequest(BASE));
    expect(validate({ ...good, surprise: 1 })).toBe(false);
    expect(validate({ ...good, amount: 100000000 })).toBe(false);
    expect(validate({ ...good, v: 2 })).toBe(false);
  });
});

describe("universal links: an https wrapper for phones that shrug at hiero-pay:", () => {
  const BASE_URL = "https://pay.example.com/";

  it("round-trips: fromLink(toLink(r, base)) ≡ r", () => {
    fc.assert(
      fc.property(arbRequest(), (r) => {
        expect(fromLink(toLink(r, BASE_URL))).toEqual(r);
      }),
    );
  });

  it("the request rides in the fragment — never sent to the server", () => {
    const link = toLink(BASE, BASE_URL);
    expect(link.startsWith(`${BASE_URL}#hiero-pay:`)).toBe(true);
  });

  it("refuses a plain-http base — a payment link must not downgrade", () => {
    expect(() => toLink(BASE, "http://pay.example.com/")).toThrow(/must be https/);
  });

  it("allows plain-http localhost, for developing the page itself", () => {
    expect(fromLink(toLink(BASE, "http://localhost:5173/"))).toEqual(BASE);
    expect(fromLink(toLink(BASE, "http://127.0.0.1/"))).toEqual(BASE);
  });

  it("refuses a base that already carries a fragment", () => {
    expect(() => toLink(BASE, "https://pay.example.com/#section")).toThrow(/already carries/);
  });

  it("fromLink names the problem when there is no fragment", () => {
    expect(() => fromLink("https://pay.example.com/")).toThrow(/no fragment/);
  });

  it("fromLink VALIDATES like fromURI — a tampered fragment fails loudly", () => {
    expect(() => fromLink(`https://pay.example.com/#hiero-pay:junk`)).toThrow();
  });
});

describe("the wire vocabulary is ONE table", () => {
  // WIRE_FIELDS drives KNOWN_PARAMS and KNOWN_JSON_KEYS in the source; this
  // suite holds the JSON SCHEMA to the same table, so adding a field is one
  // row + one schema property — and forgetting either is a red test, not a
  // silent disagreement between decoder and contract.
  const schemaProperties = Object.keys(
    (schema as { properties: Record<string, unknown> }).properties,
  );

  it("schema properties ≡ recipient + the table's JSON keys", () => {
    expect([...schemaProperties].sort()).toEqual(
      ["recipient", ...WIRE_FIELDS.map((f) => f.json)].sort(),
    );
  });

  it("everything the wire requires, the schema requires", () => {
    expect([...(schema as { required: string[] }).required].sort()).toEqual(
      ["v", "recipient", "asset", "amount", "reference"].sort(),
    );
  });

  it("the param↔json renames are exactly the documented two", () => {
    // A golden pin: this mapping is wire API. ref/exp are short because QR
    // bytes cost pixels; JSON spells them out because nobody scans JSON.
    expect(WIRE_FIELDS.filter((f) => f.param !== f.json)).toEqual([
      { param: "ref", json: "reference" },
      { param: "exp", json: "expiresAt" },
    ]);
  });
});

describe("fromAny: one front door, three strict parsers", () => {
  it("dispatches each wire form to its parser, whitespace tolerated", () => {
    expect(fromAny(toURI(BASE))).toEqual(BASE);
    expect(fromAny(`  ${toURI(BASE)}\n`)).toEqual(BASE);
    expect(fromAny(toLink(BASE, "https://pay.example.com/"))).toEqual(BASE);
    expect(fromAny(encodeRequest(BASE))).toEqual(BASE);
  });

  it("only the dispatch is generous — each form keeps its full strictness", () => {
    expect(() => fromAny(`${toURI(BASE)}&amonut=5`)).toThrow(/unknown parameter/);
    expect(() => fromAny('{"v":1,"surprise":true}')).toThrow(/unknown key/);
    expect(() => fromAny("https://pay.example.com/")).toThrow(/no fragment/);
  });

  it("garbage gets an error naming all three accepted forms", () => {
    expect(() => fromAny("scan me")).toThrow(/hiero-pay: URI.*https link.*JSON form/);
  });
});
