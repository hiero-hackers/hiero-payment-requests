# Contributing to hiero-payment-requests

Thanks for considering a contribution! This project follows the practices of
the wider Hiero / LF Decentralized Trust ecosystem, including our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

Zero runtime dependencies and public-registry dev tooling — a plain
`npm install` works with no tokens.

```sh
npm install
npm run verify      # THE gate suite — everything CI and the release run
npm run format      # prettier --write, when verify complains about style
npm run build       # emits dist/
```

`verify` is the single source of truth for "the gates": typecheck (src,
tests, examples), lint, format check, tests with coverage floors, API docs,
package lint (publint + attw), and the pack smoke test. CI and the release
workflow run the same list — if `verify` passes locally, CI agrees. Commits need a DCO sign-off (`git commit -s`).
Maintainers: the release runbook is [RELEASING.md](./RELEASING.md).

## Ground rules

- **It computes the facts; the caller's policy decides what they mean.**
  `Fulfilment` reports observations (`underpaid`, `late`, …) — never verdicts
  ("acceptable", "settled"). A change that bakes in a business judgement is
  a change of philosophy; open an issue first.
- **Money is `bigint`, everywhere.** Amounts are integers in the smallest
  unit; no float ever touches a value; there are no decimals on the wire.
- **The core is pure.** No network, no clock reads (`now` is a parameter),
  no runtime dependencies. Adapters stay structural so this library depends
  on nothing and nothing must depend on it.
- **Matching is deterministic.** Same chain facts in, same fulfilment out —
  including payment ordering (consensus order, not arrival order).
