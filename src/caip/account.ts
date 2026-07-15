/**
 * CAIP-10 — an account: `hedera:mainnet:0.0.1234` (+ optional HIP-15 checksum).
 *
 * A chain (CAIP-2) plus an entity id. The network riding *inside* the
 * identifier is why nothing in this library takes a separate `network` option,
 * and why a mainnet request can never silently match a testnet payment.
 */
import { entityKey, formatEntityId, parseEntityId, type EntityId } from "./entity.js";
import { formatChain, parseChain, type Network } from "./network.js";
import { split, tryParser } from "./parse.js";

export interface AccountRef {
  readonly network: Network;
  readonly id: EntityId;
}

/** Parse `hedera:mainnet:0.0.1234` (or `…-vfmkw`). Throws `CaipError`. */
export function parseAccount(caip10: string): AccountRef {
  const [namespace, network, address] = split(caip10, ":", 3, caip10, "expected namespace:network:shard.realm.num");
  return { network: parseChain(`${namespace}:${network}`), id: parseEntityId(address, caip10) };
}

export const tryParseAccount = tryParser(parseAccount);

/** Canonical text, checksum included. */
export function formatAccount(ref: AccountRef): string {
  return accountText(ref, formatEntityId);
}

/** Identity — canonical text with the checksum stripped. Safe as a `Map` key. */
export function accountKey(ref: AccountRef): string {
  return accountText(ref, entityKey);
}

export const sameAccount = (a: AccountRef, b: AccountRef): boolean => accountKey(a) === accountKey(b);

/** The shape, rendered once; `id` decides whether the entity id carries its
 *  checksum. `formatAccount` and `accountKey` differ only by that function, so
 *  the canonical shape cannot drift between them. */
function accountText(ref: AccountRef, id: (e: EntityId) => string): string {
  return `${formatChain(ref.network)}:${id(ref.id)}`;
}
