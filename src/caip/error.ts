// SPDX-License-Identifier: Apache-2.0
/** Anything malformed in a CAIP identifier. Shared by every parser here, and
 *  the only error `tryParse*` swallows — see `parse.ts`. */
export class CaipError extends Error {}
