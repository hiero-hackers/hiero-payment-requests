---
title: "Draft HIP: hiero-pay URI and JSON wire format for Hedera payment requests"
author: "TODO: add primary author(s) and contact information before submission"
type: "Standards Track"
category: "Application"
status: "Draft"
requires:
  - "HIP-30"
  - "HIP-15"
  - "HIP-198"
needs-council-approval: false
discussions-to: "TODO: add a discussion link or mailing list thread before submission"
---

# Draft HIP: hiero-pay URI and JSON wire format for Hedera payment requests

## Abstract

This proposal defines a compact, strict wire format for Hedera payment requests that can be shared as a URI for QR codes and links, or as canonical JSON for APIs. The format is designed to be interoperable with existing CAIP identifiers, to preserve the exact semantics of the reference implementation, and to make validation happen at the moment of receipt rather than later during matching.

## Motivation

Payment integrations on Hedera repeatedly re-implement the same workflow: build a request, share it, and later match a transfer using a reference in the memo. The repository’s implementation shows that the common failure mode is not the matching algorithm alone, but the absence of a shared, strict wire format that can be scanned, pasted, or embedded in a link without ambiguity. A standard wire format makes the hand-off between merchants, wallets, checkouts, and downstream processors explicit and testable.

This proposal is motivated by the same design choices already reflected in the implementation: preserve the CAIP-based identity model, keep amounts as exact integers in the smallest unit, and reject malformed or ambiguous input immediately. The proposal therefore serves as a standards-facing description of the repository’s existing behavior rather than a separate protocol invention.

## Rationale

The proposal uses a URI scheme rather than reusing `hedera:` because `hedera:` is already the CAIP-2 namespace and therefore already carries the meaning of the chain and account identifier grammar. A payment URI is not the same thing as the identifier itself, and reusing the namespace would make the scheme ambiguous with existing CAIP syntax. The implementation therefore reserves `hiero-pay:` as a distinct scheme and places the recipient in the URI path so the CAIP machinery remains authoritative.

The design also intentionally avoids decimal amounts on the wire. Decimals are a display concern and are not reliable for exact payment matching; the implementation encodes amounts as integer base-unit strings, which mirrors the semantics of the request model and avoids the float parsing problems that affected early URI payment formats such as BIP-21.

### Prior art and complementarity

- EIP-681 and BIP-21 define URI schemes for payment requests, but they do so in a way that assumes decimal amounts and interoperability semantics that are not a perfect fit for Hedera’s exact integer smallest-unit model.
- CAIP-358 (`wallet_pay`) defines a JSON-RPC-style payment request flow rather than a compact URI grammar for QR codes, links, or simple paste-based sharing. `hiero-pay:` is therefore complementary to CAIP-358 rather than a duplicate.
- CAIP-19 and CAIP-20 establish the asset identifier conventions for token, NFT, and native-asset forms. This proposal uses those identifier forms for the asset field, and it does not attempt to redefine asset identity itself.

The result is a lightweight application-layer wire format that fits the Hedera ecosystem without claiming ownership of the underlying CAIP identifier syntax.

## User Stories

- A merchant can generate a payment request, encode it as a QR code or universal link, and hand it to a payer without needing a bespoke integration for each wallet.
- A wallet or checkout page can scan or paste a request and validate it immediately, including checksum and network checks, before surfacing it to the user.
- An API client can exchange the same request through JSON and preserve exact semantics across systems without relying on ad-hoc field conventions.
- A downstream payment processor can match later transfers against the signed request while keeping the parsing rules explicit and versioned.

## Specification

This proposal defines the `hiero-pay:` URI scheme, a corresponding canonical JSON payload, and a universal-link wrapper. The normative behavior in this section is derived from the repository implementation in `src/wire.ts` and the shipped schema at `schema/payment-request.v1.schema.json`.

### URI form

A request is encoded as a URI of the form:

`hiero-pay:<recipient>?v=1&asset=<asset>&amount=<amount>&ref=<reference>`

The scheme is `hiero-pay:`. The recipient is a CAIP-10 identifier placed in the URI path immediately after the scheme, using the same syntax as the implementation’s `recipient` field. The query string carries the payment parameters.

### Query parameters and canonical grammar

The URI query vocabulary is the canonical set:

- `v` → wire version
- `asset` → CAIP-19 asset identifier
- `amount` → integer base-unit amount
- `ref` → payment reference
- `exp` → optional expiry timestamp
- `label` → optional human-facing label

The implementation uses the fixed vocabulary defined by `WIRE_FIELDS` and requires each query parameter to appear at most once. Unknown parameters must be rejected. Query values are percent-encoded when written and percent-decoded when read. The canonical parameter order is the order defined by `WIRE_FIELDS` in the implementation: `v`, `asset`, `amount`, `ref`, `exp`, `label`.

### Amount and version rules

Amounts MUST be encoded as integer base-unit strings only, never as decimals. A parser MUST reject any non-numeric amount string, including values containing a decimal point. The wire format is versioned. A decoding implementation MUST require the `v` parameter, MUST reject malformed versions, MUST reject duplicate parameters, and MUST reject versions newer than the implementation understands. The implementation’s `WIRE_VERSION` is `1`.

### JSON form

The canonical JSON form is the object produced by `encodeRequest` and accepted by `decodeRequest`. The fields are:

- `v` (const `1`)
- `recipient` (CAIP-10)
- `asset` (CAIP-19)
- `amount` (exact integer string, smallest unit)
- `reference` (string)
- `expiresAt` (optional consensus timestamp string)
- `label` (optional string)

The normative JSON shape is defined by `schema/payment-request.v1.schema.json`. The schema is the contract for the JSON form and is intended to be kept in lockstep with the URI vocabulary.

### Universal-link wrapper

For environments where bare `hiero-pay:` URIs are not directly actionable by consumer devices, the implementation provides a universal-link wrapper. The URI is placed in the URL fragment of an HTTPS URL using the form `https://...#hiero-pay:...`. The fragment wrapper is intentionally opaque to servers and proxies, and the parser MUST unwrap the fragment and validate the enclosed URI exactly as if it had been received directly.

### QR and application considerations

The reference implementation encodes the URI in byte mode and uses QR versions up to 10 with error-correction level M as a practical default. The implementation’s QR encoder explicitly notes that version 10 / level M has a byte budget of 213 bytes; the proposal therefore treats QR payload length as an application constraint and expects implementations to reject payloads that exceed the available budget rather than silently emit a non-scannable code.

### Conformance and compatibility

Conformance is established by the repository’s canonical test vectors in `vectors/wire.v1.json`. Implementations that claim compatibility with this proposal SHOULD decode each valid vector to the same request fields and re-encode it to the exact canonical URI and JSON strings listed there. Invalid inputs MUST be rejected.

## Backwards Compatibility

No registered `hiero-pay:` scheme currently exists, so this proposal is expected to be introduced as a new application-layer convention rather than as a backward-compatible change to an existing scheme. The universal-link fallback is therefore an important compatibility mechanism: a merchant can publish an HTTPS URL that carries the URI in its fragment, allowing the request to be consumed in environments where the bare scheme is not yet registered by wallets.

The JSON form is additive and versioned, so future wire-version changes can be introduced without changing the semantics of existing `v=1` payloads.

## Security Implications

The format is intentionally strict: decoding validates the request immediately, including CAIP checksum verification and network consistency checks. This reduces the chance that a malformed or cross-network request will be accepted and only discovered later during matching.

The universal-link wrapper places the request in the URL fragment rather than in the URL path or query, so the payment payload is not sent to servers or proxy services by default. That reduces accidental leakage of payment details to logs.

The proposal also inherits an important caveat from the implementation: correlation is currently assumed to be achieved by the memo/reference field. That assumption is practical but not yet verified across the wallet ecosystem, and it remains a known open question rather than a settled guarantee.

## How to Teach This

This proposal should be taught as a narrow, concrete interoperability format rather than as a general-purpose wallet protocol. Implementers should understand three layers: CAIP identifiers define the account and asset, the payment request format defines the payload shape, and the wallet or checkout layer decides how to present and transmit it.

The most useful mental model is that the proposal does not replace CAIP; it composes with it and standardizes the hand-off between systems.

## Reference Implementation

The draft is intentionally aligned with the implementation in this repository, particularly `src/wire.ts`, `src/qr/encode.ts`, `schema/payment-request.v1.schema.json`, and `vectors/wire.v1.json`. The repository serves as the reference implementation for the current wire semantics and conformance behavior.

## Rejected Ideas

- Reusing `hedera:` as the payment URI scheme was rejected because `hedera:` is already the CAIP-2 namespace and should not be overloaded by a distinct application-layer grammar.
- Introducing decimal amounts on the wire was rejected because the implementation and matching model depend on exact integer smallest-unit values and because decimal parsing is a known source of interoperability bugs.
- Treating unknown or duplicate parameters as ignorable input was rejected because silently dropping malformed fields would create unpaid invoices and ambiguous behavior.

## Open Issues

### Native-HBAR dependency gap

The implementation currently uses the provisional native-HBAR asset form `hedera:mainnet/slip44:3030` because HIP-30 defines `token:` and `nft:` but does not define a native-HBAR identifier. This proposal therefore depends on upstream work in HIP-30 / CAIP-19 to resolve the native-HBAR identifier gap.

The open question is whether the slip44 coin type should be confirmed against SLIP-0044 and whether the published Hedera CAIP-19 profile should adopt the slip44 convention that this repository currently uses provisionally. Until that is resolved, this proposal should be understood as relying on a provisional identifier and should be paired with an upstream discussion or companion proposal.

## References

- HIP-30: Hedera asset and account identifiers
- HIP-15: Hedera account checksum and formatting
- HIP-198: relevant Hedera ecosystem context for standards work
- CAIP-2 / CAIP-10 / CAIP-19 / CAIP-20: chain, account, and asset identifier conventions
- CAIP-358: universal payment request / wallet-pay flow
- `schema/payment-request.v1.schema.json` in this repository
- `vectors/wire.v1.json` in this repository
- `src/wire.ts` and `src/qr/encode.ts` in this repository
