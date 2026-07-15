/**
 * CAIP-19 — an asset:
 *
 *   hedera:mainnet/token:0.0.720      fungible (HTS)
 *   hedera:mainnet/nft:0.0.721/3      non-fungible
 *   hedera:mainnet/slip44:3030        native HBAR — PROVISIONAL, see below
 *
 * A chain (CAIP-2) plus an asset namespace and reference.
 *
 * ────────────────────────────────────────────────────────────────────────
 * **This is the only file in the library that invents an identifier.**
 *
 * HIP-30 defines `token:` and `nft:` but **no identifier for HBAR itself**, so
 * the most common payment request — "pay me 100 ℏ" — cannot name its asset in
 * the standard as written. We follow CAIP-19's convention for native coins
 * (Ethereum uses `eip155:1/slip44:60`) pending an upstream fix.
 *
 * Everything else here implements a published spec. This one thing does not.
 * The coin type should be confirmed against SLIP-0044 before it is proposed,
 * and closing the gap upstream is a conversation, not a local decision.
 * See docs/ARCHITECTURE.md § The HBAR gap.
 * ────────────────────────────────────────────────────────────────────────
 */
import { entityKey, formatEntityId, parseEntityId, type EntityId } from "./entity.js";
import { CaipError } from "./error.js";
import { formatChain, parseChain, type Network } from "./network.js";
import { parseUint, tryParser } from "./parse.js";

/** SLIP-44 coin type for the provisional native-HBAR identifier. Not in HIP-30. */
export const HBAR_SLIP44 = "3030";

/** `hbar` is the provisional form — see the note at the top of this file. */
export type AssetRef =
  | { readonly kind: "hbar"; readonly network: Network }
  | { readonly kind: "token"; readonly network: Network; readonly id: EntityId }
  | { readonly kind: "nft"; readonly network: Network; readonly id: EntityId; readonly serial: bigint };

/** Parse a CAIP-19 asset. Throws `CaipError`. */
export function parseAsset(caip19: string): AssetRef {
  const slash = caip19.indexOf("/");
  if (slash === -1) {
    throw new CaipError(`not a CAIP-19 asset: ${caip19} (expected chain/assetNamespace:assetReference)`);
  }
  const network = parseChain(caip19.slice(0, slash));

  // Remainder is `token:<id>` | `nft:<id>/<serial>` | `slip44:<coinType>`
  const rest = caip19.slice(slash + 1);
  const colon = rest.indexOf(":");
  if (colon === -1) throw new CaipError(`not a CAIP-19 asset: ${caip19} (missing asset namespace)`);
  const assetNamespace = rest.slice(0, colon);
  const assetReference = rest.slice(colon + 1);

  switch (assetNamespace) {
    case "slip44": {
      if (assetReference !== HBAR_SLIP44) {
        throw new CaipError(`unsupported slip44 coin type ${assetReference} (expected ${HBAR_SLIP44} for HBAR)`);
      }
      return { kind: "hbar", network };
    }
    case "token":
      return { kind: "token", network, id: parseEntityId(assetReference, caip19) };
    case "nft": {
      const cut = assetReference.lastIndexOf("/");
      if (cut === -1) throw new CaipError(`NFT asset needs a serial: ${caip19}`);
      return {
        kind: "nft",
        network,
        id: parseEntityId(assetReference.slice(0, cut), caip19),
        serial: parseUint(assetReference.slice(cut + 1), caip19),
      };
    }
    default:
      throw new CaipError(`unknown asset namespace "${assetNamespace}" in ${caip19}`);
  }
}

export const tryParseAsset = tryParser(parseAsset);

/** Canonical text, checksum included. */
export function formatAsset(ref: AssetRef): string {
  return assetText(ref, formatEntityId);
}

/** Identity — canonical text with the checksum stripped. Safe as a `Map` key. */
export function assetKey(ref: AssetRef): string {
  return assetText(ref, entityKey);
}

export const sameAsset = (a: AssetRef, b: AssetRef): boolean => assetKey(a) === assetKey(b);

/** The shape, rendered once; `id` decides whether the entity id carries its
 *  checksum. `formatAsset` and `assetKey` differ only by that function, so the
 *  canonical shape cannot drift between them. */
function assetText(ref: AssetRef, id: (e: EntityId) => string): string {
  const chain = formatChain(ref.network);
  switch (ref.kind) {
    case "hbar":
      return `${chain}/slip44:${HBAR_SLIP44}`;
    case "token":
      return `${chain}/token:${id(ref.id)}`;
    case "nft":
      return `${chain}/nft:${id(ref.id)}/${ref.serial}`;
  }
}
