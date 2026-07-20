// SPDX-License-Identifier: Apache-2.0
/**
 * CAIP identifiers for Hedera — per
 * [HIP-30](https://hips.hedera.com/HIP/hip-30.html) (which subsumes HIP-20) and
 * [CAIP-76](https://standards.chainagnostic.org/CAIPs/caip-76).
 *
 *   CAIP-2  chain     hedera:mainnet                  network.ts
 *   CAIP-10 account   hedera:mainnet:0.0.1234         account.ts
 *   CAIP-19 token     hedera:mainnet/token:0.0.720    asset.ts
 *   CAIP-19 NFT       hedera:mainnet/nft:0.0.721/3    asset.ts
 *
 * We adopt these rather than invent our own. The network is carried *inside*
 * the identifier, which is why nothing here takes a separate `network` option —
 * and why a mainnet request can never silently match a testnet payment.
 *
 * The modules stack the way the specs do — each layer is a chain plus something:
 *
 *   error ─┬─ parse ──┬── network (CAIP-2) ──┬── account (CAIP-10)
 *          │          └── entity  (ids)  ────┴── asset   (CAIP-19)
 *
 * `entity.ts` is the odd one: `shard.realm.num` is not a CAIP concept, it's the
 * Hedera-shaped primitive both accounts and assets are built out of.
 *
 * Two conventions worth knowing before editing:
 *
 * - **`parse*` throws, `tryParse*` returns `undefined`.** Filtering candidates
 *   is a normal thing to do, and it should not need a `try`/`catch`.
 * - **Identity is the canonical string.** `*Key` functions render an identifier
 *   without its HIP-15 checksum — a checksum guards against typing the id wrong,
 *   it is not part of *which* entity it names. Every equality check and every
 *   `Map` key goes through them, so identity is defined in exactly one place.
 *
 * One caveat, isolated in `asset.ts`: HIP-30 has no identifier for native HBAR,
 * so the `slip44:3030` form is **provisional** and ours. It is the only invented
 * identifier in the library.
 */
export { CaipError } from "./error.js";
export {
  parseChain,
  formatChain,
  isNetwork,
  NETWORKS,
  HIERO_NETWORKS,
  networkSpec,
} from "./network.js";
export type { Network, NetworkSpec } from "./network.js";
export {
  parseEntityId,
  tryParseEntityId,
  formatEntityId,
  entityKey,
  sameEntity,
} from "./entity.js";
export type { EntityId } from "./entity.js";
export {
  parseAccount,
  tryParseAccount,
  formatAccount,
  accountKey,
  sameAccount,
} from "./account.js";
export type { AccountRef } from "./account.js";
export {
  parseAsset,
  tryParseAsset,
  formatAsset,
  assetKey,
  sameAsset,
  HBAR_SLIP44,
} from "./asset.js";
export type { AssetRef } from "./asset.js";
