// SPDX-License-Identifier: Apache-2.0
/**
 * QR codes for payment requests — the "share it" step made scannable.
 *
 * Every entry point goes through `toURI`, so the request is fully VALIDATED
 * before a single module is drawn: a bad checksum or malformed identifier
 * fails here, not on a customer's phone. What the QR carries is exactly the
 * `hiero-pay:` wire URI — nothing more, so any wallet that reads the wire
 * format reads the code.
 */
import { toURI } from "../wire.js";
import type { PaymentRequest } from "../types.js";
import { encodeQR, type QrMatrix, type QrOptions } from "./encode.js";
import { renderSVG, renderTerminal, type SvgOptions } from "./render.js";

/** The request's `hiero-pay:` URI as a QR module matrix. */
export function toQRMatrix(request: PaymentRequest, options: QrOptions = {}): QrMatrix {
  return encodeQR(toURI(request), options);
}

/** The request as a standalone, losslessly-scalable SVG string. */
export function toQRSVG(request: PaymentRequest, options: QrOptions & SvgOptions = {}): string {
  return renderSVG(toQRMatrix(request, options), options);
}

/** The request as terminal text (half-block characters). */
export function toQRTerminal(
  request: PaymentRequest,
  options: QrOptions & { invert?: boolean } = {},
): string {
  return renderTerminal(toQRMatrix(request, options), options);
}

export { encodeQR, QrError } from "./encode.js";
export type { QrMatrix, QrOptions, QrEcc } from "./encode.js";
export { renderSVG, renderTerminal } from "./render.js";
export type { SvgOptions } from "./render.js";
