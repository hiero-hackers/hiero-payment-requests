/**
 * CAIP-2 — the chain: `hedera:mainnet`.
 *
 * The bottom of the stack: an account (CAIP-10) and an asset (CAIP-19) are both
 * *a chain plus something*, so both build on this.
 */
import { CaipError } from "./error.js";
import { split } from "./parse.js";

/**
 * The networks, and the `Network` type derived from them — one source of truth.
 * Adding a network here is the whole change; the type follows automatically.
 */
const NETWORKS = ["mainnet", "testnet", "previewnet", "devnet"] as const;
export type Network = (typeof NETWORKS)[number];

export const NAMESPACE = "hedera";

/** Parse `hedera:mainnet`. Throws `CaipError`. */
export function parseChain(caip2: string): Network {
  const [namespace, network] = split(caip2, ":", 2, caip2, "expected namespace:network");
  if (namespace !== NAMESPACE) {
    throw new CaipError(`unsupported CAIP namespace "${namespace}" in ${caip2} (expected "${NAMESPACE}")`);
  }
  if (!isNetwork(network)) throw new CaipError(`unknown Hedera network "${network}" in ${caip2}`);
  return network;
}

export function formatChain(network: Network): string {
  return `${NAMESPACE}:${network}`;
}

export function isNetwork(text: string): text is Network {
  return (NETWORKS as readonly string[]).includes(text);
}
