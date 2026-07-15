# hiero-payment-requests (TypeScript)

**Ask for a Hedera payment, and prove it was made.**

A payment request built on the CAIP identifiers Hedera already standardised, and
the **matching rule** that decides whether a transaction fulfils it. Pure — no
network, no runtime dependencies. You bring the transactions. Prototype.

```
create request  →  share it        →  observe the chain  →  match
CAIP-10/CAIP-19    QR / link /        your data client      paid | underpaid |
                   WalletConnect                            overpaid | late | …
```

Every merchant, exchange, and payment integration on Hedera hand-rolls this:
*generate a unique reference → watch for a transaction carrying it → mark paid.*
Everyone gets the same edge cases wrong, and no two systems can read each other's
requests. This is that, once, carefully.

## Quick start

```sh
npm install && npm run build
```

```ts
import { createRequest, match } from "hiero-payment-requests";

const request = {
  recipient: "hedera:mainnet:0.0.1234",        // CAIP-10 — carries the network
  asset:     "hedera:mainnet/token:0.0.720",   // CAIP-19
  amount:    100_000000n,                      // smallest unit, always an integer
  reference: "INV-2026-041",
  expiresAt: "1783012345.000000000",           // consensus timestamp, not wall clock
};

createRequest(request);          // validates now, not three weeks from now
match(request, payments);        // → { status: "paid", received: 100000000n, late: false }
```

## The answer is not a boolean

That's the whole reason this is a library. A customer can underpay, overpay, pay
twice, pay late, pay the wrong asset, pay on the wrong network, or pay a token
that skims a custom fee on the way. Each is a **different fact**, and you need to
know which one happened:

```ts
type Fulfilment =
  | { status: "unpaid" }
  | { status: "expired" }
  | { status: "wrong-asset"; payments }
  | { status: "underpaid"; received; shortfall; payments; late }
  | { status: "paid";      received;            payments; late }
  | { status: "overpaid";  received; excess;    payments; late }
```

**It computes the facts; your policy decides what they mean.** The library never
decides whether an overpayment counts as settled, or whether ninety seconds late
is acceptable — those are yours.

See every answer it can give, for one invoice and ten things a customer might
actually do — offline, in milliseconds:

```sh
node examples/fulfilment-states.ts
```

```
  pays twice (100 + 100)
    → OVERPAID — received 200 across 2 payment(s), excess 100
      surfaced with BOTH transactions so you can refund one — not swallowed as 'already paid'

  sends 100, but the token skims a 2% custom fee
    → UNDERPAID — received 98, short 2
      THE TRAP: match the sender's intent and you'd call this paid, and be 2 short forever
```

## The traps it handles

- **Custom fees.** An HTS token can skim a fractional fee — a customer sends 100,
  you're credited 98. Matching reads the recipient's **credit**, never the
  sender's debit. Naive integrations mark that paid and come up short.
- **Double payment** → `overpaid` with *both* transactions attached, so you can
  refund one. Never silently swallowed.
- **Partial payments** aggregate: three transfers with one reference → `paid`.
- **Late** is judged on the **consensus timestamp**. A payer's laptop clock isn't
  a fact.
- **Timestamps aren't strings.** `"10.9"` is *later* than `"10.000000000"`; a
  lexical compare says otherwise. Nanos are padded and compared as integers.
- **Wrong network** can't settle a request — the network rides inside the CAIP
  identifier, so a testnet payment never fulfils a mainnet invoice.
- **`bigint` throughout.** Amounts are smallest-unit integers; entity ids are
  64-bit. CAIP-76's own test vector is `9223372036854775807` — a `number`-based
  parser corrupts the spec's own example.

## Built on the standard, not around it

We adopt [HIP-30](https://hips.hedera.com/HIP/hip-30.html) (which subsumes
HIP-20) and [CAIP-76](https://standards.chainagnostic.org/CAIPs/caip-76):

| CAIP-2 chain | `hedera:mainnet` |
|---|---|
| **CAIP-10 account** | `hedera:mainnet:0.0.1234` (+ HIP-15 checksum) |
| **CAIP-19 token** | `hedera:mainnet/token:0.0.720` |
| **CAIP-19 NFT** | `hedera:mainnet/nft:0.0.721/3` |

`hedera:` was never ours to claim — it's already the CAIP-2 namespace. And
WalletConnect speaks CAIP natively (that's *why* HIP-30 exists), so this asks no
wallet to adopt anything new.

> **⚠ One provisional identifier.** HIP-30 defines `token:` and `nft:` but **no
> identifier for native HBAR** — so *"pay me 100 ℏ"* can't name its asset in the
> standard. We use `hedera:mainnet/slip44:3030`, following CAIP-19's convention
> for native coins (`eip155:1/slip44:60`). **This is not in HIP-30**, is flagged
> provisional in the code, and the coin type needs confirming against SLIP-0044.
> Closing that gap upstream is the first contribution this repo should make.

## How it composes

`fulfils()` returns a predicate that is *structurally* a `Condition<Receipt>` in
[`hiero-notifications`](https://github.com/hiero-hackers/hiero-notifications) —
so the loop closes with **no dependency in either direction**:

```ts
import { watch, accountWatcher } from "hiero-notifications";
import { fulfils, fromReceipt } from "hiero-payment-requests";

await watch({
  watcher: accountWatcher({ accounts: ["0.0.1234"] }),
  condition: fulfils(request, (r) => fromReceipt(r, "mainnet")),
  deliveries: [markInvoicePaid],
});
```

```
hiero-payment-requests  →  hiero-notifications  →  hiero-receipts
  issue the request         watch for fulfilment    issue the receipt
```

## What it deliberately doesn't do

Fetch anything · render a QR (the request is a string — hand it to any QR
library) · decide settlement · value anything in fiat (that's `hiero-receipts`).

## Known open question

Correlation assumes **wallets let a payer set a memo**. That's an empirical claim
about the wallet ecosystem and it is **not yet verified**. If it doesn't hold,
correlation needs a different strategy — unique amounts, an account per invoice,
or **scheduled transactions**, where correlation stops being a heuristic and
becomes a fact. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest — the CAIP tests run the specs' own literal vectors
npm run build       # → dist/
```

## License

Apache-2.0
