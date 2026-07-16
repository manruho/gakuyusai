import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        statusLevel: 3,
        isSoldOut: false,
        isActive: true,
      },
    ],
  },
};

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/auth/me")) {
          return new Response(
            JSON.stringify({ ok: true, data: { role: "staff" } }),
          );
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
    render(<RegisterPage />);

    await screen.findByText("鮭おにぎり");
    await user.click(
      screen.getAllByRole("button", { name: "鮭おにぎり を 1 個追加する" })[0],
    );
    await user.click(screen.getByRole("button", { name: "会計へ進む" }));

    expect(screen.getByText("あと￥750")).toBeVisible();
    expect(screen.queryByText("不足")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "お会計確定" })).toBeDisabled();
  });

  it("事前販売では現金入力を表示せず、受け渡し専用文言にする", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.click(screen.getByRole("button", { name: "事前販売" }));
    await screen.findByText("鮭おにぎり");
    await user.click(
      screen.getAllByRole("button", { name: "鮭おにぎり を 1 個追加する" })[0],
    );
    await user.click(screen.getByRole("button", { name: "受け渡し確認へ" }));

    expect(screen.queryByLabelText("預かり金額")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "受け渡し確定" })).toBeEnabled();
    expect(screen.getByText("事前支払い済み")).toBeVisible();
  });
});
