# Security Policy

This project aligns with the security-reporting practices of the
[LF Decentralized Trust](https://lf-decentralized-trust.github.io/governance/governing-documents/SECURITY-POLICY)
ecosystem that the wider Hiero project follows.

## Reporting a vulnerability

Please **do not** open a public issue for anything you believe to be a
security vulnerability. Instead, use
[GitHub private vulnerability reporting](../../security/advisories/new)
("Report a vulnerability" under the repository's Security tab).

Include what you can: affected file/function, a proof-of-concept input, and
the impact you foresee. You will get an acknowledgement within a few days.

## Scope notes for reporters

Areas of this library that are security-relevant by design and welcome
scrutiny:

- **Correlation is memo-based, and memos are attacker-writable.** Anyone can
  send a transaction whose memo carries someone else's invoice reference.
  Correlation alone must never imply payment — matching also tallies what
  the recipient actually _received_. Anything that lets a memo inflate a
  tally, or lets a crafted reference match requests it shouldn't, is a
  serious bug (`src/match/correlate.ts` documents the bet).
- **CAIP parsing is the input boundary.** Requests and assets are parsed
  from caller-supplied CAIP-10/CAIP-19 strings; parser confusion between
  networks or entity ids would defeat the cross-network and cross-asset
  checks (`src/caip/`).
- **Amount arithmetic is `bigint` end to end.** Anything that coerces an
  amount through a float, or lets a tally overflow/underflow silently, is in
  scope.
