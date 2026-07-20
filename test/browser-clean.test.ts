/**
 * The browser guarantee, pinned. hiero-checkout is a browser app and this
 * library is its bedrock: `src/` must run identically in Node and a browser,
 * which means no Node builtins, no `Buffer`, no `process` — web APIs only
 * (`TextEncoder` and friends are fine everywhere). The README claims it;
 * this test is why the claim cannot rot when someone reaches for `node:fs`
 * in a future adapter. (Tests and examples may use Node freely — the fence
 * is around `src/`.)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

// Node builtins that would break a browser build — with or without the
// `node:` prefix. The bare list covers the common ones; the prefix form
// covers everything.
const FORBIDDEN_IMPORT =
  /from\s+["'](node:[^"']*|fs|path|os|url|crypto|http|https|net|tls|zlib|stream|buffer|child_process|worker_threads|events|util)["']/;

describe("every source file declares its license — LFDT convention, checked", () => {
  // Hiero/LFDT projects carry per-file SPDX headers; adopting the convention
  // now is one less diff at migration time, and this check keeps new files
  // from shipping without one.
  for (const file of sourceFiles(SRC)) {
    it(`${file.slice(SRC.length)} starts with the SPDX header`, () => {
      expect(readFileSync(file, "utf8").startsWith("// SPDX-License-Identifier: Apache-2.0")).toBe(
        true,
      );
    });
  }
});

describe("src/ is browser-clean — checkout builds on this", () => {
  const files = sourceFiles(SRC);

  it("finds the sources it is guarding", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const name = file.slice(SRC.length);
    it(`${name} imports no Node builtins and touches no Node globals`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(FORBIDDEN_IMPORT);
      expect(source).not.toMatch(/\brequire\s*\(/);
      expect(source).not.toMatch(/\bBuffer\./);
      expect(source).not.toMatch(/\bprocess\./);
    });
  }
});
