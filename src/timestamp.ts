/**
 * Consensus timestamps — `seconds.nanos`, as the network writes them.
 *
 * Its own module because it is its own concept, used by both the request
 * builder and the matcher, and because comparing these correctly is subtler
 * than it looks. Two traps live here so they don't live everywhere:
 *
 * - **Not a string compare.** `"10.9"` is *later* than `"10.000000000"`, but
 *   lexically `"9" < "000000000"`. Nanos are padded to nine digits and compared
 *   as integers.
 * - **Not a float.** `Number("1783012345.000000009")` cannot represent that
 *   instant; two transactions nanoseconds apart collapse to the same value.
 *
 * These functions only report; they never throw. The caller decides what a
 * malformed timestamp means — see `request.ts`.
 */

/** Is `a` strictly later than `b`? The question callers actually ask — reading
 *  `compareTimestamps(now, expiry) > 0` requires remembering the sign convention. */
export function isAfter(a: string, b: string): boolean {
  return compareTimestamps(a, b) > 0;
}

/** Compare two consensus timestamps. Returns <0, 0, or >0, like a comparator. */
export function compareTimestamps(a: string, b: string): number {
  const [aSec, aNano] = splitTimestamp(a);
  const [bSec, bNano] = splitTimestamp(b);
  if (aSec !== bSec) return aSec < bSec ? -1 : 1;
  if (aNano !== bNano) return aNano < bNano ? -1 : 1;
  return 0;
}

/** Is this `seconds` or `seconds.nanos`, with at most nine fractional digits? */
export function isConsensusTimestamp(ts: string): boolean {
  return /^[0-9]+(\.[0-9]{1,9})?$/.test(ts);
}

/** `"10.9"` → `[10n, 900000000n]`. Fractional digits are *nanos*, so they pad
 *  right: ".9" is 900 million nanoseconds, not nine. */
function splitTimestamp(ts: string): [bigint, bigint] {
  const dot = ts.indexOf(".");
  if (dot === -1) return [BigInt(ts), 0n];
  return [BigInt(ts.slice(0, dot)), BigInt(ts.slice(dot + 1).padEnd(9, "0"))];
}
