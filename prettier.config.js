/**
 * Codifies the repo's existing style (2-space, wide lines) — chosen to
 * match the code, not to reformat it.
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  printWidth: 100,
  endOfLine: "lf",
  trailingComma: "all",
  arrowParens: "always",
};

export default config;
