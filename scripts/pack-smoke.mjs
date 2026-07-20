/**
 * Tarball smoke test: `npm run test:pack`.
 *
 * The unit tests exercise the repo; this exercises the ARTIFACT: `npm pack`,
 * install into a scratch project, and run a real request→match round trip
 * through the published entry point — the only way to catch a missing
 * `files` entry or a broken exports condition before a consumer does.
 * Fully offline: the library is pure.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const scratch = mkdtempSync(join(tmpdir(), "hiero-payment-requests-pack-smoke-"));

try {
  // The `prepare` (build) output lands on stdout too — filename is the LAST line.
  const tarball = execFileSync(npm, ["pack", "--pack-destination", scratch], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  })
    .toString()
    .trim()
    .split("\n")
    .pop();

  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ name: "pack-smoke-consumer", private: true, type: "module" }),
  );
  execFileSync(npm, ["install", "--no-audit", "--no-fund", join(scratch, tarball)], {
    cwd: scratch,
    stdio: "inherit",
  });

  writeFileSync(
    join(scratch, "smoke.mjs"),
    `
import { createRequest, match, fromReceipt } from "@hiero-hackers/hiero-payment-requests";

const request = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n,
  reference: "INV-SMOKE-1",
};
createRequest(request); // validates

const payment = fromReceipt(
  {
    account: "0.0.1234",
    transactionId: "0.0.9-1-1",
    consensusTimestamp: "1.000000000",
    status: "success",
    memo: "paying INV-SMOKE-1",
    movements: [{ asset: "0.0.720", amount: 100_000000n, kind: "token" }],
    provenance: { network: "mainnet" },
  },
  "mainnet",
);
const f = match(request, [payment]);
const assert = (cond, why) => {
  if (!cond) {
    console.error("SMOKE FAIL: " + why + " — got " + JSON.stringify(f, (k, v) => typeof v === "bigint" ? v.toString() : v));
    process.exit(1);
  }
};
assert(f.status === "paid", "exact payment should classify as paid");
assert(f.received === 100_000000n, "received should be exact");
console.log("pack smoke: tarball installs; request → receipt → match round trip works ✓");
`,
  );
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: scratch, stdio: "inherit" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
