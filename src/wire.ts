// SPDX-License-Identifier: Apache-2.0
/**
 * The wire format — how a request travels: a URI for QR codes and links, a
 * JSON form for APIs. One version, one set of fields, both round-tripping
 * exactly.
 *
 *   hiero-pay:hedera:mainnet:0.0.1234-vfmkw?v=1&asset=hedera%3Amainnet%2Ftoken%3A0.0.720&amount=100000000&ref=INV-2026-041
 *
 * Design rules, each learned somewhere:
 *
 * - **`hiero-pay:`, not `hedera:`.** `hedera:` is CAIP-2's namespace and
 *   already means something inside our identifiers; a URI scheme is not
 *   ours to squat. The recipient rides verbatim after the scheme, so the
 *   CAIP machinery — network inside the identifier, verified HIP-15
 *   checksums — transfers wholesale.
 * - **Amounts are integer base-unit strings.** Never decimals: BIP-21 put
 *   decimal BTC in its URIs and has been generating float bugs ever since
 *   (the same rule as `PaymentRequest.amount` itself).
 * - **Strict, versioned parsing.** Unknown parameters are ERRORS, not
 *   ignored — a typo'd `amonut=` silently dropped is an unpaid invoice and
 *   a support ticket. Evolution happens by bumping `v`; a version newer
 *   than this build understands is rejected saying so. (Same philosophy as
 *   the rest of the stack's flags and config keys.)
 * - **Decoding validates.** `fromURI`/`decodeRequest` run the result
 *   through `createRequest`, so a shared request with a bad checksum or a
 *   cross-network asset fails at the moment of scanning, not three weeks
 *   later when nothing matches.
 *
 * The JSON form is specified by `schema/payment-request.v1.schema.json`
 * (shipped in the package) — the contract, not a suggestion.
 */
import { createRequest, RequestError } from "./request.js";
import type { PaymentRequest } from "./types.js";

export const WIRE_VERSION = 1;
const SCHEME = "hiero-pay:";

/**
 * The v1 wire vocabulary — URI parameter ↔ JSON key, in canonical order
 * (same request, same URI, same QR code). This table is the ONE place the
 * field set lives: `KNOWN_PARAMS` and `KNOWN_JSON_KEYS` derive from it, and
 * a sync test holds the JSON schema to it. The recipient is not here on
 * purpose — it rides in the URI path, not the query.
 */
export const WIRE_FIELDS = [
  { param: "v", json: "v" },
  { param: "asset", json: "asset" },
  { param: "amount", json: "amount" },
  { param: "ref", json: "reference" },
  { param: "exp", json: "expiresAt" },
  { param: "label", json: "label" },
] as const;

const KNOWN_PARAMS = WIRE_FIELDS.map((f) => f.param) as readonly string[];

/** Encode a request as a `hiero-pay:` URI (validates first — an invalid
 *  request must fail here, not on every scanner that receives it). */
export function toURI(request: PaymentRequest): string {
  createRequest(request);
  const params: string[] = [
    `v=${WIRE_VERSION}`,
    `asset=${encodeURIComponent(request.asset)}`,
    `amount=${request.amount}`,
    `ref=${encodeURIComponent(request.reference)}`,
  ];
  if (request.expiresAt !== undefined) params.push(`exp=${encodeURIComponent(request.expiresAt)}`);
  if (request.label !== undefined) params.push(`label=${encodeURIComponent(request.label)}`);
  return `${SCHEME}${request.recipient}?${params.join("&")}`;
}

/** Decode and VALIDATE a `hiero-pay:` URI. Throws `RequestError`/`CaipError`. */
export function fromURI(uri: string): PaymentRequest {
  if (!uri.startsWith(SCHEME)) {
    throw new RequestError(`not a ${SCHEME} URI: "${truncate(uri)}"`);
  }
  const qmark = uri.indexOf("?");
  if (qmark === -1) throw new RequestError(`missing query in "${truncate(uri)}"`);
  const recipient = uri.slice(SCHEME.length, qmark);

  const params = new Map<string, string>();
  for (const pair of uri.slice(qmark + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) throw new RequestError(`malformed parameter "${truncate(pair)}"`);
    const key = pair.slice(0, eq);
    if (!KNOWN_PARAMS.includes(key)) {
      throw new RequestError(
        `unknown parameter "${key}" — not ignored, because a mistyped parameter ` +
          `silently dropped is an unpaid invoice`,
      );
    }
    if (params.has(key)) throw new RequestError(`duplicate parameter "${key}"`);
    params.set(key, decodeURIComponent(pair.slice(eq + 1)));
  }

  checkVersion(params.get("v"));
  const request: PaymentRequest = {
    recipient,
    asset: required(params, "asset"),
    amount: parseAmount(required(params, "amount")),
    reference: required(params, "ref"),
    ...(params.has("exp") ? { expiresAt: params.get("exp")! } : {}),
    ...(params.has("label") ? { label: params.get("label")! } : {}),
  };
  createRequest(request); // full validation: checksums, networks, expiry shape
  return request;
}

/**
 * Wrap the URI in a universal link: `toLink(r, "https://pay.example.com/")`
 * → `https://pay.example.com/#hiero-pay:…`.
 *
 * Why this exists: no phone acts on a bare `hiero-pay:` QR until wallets
 * register the scheme — a camera decodes it and shrugs ("no usable data
 * found"). An https link opens everywhere TODAY; the page it opens unwraps
 * the request with `fromLink` and takes it from there.
 *
 * The request rides in the FRAGMENT deliberately: fragments are never sent
 * over the network, so the payment details stay out of server, proxy, and
 * access logs — the page reads them client-side only.
 *
 * The base must be https (plain-http localhost is allowed, for developing
 * the page itself): a payment link must not downgrade.
 */
export function toLink(request: PaymentRequest, base: string): string {
  if (!base.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(base)) {
    throw new RequestError(
      `link base must be https:// (got "${truncate(base)}") — a payment link must not ` +
        `downgrade to plain http (localhost excepted, for development)`,
    );
  }
  if (base.includes("#")) {
    throw new RequestError(`link base already carries a fragment: "${truncate(base)}"`);
  }
  return `${base}#${toURI(request)}`;
}

/** Unwrap and VALIDATE a universal link built by `toLink`. Throws
 *  `RequestError`/`CaipError` — same guarantees as `fromURI`. */
export function fromLink(link: string): PaymentRequest {
  const hash = link.indexOf("#");
  if (hash === -1) {
    throw new RequestError(
      `no fragment in "${truncate(link)}" — expected …#${SCHEME}, as built by toLink`,
    );
  }
  return fromURI(link.slice(hash + 1));
}

/**
 * One front door for scanned or pasted input: dispatch to whichever wire
 * form `text` is — `hiero-pay:` URI, https universal link, or the JSON
 * form — and parse it with that form's FULL strictness. Only the dispatch
 * is generous (and it tolerates surrounding whitespace, because paste
 * buffers have feelings); everything after it is the same strict parser
 * you would have called yourself.
 */
export function fromAny(text: string): PaymentRequest {
  const trimmed = text.trim();
  if (trimmed.startsWith(SCHEME)) return fromURI(trimmed);
  if (/^https?:\/\//.test(trimmed)) return fromLink(trimmed);
  if (trimmed.startsWith("{")) return decodeRequest(trimmed);
  throw new RequestError(
    `unrecognised payment request: "${truncate(trimmed)}" — expected a ${SCHEME} URI, ` +
      `an https link with a #${SCHEME} fragment, or the JSON form`,
  );
}

/** Encode a request as canonical JSON (bigint amount as an exact string). */
export function encodeRequest(request: PaymentRequest): string {
  createRequest(request);
  return JSON.stringify({
    v: WIRE_VERSION,
    recipient: request.recipient,
    asset: request.asset,
    amount: request.amount.toString(),
    reference: request.reference,
    ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {}),
    ...(request.label !== undefined ? { label: request.label } : {}),
  });
}

const KNOWN_JSON_KEYS = new Set(["recipient", ...WIRE_FIELDS.map((f) => f.json)]);

/** Decode and VALIDATE the JSON form. Throws `RequestError`/`CaipError`. */
export function decodeRequest(json: string): PaymentRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new RequestError("not valid JSON", { cause: err });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RequestError("expected a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !KNOWN_JSON_KEYS.has(k));
  if (unknown.length > 0) {
    throw new RequestError(`unknown key(s): ${unknown.join(", ")}`);
  }
  checkVersion(typeof record.v === "number" ? String(record.v) : (record.v as string | undefined));
  const str = (key: string): string => {
    const value = record[key];
    if (typeof value !== "string") throw new RequestError(`"${key}" must be a string`);
    return value;
  };
  const request: PaymentRequest = {
    recipient: str("recipient"),
    asset: str("asset"),
    amount: parseAmount(str("amount")),
    reference: str("reference"),
    ...(record.expiresAt !== undefined ? { expiresAt: str("expiresAt") } : {}),
    ...(record.label !== undefined ? { label: str("label") } : {}),
  };
  createRequest(request);
  return request;
}

function checkVersion(v: string | undefined): void {
  if (v === undefined) throw new RequestError('missing version ("v")');
  if (!/^[0-9]+$/.test(v)) throw new RequestError(`bad version "${v}"`);
  const version = Number(v);
  if (version > WIRE_VERSION) {
    throw new RequestError(
      `wire version ${version} is newer than this build understands (${WIRE_VERSION}) — ` +
        `was the library downgraded?`,
    );
  }
  if (version < 1) throw new RequestError(`bad version "${v}"`);
}

function required(params: ReadonlyMap<string, string>, key: string): string {
  const value = params.get(key);
  if (value === undefined) throw new RequestError(`missing required parameter "${key}"`);
  return value;
}

/** Integer base units only — the wire carries no decimals, ever. */
function parseAmount(text: string): bigint {
  if (!/^[0-9]+$/.test(text)) {
    throw new RequestError(
      `amount "${text}" is not an integer — the wire carries base units ` +
        `(tinybar / token smallest unit), never decimals`,
    );
  }
  return BigInt(text);
}

function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
