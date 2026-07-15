/**
 * Parsing helpers shared by every identifier layer. Internal — not re-exported
 * from `index.ts`.
 */
import { CaipError } from "./error.js";

/**
 * Split into exactly `count` parts, or throw. Overloaded so callers destructure
 * a real tuple — this is what removes the `as [string, string, string]` cast
 * that `noUncheckedIndexedAccess` otherwise demands in every parser.
 */
export function split(text: string, on: string, count: 2, context: string, expected: string): [string, string];
export function split(text: string, on: string, count: 3, context: string, expected: string): [string, string, string];
export function split(text: string, on: string, count: number, context: string, expected: string): string[] {
  const parts = text.split(on);
  if (parts.length !== count) throw new CaipError(`bad identifier "${text}" in ${context} (${expected})`);
  return parts;
}

/**
 * `parse*` → `tryParse*`. Rethrows anything that isn't a `CaipError`, so a
 * genuine bug never disguises itself as "not a valid identifier".
 */
export function tryParser<A extends unknown[], R>(parse: (...args: A) => R): (...args: A) => R | undefined {
  return (...args) => {
    try {
      return parse(...args);
    } catch (err) {
      if (err instanceof CaipError) return undefined;
      throw err;
    }
  };
}

/** Digits → bigint. Rejects signs, decimals, and empty strings; never lossy. */
export function parseUint(text: string, context: string): bigint {
  if (!/^[0-9]{1,19}$/.test(text)) {
    throw new CaipError(`"${text}" in ${context} is not a 1–19 digit non-negative integer`);
  }
  return BigInt(text);
}
