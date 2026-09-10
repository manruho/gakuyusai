import { describe, expect, it } from "vitest";
import { saleRequestSchema, validatePresaleRegister, validateSalePayment, validateSalesDay } from "../../worker/services/saleService";

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

  it("事前販売は前日に現金を受け取り、合計以上の預かりを受け付ける", () => {
    expect(
      validateSalePayment(
        { saleType: "presale_pickup", paymentMethod: "cash", paidAmount: 1000 },
        750,
      ),
    ).toBeNull();
    expect(
      validateSalePayment(
        { saleType: "presale_pickup", paymentMethod: "prepaid", paidAmount: 0 },
        750,
      )?.code,
    ).toBe("INVALID_PAYMENT");
    expect(
      validateSalePayment(
        { saleType: "presale_pickup", paymentMethod: "cash", paidAmount: 500 },
        750,
      )?.code,
    ).toBe("INSUFFICIENT_PAYMENT");
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

describe("validatePresaleRegister", () => {
  it("既定ではレジ4だけを前売り専用として扱う", () => {
    expect(validatePresaleRegister("presale_pickup", 4)).toBeNull();
    expect(validatePresaleRegister("presale_pickup", 3)?.code).toBe("PRESALE_REGISTER_ONLY");
    expect(validatePresaleRegister("normal", 3)).toBeNull();
    expect(validatePresaleRegister("normal", 4)?.code).toBe("REGISTER4_PRESALE_ONLY");
  });

  it('設定で前売り専用にしたレジは前売りだけを受け付ける', () => {
    expect(validatePresaleRegister('presale_pickup', 1, 'presale_pickup')).toBeNull();
    expect(validatePresaleRegister('normal', 1, 'presale_pickup')?.code).toBe('REGISTER_MODE_MISMATCH');
    expect(validatePresaleRegister('normal', 2, 'normal')).toBeNull();
    expect(validatePresaleRegister('presale_pickup', 2, 'normal')?.code).toBe('REGISTER_MODE_MISMATCH');
  });
});

describe("validateSalesDay", () => {
  it("1日目は前売り券だけを受け付ける", () => {
    expect(validateSalesDay('day1', 'presale_pickup')).toBeNull();
    expect(validateSalesDay('day1', 'normal')?.code).toBe('DAY1_PRESALE_ONLY');
  });

  it("2日目は通常販売だけを受け付ける", () => {
    expect(validateSalesDay('day2', 'normal')).toBeNull();
    expect(validateSalesDay('day2', 'presale_pickup')?.code).toBe('DAY2_NORMAL_ONLY');
  });

  it("制限なしでは両方の販売種別を受け付ける", () => {
    expect(validateSalesDay('all', 'normal')).toBeNull();
    expect(validateSalesDay('all', 'presale_pickup')).toBeNull();
  });
});
