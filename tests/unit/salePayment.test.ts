import { describe, expect, it } from "vitest";
import { saleRequestSchema, validateSalePayment } from "../../worker/services/saleService";

describe("validateSalePayment", () => {
  it("通常販売で預かり金額が不足している場合は拒否する", () => {
    expect(
      validateSalePayment(
        { saleType: "normal", paymentMethod: "cash", paidAmount: 500 },
        750,
      ),
    ).toEqual({
      status: 400,
      code: "INSUFFICIENT_PAYMENT",
      message: "預かり金額が不足しています。あと250円です。",
    });
  });

  it("通常販売で預かり金額が合計以上なら受け付ける", () => {
    expect(
      validateSalePayment(
        { saleType: "normal", paymentMethod: "cash", paidAmount: 1000 },
        750,
      ),
    ).toBeNull();
  });

  it("事前販売は事前支払い済みかつ預かり0円だけを受け付ける", () => {
    expect(
      validateSalePayment(
        { saleType: "presale_pickup", paymentMethod: "prepaid", paidAmount: 0 },
        750,
      ),
    ).toBeNull();
    expect(
      validateSalePayment(
        { saleType: "presale_pickup", paymentMethod: "cash", paidAmount: 750 },
        750,
      )?.code,
    ).toBe("INVALID_PAYMENT");
  });
});

describe("saleRequestSchema", () => {
  const baseRequest = {
    idempotencyKey: "checkout-1",
    saleType: "normal" as const,
    paymentMethod: "cash" as const,
    paidAmount: 1000,
  };

  it("同じ商品を複数明細に分けたリクエストを拒否する", () => {
    const result = saleRequestSchema.safeParse({
      ...baseRequest,
      items: [
        { productId: "onigiri", quantity: 1 },
        { productId: "onigiri", quantity: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("注文数の上限を超えたリクエストを拒否する", () => {
    const result = saleRequestSchema.safeParse({
      ...baseRequest,
      items: Array.from({ length: 101 }, (_, index) => ({ productId: `product-${index}`, quantity: 1 })),
    });
    expect(result.success).toBe(false);
  });
});
