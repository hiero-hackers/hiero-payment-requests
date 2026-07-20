import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import security from "eslint-plugin-security";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

export default defineConfig(
  globalIgnores(["**/dist/**", "**/node_modules/**", "examples/output/**", "coverage/**"]),

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  prettierConfig,

  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "error",
      // Underscore prefix = deliberately unused (mock signatures, discarded
      // destructures) — the TS convention the default rule doesn't know.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  // Tests read and write their own fixtures by constructed paths — the
  // non-literal-fs rule exists for request-driven server code, not for a
  // test harness addressing its own files.
  {
    files: ["test/**"],
    rules: {
      "security/detect-non-literal-fs-filename": "off",
    },
  },

  // The QR encoder is loop-counter array arithmetic end to end. The
  // object-injection rule exists for attacker-chosen property KEYS; every
  // index here is a number the encoder computed itself, and flagging all of
  // them buries the one warning that might ever matter elsewhere.
  {
    files: ["src/qr/**"],
    rules: {
      "security/detect-object-injection": "off",
    },
  },

  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // The examples and repo scripts are deliberately I/O-ful dev tooling (they
  // read fixtures, write receipts, spawn npm and a headless browser) — the
  // security plugin's non-literal-fs/child-process rules exist for server
  // code handling untrusted paths, not for scripts whose paths are all their
  // own.
  {
    files: ["examples/**", "scripts/**"],
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-child-process": "off",
    },
  },
);
