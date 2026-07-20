// SPDX-License-Identifier: Apache-2.0
/**
 * Decimal display and input for base-unit amounts — the two conversions every
 * consumer needs and every hand-rolled version gets wrong the same way: a
 * detour through `Number` that corrupts sub-cent digits. Money is `bigint`
 * here; these are pure string arithmetic, and no float touches a value.
 *
 * The pair is deliberately asymmetric in strictness. `formatBaseUnits` is
 * total for any bigint. `parseDecimalAmount` REJECTS what it cannot represent
 * exactly — too many decimal places is an error, not a rounding: silently
 * turning a customer's "0.1234567" into a different number is precisely the
 * bug class this module exists to end.
 */
import { RequestError } from "./request.js";

const MAX_DECIMALS = 50;

function checkDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RequestError(
      `decimals must be an integer between 0 and ${MAX_DECIMALS} (got ${decimals})`,
    );
  }
}

export interface FormatBaseUnitsOptions {
  /** Trim trailing fraction zeros (`"100.000000"` → `"100"`, `"1.500000"` →
   *  `"1.5"`). Default false: full precision is unambiguous. */
  readonly trim?: boolean;
}

/**
 * Base units → exact decimal text: `formatBaseUnits(100_000000n, 6)` →
 * `"100.000000"`. Signed amounts format with their sign (receipts show
 * negative movements); `decimals: 0` formats with no point at all.
 */
export function formatBaseUnits(
  amount: bigint,
  decimals: number,
  options: FormatBaseUnitsOptions = {},
): string {
  checkDecimals(decimals);
  const sign = amount < 0n ? "-" : "";
  const digits = (amount < 0n ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  if (decimals === 0) return `${sign}${whole}`;
  let fraction = digits.slice(digits.length - decimals);
  if (options.trim) fraction = fraction.replace(/0+$/, "");
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * Decimal text → base units, exactly or not at all:
 * `parseDecimalAmount("100.5", 6)` → `100_500000n`.
 *
 * Strict on purpose. Digits with one optional point (`"100"`, `"100.5"`) —
 * no sign, no exponent, no grouping (a comma gets a pointed error, because
 * `"1,5"` is how half of the world writes one and a half), and **no more
 * fraction digits than the asset has decimals** — rounding a customer's
 * input is not this library's call to make.
 */
export function parseDecimalAmount(text: string, decimals: number): bigint {
  checkDecimals(decimals);
  if (text.includes(",")) {
    throw new RequestError(`"${text}" contains a comma — use a dot as the decimal separator`);
  }
  const parts = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (parts === null) {
    throw new RequestError(
      `"${text}" is not a decimal amount — expected digits with an optional ` +
        `fraction, like "100" or "100.5"`,
    );
  }
  const [, whole, fraction = ""] = parts;
  if (fraction.length > decimals) {
    throw new RequestError(
      `"${text}" has ${fraction.length} decimal places but the asset has ${decimals} — ` +
        `this library will not round someone's money`,
    );
  }
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}
