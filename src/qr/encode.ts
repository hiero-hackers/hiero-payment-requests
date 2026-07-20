// SPDX-License-Identifier: Apache-2.0
/**
 * A QR encoder (ISO/IEC 18004, byte mode, versions 1–10) with no dependency —
 * the same bargain as `caip/checksum.ts`: implement the spec in-house, then
 * hold it to account with an INDEPENDENT implementation in the tests
 * (`test/qr/` decodes every matrix with jsQR and demands the exact URI back).
 *
 * Version 10 at level M carries 213 bytes — a `hiero-pay:` URI is typically
 * ~120 — so the ceiling is honest headroom, and anything longer throws with
 * the reason rather than silently emitting a code phones struggle to scan.
 *
 * Byte mode only, deliberately: QR's alphanumeric mode has no lowercase, and
 * the `hiero-pay:` scheme is lowercase, so byte mode is not a simplification —
 * it is the only mode that can carry the URI.
 */

export type QrEcc = "L" | "M" | "Q" | "H";

export interface QrOptions {
  /** Error-correction level. Default `"M"` — the payments trade-off: enough
   *  redundancy for a scuffed screen, without inflating the module count. */
  readonly ecc?: QrEcc;
  /** Force a mask pattern 0–7 instead of penalty-scored selection.
   *  For tests; scanners accept any mask. */
  readonly mask?: number;
}

export interface QrMatrix {
  /** Modules per side (no quiet zone — renderers add their own). */
  readonly size: number;
  /** `modules[row][col]` — `true` is a dark module. */
  readonly modules: readonly (readonly boolean[])[];
  readonly version: number;
  readonly ecc: QrEcc;
  readonly mask: number;
}

export class QrError extends Error {}

// ── Spec constants, versions 1–10 ───────────────────────────────────────────
// Reed-Solomon block structure per (version, level): [blockCount, totalCodewords,
// dataCodewords][] — ISO/IEC 18004 table 9. Every entry here is exercised by a
// decode round-trip in test/qr/roundtrip.test.ts; a wrong constant cannot hide.
const RS_BLOCKS: Record<QrEcc, readonly (readonly (readonly [number, number, number])[])[]> = {
  L: [
    [[1, 26, 19]],
    [[1, 44, 34]],
    [[1, 70, 55]],
    [[1, 100, 80]],
    [[1, 134, 108]],
    [[2, 86, 68]],
    [[2, 98, 78]],
    [[2, 121, 97]],
    [[2, 146, 116]],
    [
      [2, 86, 68],
      [2, 87, 69],
    ],
  ],
  M: [
    [[1, 26, 16]],
    [[1, 44, 28]],
    [[1, 70, 44]],
    [[2, 50, 32]],
    [[2, 67, 43]],
    [[4, 43, 27]],
    [[4, 49, 31]],
    [
      [2, 60, 38],
      [2, 61, 39],
    ],
    [
      [3, 58, 36],
      [2, 59, 37],
    ],
    [
      [4, 69, 43],
      [1, 70, 44],
    ],
  ],
  Q: [
    [[1, 26, 13]],
    [[1, 44, 22]],
    [[2, 35, 17]],
    [[2, 50, 24]],
    [
      [2, 33, 15],
      [2, 34, 16],
    ],
    [[4, 43, 19]],
    [
      [2, 32, 14],
      [4, 33, 15],
    ],
    [
      [4, 40, 18],
      [2, 41, 19],
    ],
    [
      [4, 36, 16],
      [4, 37, 17],
    ],
    [
      [6, 43, 19],
      [2, 44, 20],
    ],
  ],
  H: [
    [[1, 26, 9]],
    [[1, 44, 16]],
    [[2, 35, 13]],
    [[4, 25, 9]],
    [
      [2, 33, 11],
      [2, 34, 12],
    ],
    [[4, 43, 15]],
    [
      [4, 39, 13],
      [1, 40, 14],
    ],
    [
      [4, 40, 14],
      [2, 41, 15],
    ],
    [
      [4, 36, 12],
      [4, 37, 13],
    ],
    [
      [6, 43, 15],
      [2, 44, 16],
    ],
  ],
};

/** Alignment-pattern centre coordinates per version (none for version 1). */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MAX_VERSION = RS_BLOCKS.L.length;

// Format info: 2 level bits + 3 mask bits, BCH(15,5)-protected, XOR-masked.
const ECC_BITS: Record<QrEcc, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
const G15 = 0b10100110111;
const G18 = 0b1111100100101;
const FORMAT_MASK = 0b101010000010010;

// ── GF(256), polynomial 0x11d — Reed-Solomon's arithmetic ───────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** Reed-Solomon remainder: `ecLen` codewords protecting `data`. */
function rsRemainder(data: readonly number[], ecLen: number): number[] {
  // Generator polynomial ∏(x − α^i), built once per ecLen call — cheap next
  // to the mask search, and it keeps this function self-contained.
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j]! ^= gfMul(gen[j]!, EXP[i]!);
      next[j + 1]! ^= gen[j]!;
    }
    gen = next;
  }
  gen.reverse(); // built lowest-degree-first; the division below wants leading-first
  const rem = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i]! ^= gfMul(gen[i + 1]!, factor);
  }
  return rem;
}

// ── Bit assembly ────────────────────────────────────────────────────────────
class BitBuffer {
  readonly bytes: number[] = [];
  length = 0;
  put(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      if (this.length % 8 === 0) this.bytes.push(0);
      if ((value >>> i) & 1) this.bytes[this.bytes.length - 1]! |= 0x80 >>> (this.length % 8);
      this.length++;
    }
  }
}

const bch = (value: number, gen: number, genBits: number): number => {
  let d = value;
  const top = (n: number): number => 31 - Math.clz32(n);
  while (d !== 0 && top(d) >= genBits - 1) d ^= gen << (top(d) - (genBits - 1));
  return d;
};

/** Smallest version whose data capacity fits `byteLength` payload bytes. */
function chooseVersion(byteLength: number, ecc: QrEcc): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const dataBytes = RS_BLOCKS[ecc][version - 1]!.reduce(
      (n, [count, , data]) => n + count * data,
      0,
    );
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + 8 * byteLength <= 8 * dataBytes) return version;
  }
  const max = RS_BLOCKS[ecc][MAX_VERSION - 1]!.reduce((n, [count, , data]) => n + count * data, 0);
  const capacity = Math.floor((8 * max - 4 - 16) / 8); // minus mode + count bits
  throw new QrError(
    `payload is ${byteLength} bytes but a version-${MAX_VERSION} QR at level ${ecc} holds ` +
      `${capacity} — shorten the label or reference, or lower the error-correction level`,
  );
}

/** Data + interleaved Reed-Solomon codewords, ready for placement. */
function buildCodewords(payload: Uint8Array, version: number, ecc: QrEcc): number[] {
  const blocks = RS_BLOCKS[ecc][version - 1]!;
  const dataBytes = blocks.reduce((n, [count, , data]) => n + count * data, 0);

  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(payload.length, version <= 9 ? 8 : 16);
  for (const byte of payload) buffer.put(byte, 8);
  buffer.put(0, Math.min(4, 8 * dataBytes - buffer.length)); // terminator
  if (buffer.length % 8 !== 0) buffer.put(0, 8 - (buffer.length % 8));
  for (let pad = 0xec; buffer.bytes.length < dataBytes; pad ^= 0xec ^ 0x11) buffer.put(pad, 8);

  // Split into blocks, compute each block's EC, then interleave both.
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [count, total, data] of blocks) {
    for (let i = 0; i < count; i++) {
      const block = buffer.bytes.slice(offset, offset + data);
      offset += data;
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, total - data));
    }
  }
  const out: number[] = [];
  const interleave = (source: readonly (readonly number[])[]): void => {
    const longest = Math.max(...source.map((b) => b.length));
    for (let i = 0; i < longest; i++)
      for (const block of source) if (i < block.length) out.push(block[i]!);
  };
  interleave(dataBlocks);
  interleave(ecBlocks);
  return out;
}

// ── The matrix ──────────────────────────────────────────────────────────────
// `modules` is the picture; `reserved` marks function patterns so the data
// walk knows which cells it may not touch.
interface Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly reserved: boolean[][];
}

function baseGrid(version: number): Grid {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const grid: Grid = { size, modules, reserved };

  const square = (top: number, left: number, span: number, dark: boolean): void => {
    for (let r = top; r < top + span; r++)
      for (let c = left; c < left + span; c++) {
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        modules[r]![c] = dark;
        reserved[r]![c] = true;
      }
  };
  const finder = (row: number, col: number): void => {
    square(row - 1, col - 1, 9, false); // separator ring
    square(row, col, 7, true);
    square(row + 1, col + 1, 5, false);
    square(row + 2, col + 2, 3, true);
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (const centreRow of ALIGNMENT[version - 1]!) {
    for (const centreCol of ALIGNMENT[version - 1]!) {
      if (reserved[centreRow]![centreCol]) continue; // overlaps a finder
      square(centreRow - 2, centreCol - 2, 5, true);
      square(centreRow - 1, centreCol - 1, 3, false);
      square(centreRow, centreCol, 1, true);
    }
  }

  for (let i = 8; i < size - 8; i++) {
    modules[6]![i] = i % 2 === 0;
    reserved[6]![i] = true;
    modules[i]![6] = i % 2 === 0;
    reserved[i]![6] = true;
  }

  // Reserve the format-info cells (filled per mask trial) + the dark module.
  for (let i = 0; i < 9; i++) {
    reserved[8]![i] = true;
    reserved[i]![8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8]![size - 1 - i] = true;
    reserved[size - 1 - i]![8] = true;
  }
  modules[size - 8]![8] = true;

  if (version >= 7) {
    const bits = (version << 12) | bch(version << 12, G18, 13);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 8 - 3;
      modules[a]![b] = dark;
      reserved[a]![b] = true;
      modules[b]![a] = dark;
      reserved[b]![a] = true;
    }
  }
  return grid;
}

function placeFormat(grid: Grid, ecc: QrEcc, mask: number): void {
  const { size, modules } = grid;
  const data = (ECC_BITS[ecc] << 3) | mask;
  const bits = ((data << 10) | bch(data << 10, G15, 11)) ^ FORMAT_MASK;
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    // Copy 1, around the top-left finder.
    if (i < 6) modules[i]![8] = dark;
    else if (i < 8) modules[i + 1]![8] = dark;
    else modules[size - 15 + i]![8] = dark;
    // Copy 2, split between top-right and bottom-left.
    if (i < 8) modules[8]![size - 1 - i] = dark;
    else if (i < 9) modules[8]![15 - i - 1 + 1] = dark;
    else modules[8]![15 - i - 1] = dark;
  }
}

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0,
];

/** The spec's zig-zag: two-module columns right to left, skipping column 6. */
function placeData(grid: Grid, codewords: readonly number[], mask: number): void {
  const { size, modules, reserved } = grid;
  const maskFn = MASKS[mask]!;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row]![c]) continue;
        // Bits past the codewords are the spec's remainder bits: light, but
        // still subject to the mask like any other data cell.
        let dark =
          bitIndex < totalBits && ((codewords[bitIndex >> 3]! >> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex++;
        if (maskFn(row, c)) dark = !dark;
        modules[row]![c] = dark;
      }
    }
    upward = !upward;
  }
}

/** ISO 18004's four penalty rules — the tiebreak that picks the mask. */
function penalty(grid: Grid): number {
  const { size, modules } = grid;
  const at = (r: number, c: number): boolean => modules[r]![c]!;
  let score = 0;

  // Rule 1: runs of 5+ same-coloured modules, rows and columns.
  for (let r = 0; r < size; r++) {
    let runRow = 1;
    let runCol = 1;
    for (let c = 1; c < size; c++) {
      runRow = at(r, c) === at(r, c - 1) ? runRow + 1 : 1;
      if (runRow === 5) score += 3;
      else if (runRow > 5) score += 1;
      runCol = at(c, r) === at(c - 1, r) ? runCol + 1 : 1;
      if (runCol === 5) score += 3;
      else if (runCol > 5) score += 1;
    }
  }

  // Rule 2: 2×2 blocks of one colour.
  for (let r = 0; r + 1 < size; r++)
    for (let c = 0; c + 1 < size; c++)
      if (at(r, c) === at(r, c + 1) && at(r, c) === at(r + 1, c) && at(r, c) === at(r + 1, c + 1))
        score += 3;

  // Rule 3: finder-lookalike 1011101 flanked by 0000, rows and columns.
  const lookalike = (cells: (i: number) => boolean, length: number): number => {
    let hits = 0;
    for (let i = 0; i + 11 <= length; i++) {
      const window = Array.from({ length: 11 }, (_, k) => cells(i + k));
      const pattern = [true, false, true, true, true, false, true];
      const matchesAt = (offset: number): boolean =>
        pattern.every((p, k) => window[offset + k] === p);
      const lightRun = (from: number): boolean => window.slice(from, from + 4).every((m) => !m);
      if ((matchesAt(0) && lightRun(7)) || (lightRun(0) && matchesAt(4))) hits++;
    }
    return hits;
  };
  for (let i = 0; i < size; i++) {
    score += 40 * lookalike((k) => at(i, k), size);
    score += 40 * lookalike((k) => at(k, i), size);
  }

  // Rule 4: overall dark/light balance, 10 points per 5% step from 50%.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (at(r, c)) dark++;
  score += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
  return score;
}

/** Encode `text` (UTF-8) as a QR matrix. Throws `QrError` when it cannot. */
export function encodeQR(text: string, options: QrOptions = {}): QrMatrix {
  const ecc = options.ecc ?? "M";
  if (options.mask !== undefined && !MASKS[options.mask]) {
    throw new QrError(`mask must be 0–7 (got ${options.mask})`);
  }
  const payload = new TextEncoder().encode(text);
  const version = chooseVersion(payload.length, ecc);
  const codewords = buildCodewords(payload, version, ecc);

  const tryMask = (mask: number): Grid => {
    const grid = baseGrid(version);
    placeFormat(grid, ecc, mask);
    placeData(grid, codewords, mask);
    return grid;
  };

  let mask = options.mask;
  if (mask === undefined) {
    let best = Infinity;
    for (let candidate = 0; candidate < MASKS.length; candidate++) {
      const score = penalty(tryMask(candidate));
      if (score < best) {
        best = score;
        mask = candidate;
      }
    }
  }
  const grid = tryMask(mask!);
  return { size: grid.size, modules: grid.modules, version, ecc, mask: mask! };
}
