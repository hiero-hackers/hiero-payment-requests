// SPDX-License-Identifier: Apache-2.0
/**
 * Hedera entity ids — `shard.realm.num`, with an optional HIP-15 checksum.
 *
 * Not a CAIP concept: it's the Hedera-shaped primitive that CAIP-10 accounts
 * and CAIP-19 assets are both built out of, which is why it sits beside them
 * rather than inside either.
 *
 * **Ids are `bigint`, not `number`.** CAIP-76 specifies each of shard, realm,
 * and num as a 64-bit non-negative integer, and its own test vector uses
 * `9223372036854775807` — four orders of magnitude past `Number.MAX_SAFE_INTEGER`.
 * A `number`-based parser silently corrupts the spec's own example.
 */
import { CaipError } from "./error.js";
import { parseUint, split, tryParser } from "./parse.js";

export interface EntityId {
  readonly shard: bigint;
  readonly realm: bigint;
  readonly num: bigint;
  readonly checksum?: string;
}

/**
 * `0.0.1234` or `0.0.1234-vfmkw` → an `EntityId`. Throws `CaipError`.
 *
 * `context` only enriches the error message (the surrounding identifier, when
 * there is one); it defaults to the address itself.
 */
export function parseEntityId(address: string, context: string = address): EntityId {
  const dash = address.indexOf("-");
  const checksum = dash === -1 ? undefined : address.slice(dash + 1);
  const bare = dash === -1 ? address : address.slice(0, dash);

  if (checksum !== undefined && !/^[a-z]{5}$/.test(checksum)) {
    throw new CaipError(`bad HIP-15 checksum "${checksum}" in ${context}`);
  }
  const [shard, realm, num] = split(bare, ".", 3, context, "expected shard.realm.num");
  return {
    shard: parseUint(shard, context),
    realm: parseUint(realm, context),
    num: parseUint(num, context),
    ...(checksum !== undefined ? { checksum } : {}),
  };
}

export const tryParseEntityId = tryParser(parseEntityId);

/** Canonical text, checksum included. */
export function formatEntityId(id: EntityId): string {
  return id.checksum !== undefined ? `${entityKey(id)}-${id.checksum}` : entityKey(id);
}

/**
 * Identity — `shard.realm.num`, no checksum. Safe as a `Map` key.
 *
 * A HIP-15 checksum guards against *typing* an id wrong; it is not part of
 * *which* entity the id names. So it belongs in the text and not in the
 * identity, and every equality check below routes through here.
 */
export function entityKey(id: EntityId): string {
  return `${id.shard}.${id.realm}.${id.num}`;
}

export const sameEntity = (a: EntityId, b: EntityId): boolean => entityKey(a) === entityKey(b);
