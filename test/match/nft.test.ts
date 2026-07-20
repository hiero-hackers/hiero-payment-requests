/**
 * NFTs end to end: request a specific serial, watch it arrive through a
 * receipt, match it. A serial is an identity, not a quantity — so the right
 * serial pays, the wrong serial of the SAME token is `wrong-asset`, and an
 * amount other than 1 is rejected before it can become an unfulfillable
 * request.
 */
import { describe, it, expect } from "vitest";
import { createRequest, RequestError } from "../../src/request.js";
import { match } from "../../src/match/index.js";
import { fromReceipt, type ReceiptLike } from "../../src/adapters/receipt.js";
import { toURI, fromURI } from "../../src/wire.js";
import type { PaymentRequest } from "../../src/types.js";

const REQUEST: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/nft:0.0.721/3",
  amount: 1n,
  reference: "TICKET-0042",
};

const receiptWith = (serial: bigint, tokenId = "0.0.721"): ReceiptLike => ({
  account: "0.0.1234",
  transactionId: "0.0.999@1783012000.000000000",
  consensusTimestamp: "1783012000.000000000",
  status: "success",
  memo: "TICKET-0042",
  movements: [],
  nft: [{ tokenId, serial, direction: "in" }],
});

describe("an NFT request matches exactly its serial", () => {
  it("the requested serial arriving through a receipt is paid", () => {
    const result = match(REQUEST, [fromReceipt(receiptWith(3n), "mainnet")]);
    expect(result).toMatchObject({ status: "paid", received: 1n });
  });

  it("a DIFFERENT serial of the same token is wrong-asset, not paid", () => {
    // The classic marketplace bug: check the token id, forget the serial, and
    // any floor-price piece of the collection settles a request for #3.
    expect(match(REQUEST, [fromReceipt(receiptWith(4n), "mainnet")]).status).toBe("wrong-asset");
  });

  it("a fungible credit of the same token id is wrong-asset too", () => {
    const fungible: ReceiptLike = {
      ...receiptWith(3n),
      movements: [{ asset: "0.0.721", amount: 1n, kind: "token" }],
      nft: [],
    };
    expect(match(REQUEST, [fromReceipt(fungible, "mainnet")]).status).toBe("wrong-asset");
  });

  it("the same serial delivered twice (at-least-once) is still just paid", () => {
    const p = fromReceipt(receiptWith(3n), "mainnet");
    expect(match(REQUEST, [p, p]).status).toBe("paid");
  });
});

describe("an NFT request can only ever ask for 1", () => {
  it("createRequest rejects any other amount as unfulfillable", () => {
    expect(() => createRequest({ ...REQUEST, amount: 2n })).toThrow(RequestError);
    expect(() => createRequest({ ...REQUEST, amount: 2n })).toThrow(/amount can only be 1/);
  });
});

describe("an NFT request travels the wire", () => {
  it("round-trips through the URI form, serial intact", () => {
    expect(fromURI(toURI(REQUEST))).toEqual(REQUEST);
  });
});
