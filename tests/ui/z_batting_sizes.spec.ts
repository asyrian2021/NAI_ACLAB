import { test, expect } from "@playwright/test";

test("each preset appears once and extra image sizes go inside its card", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    state.prompt_presets = [
      { name: "크기 바다", base_prompt: "ocean", characters: [] },
      { name: "크기 정원", base_prompt: "garden", characters: [] },
    ];
    state.generation.preset = "크기 바다";
    state.generation.fixed_artists = [];
    state.scene_tags = [];
    state.batting_scenes = [
      {
        name: "",
        preset: "크기 바다",
        sizes: [{ image_size: "portrait", count: 1 }],
        tags: [],
      },
    ];
    state.api.mock_mode = true;
    state.api.seed = -1;
    await fetch("/api/state", {
      method: "POST",
      headers,
      body: JSON.stringify({ state }),
    });
  });
  await page.reload();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "타율 테스트", exact: true })
    .click();
  const cards = page.locator(".scene-editor");
  const addScene = page.getByRole("button", { name: "씬 추가" });

  // A new card takes the first preset not in the list; then none is left.
  await addScene.click();
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).locator("select").first()).toHaveValue("크기 정원");
  await expect(addScene).toBeDisabled();
  await expect(
    cards
      .first()
      .locator("select")
      .first()
      .locator("option", { hasText: "크기 정원" }),
  ).toHaveJSProperty("disabled", true);
  await cards.nth(1).getByRole("button", { name: "크기 정원 씬 삭제" }).click();
  await expect(cards).toHaveCount(1);

  // Extra sizes are rows inside the same card, each size once.
  const card = cards.first();
  const addSize = card.getByRole("button", { name: "크기 추가" });
  await addSize.click();
  await expect(card.locator(".scene-size")).toHaveCount(2);
  await expect(card.locator(".scene-size select").nth(1)).toHaveValue(
    "landscape",
  );
  await addSize.click();
  await expect(card.locator(".scene-size")).toHaveCount(3);
  await expect(addSize).toHaveCount(0);
  await card.getByRole("button", { name: "정사각형 크기 빼기" }).click();
  await expect(card.locator(".scene-size")).toHaveCount(2);

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const headers = {
          "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
        };
        const { state } = await (await fetch("/api/state", { headers })).json();
        return state.batting_scenes;
      }),
    )
    .toEqual([
      {
        name: "",
        preset: "크기 바다",
        sizes: [
          { image_size: "portrait", count: 1 },
          { image_size: "landscape", count: 1 },
        ],
        tags: [],
      },
    ]);

  // One run makes every size row: here one portrait and one landscape image.
  await page
    .getByRole("button", { name: "타율 테스트 시작", exact: true })
    .click();
  await expect(page.locator(".batting-thumbnails button")).toHaveCount(2, {
    timeout: 60000,
  });
});
