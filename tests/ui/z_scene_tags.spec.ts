import { test, expect } from "@playwright/test";

test("scene tags are defined once and picked per scene", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    const base = state.prompt_presets[0];
    state.prompt_presets = [base, { ...base, name: base.name + " 2" }];
    state.scene_tags = [];
    state.batting_scenes = state.prompt_presets.map((p: any) => ({
      name: "",
      preset: p.name,
      sizes: [{ image_size: "portrait", count: 1 }],
      tags: [],
    }));
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
  const scenes = page.locator(".scene-editor");
  // No built-in tags: scenes show no tag buttons until one is defined.
  await expect(
    scenes.first().getByRole("group", { name: "장면 태그" }),
  ).toHaveCount(0);

  await page.getByLabel("새 장면 태그").fill("발 보임");
  await page.getByLabel("새 장면 태그").press("Enter");
  await expect(
    page.getByRole("button", { name: "발 보임 태그 삭제" }),
  ).toBeVisible();
  const toggle = scenes.nth(1).getByRole("button", { name: "발 보임" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(
    scenes.first().getByRole("button", { name: "발 보임" }),
  ).toHaveAttribute("aria-pressed", "false");

  const saved = () =>
    page.evaluate(async () => {
      const headers = {
        "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
      };
      const { state } = await (await fetch("/api/state", { headers })).json();
      return {
        tags: state.scene_tags,
        scenes: state.batting_scenes.map((s: any) => s.tags),
      };
    });
  await expect
    .poll(saved)
    .toEqual({ tags: ["발 보임"], scenes: [[], ["발 보임"]] });

  // Deleting a tag from the list also removes it from every scene.
  await page.getByRole("button", { name: "발 보임 태그 삭제" }).click();
  await expect(
    scenes.nth(1).getByRole("button", { name: "발 보임" }),
  ).toHaveCount(0);
  await expect.poll(saved).toEqual({ tags: [], scenes: [[], []] });
});
