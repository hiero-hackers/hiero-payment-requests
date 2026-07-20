// SPDX-License-Identifier: Apache-2.0
/**
 * HIP-15 checksum verification — the algorithm, not just the shape.
 *
 * Accepting a checksum without verifying it is worse than not supporting
 * checksums: the payer sees their typo'd id pass, and the safety they
 * assumed does not exist. So when an id carries a checksum and the network
 * is known, it is VERIFIED here (the ledger id that seeds the algorithm is
 * derived from the network riding inside the same CAIP identifier).
 *
 * The implementation is checked against the official Hiero SDK's output —
 * fifteen cross-network vectors in `test/caip/checksum.test.ts`, including
 * CAIP-76's own 64-bit extreme.
 */
import { CaipError } from "./error.js";
import type { EntityId } from "./entity.js";
import { entityKey } from "./entity.js";
import { networkSpec, type Network } from "./network.js";

/**
 * The HIP-15 checksum for `shard.realm.num` text on `network`, or
 * `undefined` when the network has no assigned ledger id. The ledger id that
 * seeds the hash (HIP-198 registry) comes from the network table — one row
 * per network, nothing network-specific hardcoded here.
 */
export function expectedChecksum(address: string, network: Network): string | undefined {
  const ledgerId = networkSpec(network).ledgerId;
  if (ledgerId === undefined) return undefined;

  const p3 = 26 * 26 * 26;
  const p5 = p3 * 26 * 26;
  const asciiA = "a".charCodeAt(0);
  const m = 1_000_003;
  const w = 31;

  let s0 = 0; // even-position digit sum, mod 11
  let s1 = 0; // odd-position digit sum, mod 11
  let s = 0; // weighted digit hash, mod p3
  for (let i = 0; i < address.length; i += 1) {
    const d = address[i] === "." ? 10 : Number(address[i]);
    s = (w * s + d) % p3;
    if (i % 2 === 0) s0 = (s0 + d) % 11;
    else s1 = (s1 + d) % 11;
  }

  let sh = 0; // ledger-id hash (id bytes then six zero bytes), mod p5
  const h = [...ledgerId, 0, 0, 0, 0, 0, 0];
  for (const byte of h) sh = (w * sh + byte) % p5;

  let c = ((((address.length % 5) * 11 + s0) * 11 + s1) * p3 + s + sh) % p5;
  c = (c * m) % p5;

  let answer = "";
  for (let i = 0; i < 5; i += 1) {
    answer = String.fromCharCode(asciiA + (c % 26)) + answer;
    c = Math.floor(c / 26);
  }
  return answer;
}

/**
 * Throws `CaipError` when `id` carries a checksum that is wrong for
 * `network`, or one that cannot be verified there. An id without a checksum
 * always passes — the checksum guards typing, it is not part of identity.
 */
export function verifyEntityChecksum(id: EntityId, network: Network, context: string): void {
  if (id.checksum === undefined) return;
  const expected = expectedChecksum(entityKey(id), network);
  if (expected === undefined) {
    throw new CaipError(
      `checksum "${id.checksum}" in ${context} cannot be verified: ${network} has no ` +
        `assigned ledger id — omit the checksum`,
    );
  }
  if (expected !== id.checksum) {
    throw new CaipError(
      `checksum "${id.checksum}" in ${context} is wrong for ${entityKey(id)} on ${network} ` +
        `(expected "${expected}") — the id is mistyped or meant for another network`,
    );
  }
}
