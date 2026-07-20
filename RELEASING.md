# Releasing & operating this repo

The runbook for maintainers — everything that is not derivable from the code.

## One-time repo settings (after first push)

1. **Pages** — Settings → Pages → Source: _GitHub Actions_ (API-docs deploy).
2. **Branch protection** on `main` requiring the CI checks and DCO.
3. Trigger the Scorecard workflow once so the badge populates.

No package-access grants are needed: this repo's CI is fully tokenless
(zero runtime deps, public dev tooling). Consumers installing the published
package DO need a GitHub Packages `read:packages` token — that is GitHub's
rule, documented in the README.

## Cutting a release

```sh
# 1. bump "version" in package.json, land on main through a PR
# 2. tag the merge commit:
git switch main && git pull
git tag -s v0.1.1 -m "hiero-payment-requests 0.1.1"
git push origin v0.1.1
```

The tag push runs the gates, checks tag == package.json version, attests
build provenance, publishes to GitHub Packages, and cuts a GitHub Release
with generated notes. Re-runs are idempotent. Anyone can verify a downloaded
tarball came from this repo's workflow:

```sh
gh attestation verify hiero-hackers-hiero-payment-requests-*.tgz   --repo hiero-hackers/hiero-payment-requests
```

## ⚠ First release only: flip the package public

GitHub Packages **ignores `--access public`** — a package's very first
publish always lands **PRIVATE**, and visibility can only be changed by a
human in the UI (this bit the enterprise-js packages at 0.1.0). After
v0.1.0 publishes:

1. https://github.com/orgs/hiero-hackers/packages → `hiero-payment-requests`
2. Package settings → Danger Zone → **Change visibility** → Public

Only the FIRST publish needs this — visibility is per-package, and later
versions inherit it. The release workflow's "Audit package visibility" step
prints a warning with this URL if the package is still private; check the
run summary.

## Dependency policy

- **This library has no runtime dependencies, on purpose** — including on
  its stack siblings. `ReceiptLike` (receipts) and the `Condition` shape
  (notifications) are structural contracts; see docs/ARCHITECTURE.md.
  Adding a runtime dependency is an architecture change; open an issue.
- **TypeScript majors are ignored by Dependabot on purpose** (see
  `.github/dependabot.yml`): the 7.x native compiler drops the JS API that
  typescript-eslint and typedoc load.
- The org intends an eventual **npmjs migration**; when it happens, drop
  `publishConfig.registry` and claim the scope.

## Maintenance notes

- **Coverage floors ratchet** (`vitest.config.ts`): raise when coverage
  rises; never lower silently.
- **Wording of `Fulfilment` statuses is API** — consumers switch on the
  strings. Adding a status is minor; renaming one is breaking.
- **Bumping `engines`**: also grep `.github/workflows` for hardcoded
  `node-version:`.
