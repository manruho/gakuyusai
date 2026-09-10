import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterPage } from "../../src/app/routes/RegisterPage";

const productResponse = {
  ok: true,
  data: {
    items: [
      {
        id: "salmon",
        displayName: "鮭おにぎり",
        category: "おにぎり",
        price: 750,
        currentStock: 10,
        presaleRemaining: 3,
        isPresaleLimitReached: false,
        statusLevel: 3,
        isSoldOut: false,
        isActive: true,
      },
    ],
  },
};

describe("RegisterPage", () => {
  let currentRegisterId = 1;
  let currentSaleType: "normal" | "presale_pickup" = "normal";

  const renderRegister = () => render(<MemoryRouter><RegisterPage /></MemoryRouter>);

  beforeEach(() => {
    currentRegisterId = 1;
    currentSaleType = "normal";
    productResponse.data.items[0].presaleRemaining = 3;
    productResponse.data.items[0].isPresaleLimitReached = false;
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/staff/register/checkout-drafts')) {
          return new Response(JSON.stringify({ ok: true, data: { draftId: 'draft-1', pickupCode: '7KQ2', expiresAt: new Date(Date.now() + 180_000).toISOString(), totalAmount: 750 } }));
        }
        if (url.includes("/api/auth/me")) {
          return new Response(
            JSON.stringify({ ok: true, data: { role: "staff" } }),
          );
        }
        if (url.includes("/api/staff/register/current")) {
          const saleType = currentRegisterId === 4 ? "presale_pickup" : currentSaleType;
          return new Response(JSON.stringify({ ok: true, data: { registerId: currentRegisterId, stationId: saleType === "presale_pickup" ? 4 : currentRegisterId, saleType } }));
        }
        return new Response(JSON.stringify(productResponse));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("預かり不足中は不足額を表示し、確定ボタンを無効にする", async () => {
    const user = userEvent.setup();
    renderRegister();

    await screen.findByText("鮭おにぎり");
    await user.click(
      screen.getAllByRole("button", { name: "鮭おにぎり を 1 個追加する" })[0],
    );
    await user.click(screen.getByRole("button", { name: "会計へ進む" }));

    expect(screen.getByText("今回の注文内容（1点）")).toBeVisible();
    expect(screen.getByText('7KQ2')).toBeVisible();

    expect(screen.getByText("あと￥750")).toBeVisible();
    expect(screen.queryByText("不足")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "お会計確定" })).toBeDisabled();
  });

  it("事前販売では前日に現金を受け取り、専用IDを発行する", async () => {
    const user = userEvent.setup();
    currentRegisterId = 4;
    renderRegister();

    expect(await screen.findByText("前売り専用")).toBeVisible();
    await screen.findByText("鮭おにぎり");
    await user.click(
      screen.getAllByRole("button", { name: "鮭おにぎり を 1 個追加する" })[0],
    );
    await user.click(screen.getByRole("button", { name: "前売り会計へ" }));

    expect(screen.getByLabelText("預かり金額")).toBeInTheDocument();
    expect(screen.getByText("今回の注文内容（1点）")).toBeVisible();
    expect(screen.getByRole("button", { name: "前売り券を発行" })).toBeDisabled();
    expect(screen.getByText("前日に現金を受け取ります")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "ちょうど" }));
    expect(screen.getByRole("button", { name: "前売り券を発行" })).toBeEnabled();
  });

  it("設定で前売り化したレジ1は受取4へ案内する", async () => {
    const user = userEvent.setup();
    currentSaleType = "presale_pickup";
    renderRegister();

    expect(await screen.findByText("前売り専用")).toBeVisible();
    expect(screen.getByText("受取4 / 色紙 白")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "鮭おにぎり を 1 個追加する" })[0]);
    await user.click(screen.getByRole("button", { name: "前売り会計へ" }));
    expect(screen.getByRole("heading", { name: "前売り会計" })).toBeVisible();
  });

  it("前売り上限に達した商品は前売り終了として選択できない", async () => {
    currentRegisterId = 4;
    productResponse.data.items[0].presaleRemaining = 0;
    productResponse.data.items[0].isPresaleLimitReached = true;
    renderRegister();

    expect(await screen.findByText("前売り終了")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "鮭おにぎり を 1 個追加する" })[0]).toBeDisabled();
  });

  it("カートの削除は確認後にすべての個数を削除する", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderRegister();

    await screen.findByText("鮭おにぎり");
    const addButton = screen.getAllByRole("button", {
      name: "鮭おにぎり を 1 個追加する",
    })[0];
    await user.click(addButton);
    await user.click(addButton);

    expect(screen.queryByText("削除")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "鮭おにぎりをカートからすべて削除する",
      }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "鮭おにぎりをカートからすべて削除します。よろしいですか？",
    );
    expect(screen.queryByText("商品を選んでください。")).not.toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(
      screen.getByRole("button", {
        name: "鮭おにぎりをカートからすべて削除する",
      }),
    );
    expect(screen.getByText("商品を選んでください。")).toBeVisible();
  });

  it("預かり金額はテンキーで6桁を超えて入力できない", async () => {
    const user = userEvent.setup();
    renderRegister();

    await screen.findByText("鮭おにぎり");
    await user.click(
      screen.getAllByRole("button", {
        name: "鮭おにぎり を 1 個追加する",
      })[0],
    );
    await user.click(screen.getByRole("button", { name: "会計へ進む" }));

    const nineButton = screen.getByRole("button", { name: "9" });
    for (let index = 0; index < 7; index += 1) await user.click(nineButton);

    expect(screen.getByLabelText("預かり金額")).toHaveValue("￥999,999");
    expect(nineButton).toBeDisabled();
    expect(screen.getByText("最大6桁")).toBeVisible();
  });
});
