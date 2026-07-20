// SPDX-License-Identifier: Apache-2.0
/**
 * CAIP-2 — the chain: `hedera:mainnet`.
 *
 * The bottom of the stack: an account (CAIP-10) and an asset (CAIP-19) are both
 * *a chain plus something*, so both build on this.
 *
 * **Hedera is the first network here, not the definition of the library.**
 * Everything network-specific — CAIP-2 namespace, HIP-15 ledger id, native
 * coin — lives in ONE table below. Another Hiero network joins by adding a
 * row; the `Network` type, chain parsing, checksum verification, and the
 * native-asset identifier all follow from the table automatically. The set
 * stays closed on purpose: an unknown chain is a loud error, never a guess —
 * that strictness is what makes the cross-network checks in `match` work.
 */
import { CaipError } from "./error.js";
import { split } from "./parse.js";

/** Everything the library must know about one Hiero network — the single row
 *  to add when a new network joins. */
export interface NetworkSpec {
  /** CAIP-2 namespace, e.g. `"hedera"`. */
  readonly namespace: string;
  /** CAIP-2 reference — the `Network` string used across the library. Must be
   *  unique across the table: it is how a parsed identifier names its chain. */
  readonly reference: string;
  /** Ledger id seeding HIP-15 checksum verification (HIP-198 registry).
   *  Absent → checksums on this network cannot be verified, so identifiers
   *  carrying one are rejected rather than waved through. */
  readonly ledgerId?: readonly number[];
  /** SLIP-44 coin type of the network's native coin, for the provisional
   *  `slip44:` asset form — see the note atop `asset.ts`. */
  readonly nativeSlip44: string;
}

const TABLE = [
  { namespace: "hedera", reference: "mainnet", ledgerId: [0x00], nativeSlip44: "3030" },
  { namespace: "hedera", reference: "testnet", ledgerId: [0x01], nativeSlip44: "3030" },
  { namespace: "hedera", reference: "previewnet", ledgerId: [0x02], nativeSlip44: "3030" },
  // devnet has no assigned ledger id — checksums there are unverifiable.
  { namespace: "hedera", reference: "devnet", nativeSlip44: "3030" },
] as const satisfies readonly NetworkSpec[];

/** The network names. Kept in exact sync with the table by the compile-time
 *  guard below — add a row without extending this and the build fails. */
export type Network = "mainnet" | "testnet" | "previewnet" | "devnet";

// Compile-time drift guard: the Network union and the table's references must
// be the same set, in both directions.
type TableRef = (typeof TABLE)[number]["reference"];
const _unionMatchesTable: TableRef extends Network
  ? Network extends TableRef
    ? true
    : never
  : never = true;
void _unionMatchesTable;

/** The networks this library recognises. One row per network — see above.
 *  (Typed as `NetworkSpec` rows so optional fields read uniformly; the
 *  `Network` union above keeps the literal reference names.) */
export const HIERO_NETWORKS: readonly (NetworkSpec & { reference: Network })[] = TABLE;

/** The network names, in table order. */
export const NETWORKS = HIERO_NETWORKS.map((n) => n.reference) as readonly Network[];

/** The table row for `network`. Total by construction: `Network` is derived
 *  from the same table this reads. */
export function networkSpec(network: Network): NetworkSpec {
  return HIERO_NETWORKS.find((n) => n.reference === network)!;
}

/** Parse `hedera:mainnet`. Throws `CaipError`. */
export function parseChain(caip2: string): Network {
  const [namespace, reference] = split(caip2, ":", 2, caip2, "expected namespace:network");
  const spec = HIERO_NETWORKS.find((n) => n.namespace === namespace && n.reference === reference);
  if (spec === undefined) {
    const known = HIERO_NETWORKS.map((n) => `${n.namespace}:${n.reference}`).join(", ");
    throw new CaipError(`unknown chain "${caip2}" (known: ${known})`);
  }
  return spec.reference;
}

export function formatChain(network: Network): string {
  const spec = networkSpec(network);
  return `${spec.namespace}:${spec.reference}`;
}

export function isNetwork(text: string): text is Network {
  return (NETWORKS as readonly string[]).includes(text);
}
