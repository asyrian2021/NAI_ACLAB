import { test, expect } from "@playwright/test";

test("artist groups can be reordered and keep their editors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  const original = await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    const before = structuredClone(state.categories);
    const group = (name: string, tag: string) => ({
      ...state.categories[0],
      name,
      tags: [tag],
      disabled_tags: [],
    });
    state.categories = [
      group("순서 A", "artist:order_a"),
      group("순서 B", "artist:order_b"),
      group("순서 C", "artist:order_c"),
    ];
    await fetch("/api/state", {
      method: "POST",
      headers,
      body: JSON.stringify({ state }),
    });
    return before;
  });
  await page.reload();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "작가", exact: true })
    .click();
  const names = page.getByLabel("작가 그룹 이름");
  const values = () =>
    names.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(await values()).toEqual(["순서 A", "순서 B", "순서 C"]);
  await expect(
    page.getByRole("button", { name: "순서 A 그룹 앞으로" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "순서 C 그룹 뒤로" }),
  ).toBeDisabled();

  // An unsent draft in C's add field moves with the group.
  const editors = page.locator(".artist-editor");
  await editors.nth(2).getByLabel("작가 태그 추가").fill("artist:draft_c");
  await page.getByRole("button", { name: "순서 C 그룹 앞으로" }).click();
  expect(await values()).toEqual(["순서 A", "순서 C", "순서 B"]);
  await expect(editors.nth(1).getByLabel("작가 태그 추가")).toHaveValue(
    "artist:draft_c",
  );
  await expect(editors.nth(2).getByLabel("작가 태그 추가")).toHaveValue("");
  // Focus follows the moved group, so the arrow can be pressed again.
  await expect(
    page.getByRole("button", { name: "순서 C 그룹 앞으로" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await values()).toEqual(["순서 C", "순서 A", "순서 B"]);
  await expect(
    page.getByRole("button", { name: "순서 C 그룹 뒤로" }),
  ).toBeFocused();
  await expect(editors.first().locator(".artist-order-number")).toHaveText("1");

  // The new order is saved.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const headers = {
          "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
        };
        const { state } = await (await fetch("/api/state", { headers })).json();
        return state.categories.map((c: any) => c.name);
      }),
    )
    .toEqual(["순서 C", "순서 A", "순서 B"]);

  await page.evaluate(async (categories) => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    state.categories = categories;
    await fetch("/api/state", {
      method: "POST",
      headers,
      body: JSON.stringify({ state }),
    });
  }, original);
});
