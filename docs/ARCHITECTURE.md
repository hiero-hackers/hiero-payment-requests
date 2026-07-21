# Architecture

`hiero-payment-requests` is two things: a **request** built on identifiers
Hedera already standardised, and a **matching rule** that says what the chain
thinks of it.

```
create request  →  share it        →  observe the chain  →  match
CAIP-10 / CAIP-19   QR / link /        your data client      paid | underpaid |
(this library)      WalletConnect      (NOT this library)    overpaid | late | …
                    (NOT this library)                       (this library)
```

The library is **pure**: no network, no runtime dependencies, no clock. You
bring the transactions; it tells you what they mean.

## The governing line

> **It computes the facts. Your policy decides what they mean.**

`Fulfilment` reports `overpaid`, `underpaid`, `late`, `wrong-asset` as
_observations_. It does not decide whether an overpayment counts as settled, or
whether a payment ninety seconds after expiry is acceptable. Those are business
judgements. A library that bakes them in is making a decision it has no standing
to make — and every merchant would need a different one.

The one thing that _is_ decided here is **aggregation**: payments carrying the
same reference are summed into a running total. That's factual, not policy —
"these three transfers carry this reference and total 100" is an observation.
It also means a duplicate payment surfaces as `overpaid` with two transactions
attached, rather than being quietly swallowed.

## Why CAIP, and why that settles more than it looks

We adopt [HIP-30](https://hips.hedera.com/HIP/hip-30.html) (which subsumes
HIP-20) and [CAIP-76](https://standards.chainagnostic.org/CAIPs/caip-76) rather
than invent a URI scheme:

|                 |                                                        |
| --------------- | ------------------------------------------------------ |
| CAIP-2 chain    | `hedera:mainnet`                                       |
| CAIP-10 account | `hedera:mainnet:0.0.1234` (+ optional HIP-15 checksum) |
| CAIP-19 token   | `hedera:mainnet/token:0.0.720`                         |
| CAIP-19 NFT     | `hedera:mainnet/nft:0.0.721/3`                         |

Three things fall out of that choice:

- **`hedera:` was never ours to claim.** It is already the CAIP-2 namespace —
  `hedera:mainnet:0.0.1234` _means_ "this account". A `hedera:0.0.1234?amount=…`
  payment scheme would collide head-on with an established grammar.
- **The network rides inside the identifier.** There is no `network` option
  anywhere in this API, and a mainnet request can never silently match a testnet
  payment. That check is free rather than remembered.
- **Wallets are already walking this road.** WalletConnect speaks CAIP natively
  — that is _why_ HIP-30 exists — and the Hedera WalletConnect working group is
  HashPack, Blade, Kabila, Calaxy, Dropp. Building on CAIP means not asking
  anyone to adopt a novel scheme.

A fourth follows from how the identifiers are implemented: **Hedera is the
first network, not the definition.** Everything network-specific — CAIP-2
namespace, HIP-15 ledger id, native coin — is one table (`HIERO_NETWORKS` in
`caip/network.ts`); another Hiero network is a row, and parsing, checksum
verification, and the native-asset form follow from the table — a compile-time
guard keeps the `Network` union in exact sync with it. Two boundaries are deliberate. The set is _closed_ — an unknown
chain is a loud `CaipError` naming the known chains, because the cross-network
guarantees above only hold when nothing unknown slips through. And it is
_Hiero-only_ — `eip155:1` would be trivial to parse and dishonest to accept,
because the matching semantics (memos, `seconds.nanos` consensus time, net
credits after custom fees) are Hiero platform facts, not universal ones.

### The HBAR gap

**HIP-30 defines `token:` and `nft:` but no identifier for HBAR itself.** So the
most common request there is — _pay me 100 ℏ_ — cannot name its asset in the
standard as written.

We follow CAIP-19's convention for native coins (Ethereum uses
`eip155:1/slip44:60`) and use:

```
hedera:mainnet/slip44:3030      ← PROVISIONAL. Not in HIP-30.
```

This is flagged as provisional everywhere it appears (`HBAR_SLIP44` in
`caip.ts`), and the coin type should be confirmed against SLIP-0044 before it is
proposed upstream. It is the one place this library invents an identifier, which
is exactly one place too many — closing it is an upstream conversation, not a
local decision.

## The traps the matcher exists for

Encoding a request is easy. The matcher is the product, because the honest
answer is not a boolean:

- **Custom fees.** An HTS token can skim a fractional fee: a customer sends 100
  and credits you 98. So matching reads the recipient's **credit**, never the
  sender's debit. A `hiero-receipts` `Movement` is the account's _net_ position,
  so the fee is already deducted — which is why the receipt adapter is the
  natural input.
- **Double payment.** Two transfers, same reference → `overpaid` with both
  transactions, so you can refund one. Not "already paid, ignore".
- **Partial and aggregate.** Three transfers summing to the total → `paid`.
- **Late.** Expiry is compared against the **consensus timestamp**, not wall
  clock. A payer's laptop clock is not a fact.
- **Timestamps are not strings or floats.** `"10.9"` and `"10.000000000"` — a
  lexical compare says the second is later. It isn't. Nanos are padded and
  compared as integers.
- **Wrong asset / wrong network / failed transaction.** Each is a distinct
  observation, not a silent `unpaid`.
- **Amounts are `bigint`, in the smallest unit, always.** BIP-21 put decimal BTC
  in the URI and has generated float bugs ever since. Decimals are a display
  concern and need a token-decimals lookup — the caller's problem, not the wire's.
- **Entity ids are `bigint`.** CAIP-76 specifies 64-bit fields and its own test
  vector uses `9223372036854775807`, which is four orders of magnitude past
  `Number.MAX_SAFE_INTEGER`. A `number` parser corrupts the spec's own example.

## Correlation is the load-bearing assumption

A payment is tied to a request by its **memo carrying the reference** —
substring, not equality, because wallets and humans decorate memos
("Inv INV-2026-041 — thanks!"). The cost: a reference must be distinctive enough
not to occur by accident. `INV-2026-041` is; `1` is not.

**This assumes wallets let a payer set a memo.** That is an empirical question
about the wallet ecosystem and it is not yet verified. If it doesn't hold,
correlation needs a different strategy, and the alternatives are real:

| Strategy               | Needs                            | Trade                                                                 |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Memo reference (today) | Wallet memo support              | Free — **unverified**                                                 |
| Unique amount          | Nothing                          | Ugly; collides at scale                                               |
| Account per invoice    | Account creation                 | Unambiguous, costs money                                              |
| Scheduled transaction  | Payer signs a pre-built transfer | Hedera-native; correlation stops being a heuristic and becomes a fact |

That last row is the one no other chain can copy, and it is the most interesting
direction this library could take. Correlation should therefore become
**pluggable** — memo is a default, not an assumption baked into the matcher.

## Module responsibilities

| Module                      | Responsibility                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caip/`                     | Parse/format CAIP-2/10/19. `bigint` ids, HIP-15 checksum verification, the network table. The only place that knows identifier syntax.                                                                                                                                                                         |
| `types.ts`                  | The vocabulary: `PaymentRequest`, `Payment`, `Credit`, `Fulfilment`.                                                                                                                                                                                                                                           |
| `request.ts`                | `createRequest` — validate up front, resolve identifiers once.                                                                                                                                                                                                                                                 |
| `timestamp.ts`              | Consensus-timestamp comparison as integers, never strings.                                                                                                                                                                                                                                                     |
| `match/`                    | The matching rule as a three-stage pipeline: correlate (strategy, injectable — memo default, `byUniqueAmount` + `byTransactionId` shipped) → tally credits → classify. Canonicalization (dedup + consensus order) is the pipeline's, so no strategy can lose it. `amounts.ts` assigns distinct amounts for the memo-free strategy. |
| `wire.ts`                   | The interchange forms: `hiero-pay:` URI, canonical JSON, and the https universal-link wrapper. Strict, versioned; decoding validates.                                                                                                                                                                          |
| `qr/`                       | The QR encoder (ISO 18004, in-house, zero-dep) and SVG/terminal renderers — held to account by an independent decoder in the tests.                                                                                                                                                                            |
| `instructions.ts`           | `paymentInstructions` — the wallet-facing extraction; CAIP knowledge stays in here.                                                                                                                                                                                                                            |
| `followup.ts`               | After the verdict: `remainderRequest` (same reference, deliberately) and `refundInstructions` (facts, never actions).                                                                                                                                                                                          |
| `money.ts`                  | `bigint` ↔ decimal text, exactly or not at all. No float ever touches a value.                                                                                                                                                                                                                                 |
| `adapters/receipt.ts`       | Structural `ReceiptLike` → `Payment`, NFT serials included. No dependency on `hiero-receipts`.                                                                                                                                                                                                                 |
| `adapters/notifications.ts` | `fulfils` / `fulfilsAccumulating` — predicates structurally shaped as `hiero-notifications` conditions, with no dependency in either direction.                                                                                                                                                                |

## What this library does not do

- **Fetch anything.** No mirror client, no streams. The caller owns I/O — the
  same boundary `hiero-receipts` draws.
- **Talk to wallets.** The QR, URI, link, and `paymentInstructions` are the
  hand-off; WalletConnect payloads and per-wallet deep links churn with the
  wallet ecosystem and belong to the checkout app, not a zero-dep library.
- **Decide settlement.** See the governing line.
- **Move money.** `refundInstructions` states what is owed back; sending it
  is the merchant's, with their own controls.
- **Value anything in fiat.** That's `hiero-receipts`.

## How it composes

`fulfils(request, fromReceipt)` returns a predicate that is _structurally_ a
`Condition<Receipt>` in
[`hiero-notifications`](https://github.com/hiero-hackers/hiero-notifications) —
so the loop closes with no dependency in either direction:

```
hiero-payment-requests  →  hiero-notifications  →  hiero-receipts
  issue the request         watch for fulfilment    issue the receipt
```

## Why the stack siblings are not dependencies

`ReceiptLike` duplicates ~10 lines of `hiero-receipts`' `Receipt`, and
`fulfils` returns a `Condition`-shaped object rather than importing the type
from `hiero-notifications`. This is deliberate, and it is the more
maintainable choice, not less:

- A nominal import — even type-only — creates a **versioned dependency**:
  consumers must install the sibling, and semver couples the release
  trains. Structural subsets declare only the fields actually read, so a
  sibling adding a field (receipts added `payer` in 0.1.0) changes nothing
  here.
- The rule of thumb this stack follows: **couple on tools, decouple on
  types, extract domains on demand.** Toolchain and CI patterns are shared
  across repos; small stable boundary types are duplicated; a real domain
  (the `caip/` module is the standing candidate) is extracted into its own
  package only when a second consumer actually exists.
