// SPDX-License-Identifier: Apache-2.0
/**
 * Renderers for a `QrMatrix`. Pure string builders — no DOM, no canvas — so
 * they run identically in Node, a worker, or a browser.
 */
import type { QrMatrix } from "./encode.js";

export interface SvgOptions {
  /** Quiet-zone width in modules. The spec says 4; going below it is the
   *  single most common reason a printed QR won't scan. */
  readonly quiet?: number;
  /** Dark-module colour. Keep the contrast high — scanners binarize. */
  readonly dark?: string;
  /** Background colour, painted explicitly so the code survives being placed
   *  on a dark page. */
  readonly light?: string;
}

/**
 * The matrix as a standalone SVG string. Scales losslessly (`viewBox` only —
 * size it with CSS or width/height where you embed it) and renders on crisp
 * module boundaries.
 */
export function renderSVG(qr: QrMatrix, options: SvgOptions = {}): string {
  const quiet = options.quiet ?? 4;
  const dark = options.dark ?? "#000";
  const light = options.light ?? "#fff";
  const span = qr.size + 2 * quiet;

  // One path, one rect per run of dark modules — compact and crisp.
  const runs: string[] = [];
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (!qr.modules[row]![col]) continue;
      let width = 1;
      while (col + width < qr.size && qr.modules[row]![col + width]) width++;
      runs.push(`M${col + quiet} ${row + quiet}h${width}v1h-${width}z`);
      col += width - 1;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${span}" height="${span}" fill="${light}"/>` +
    `<path d="${runs.join("")}" fill="${dark}"/>` +
    `</svg>`
  );
}

/**
 * The matrix as terminal text, two modules per character row via half-blocks.
 * `invert` swaps dark and light for dark-background terminals — a scanner
 * needs dark modules on light, and most terminals are the other way round.
 */
export function renderTerminal(qr: QrMatrix, options: { invert?: boolean } = {}): string {
  const invert = options.invert ?? false;
  const quiet = 2;
  const span = qr.size + 2 * quiet;
  const at = (row: number, col: number): boolean => {
    const r = row - quiet;
    const c = col - quiet;
    const inCode = r >= 0 && c >= 0 && r < qr.size && c < qr.size;
    const dark = inCode && qr.modules[r]![c]!;
    return invert ? !dark : dark;
  };
  const lines: string[] = [];
  for (let row = 0; row < span; row += 2) {
    let line = "";
    for (let col = 0; col < span; col++) {
      const top = at(row, col);
      const bottom = row + 1 < span ? at(row + 1, col) : false;
      line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
