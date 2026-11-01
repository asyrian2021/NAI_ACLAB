import { test, expect } from "@playwright/test";

test("batting results stay in the test menu with live previews and keyboard browsing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    state.prompt_presets.push(
      { name: "타율 바다", base_prompt: "ocean", characters: [] },
      { name: "타율 정원", base_prompt: "garden", characters: [] },
    );
    state.batting_scenes = [
      { name: "", preset: "타율 바다", image_size: "portrait", count: 2 },
      { name: "", preset: "타율 정원", image_size: "landscape", count: 1 },
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
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await nav.getByRole("button", { name: "타율 테스트", exact: true }).click();
  await page
    .getByRole("button", { name: "타율 테스트 시작", exact: true })
    .click();
  const thumbs = page.locator(".batting-thumbnails button");
  const stage = page.locator(".batting-result-stage");
  await expect(thumbs).toHaveCount(3, { timeout: 30000 });
  await expect(stage.locator("img")).toBeVisible();
  await expect(nav.locator(".active")).toHaveText("타율 테스트");
  await expect(page.locator(".batting-image-count")).toHaveText("1 / 3");
  await expect(page.locator(".batting-result-group")).toHaveCount(2);
  await thumbs.first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(thumbs.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(thumbs.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".batting-image-values strong")).toHaveText(
    "타율 정원",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".batting-image-count")).toHaveText("3 / 3");
  await page.keyboard.press("ArrowUp");
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await page.locator(".scene-editor input").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await stage.click();
  const viewer = page.getByRole("dialog", {
    name: "타율 테스트 이미지 확대",
    exact: true,
  });
  await expect(viewer).toBeVisible();
  await expect(page.locator("#root")).toHaveJSProperty("inert", true);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".batting-image-count")).toHaveText("2 / 3");
  await page.keyboard.press("ArrowDown");
  await expect(viewer.locator(".batting-image-values strong")).toHaveText(
    "타율 정원",
  );
  await page.screenshot({ path: "test-results/batting-image-viewer.png" });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.locator("#root")).toHaveJSProperty("inert", false);
  await expect(stage).toBeFocused();
  const firstRun = await page
    .getByLabel("타율 테스트 기록", { exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "타율 테스트 시작", exact: true })
    .click();
  await expect(
    page.getByLabel("타율 테스트 기록", { exact: true }),
  ).not.toHaveValue(firstRun);
  await expect(thumbs).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator(".batting-image-count")).toHaveText("1 / 3");
  await page
    .getByLabel("타율 테스트 기록", { exact: true })
    .selectOption(firstRun);
  await expect(stage.locator("img")).toHaveAttribute(
    "src",
    new RegExp(firstRun),
  );
  await page.screenshot({
    path: "test-results/batting-results.png",
    fullPage: true,
  });

  // Serve successive checkpoints while a test is still running. New images must
  // appear without moving the user's selection, including failed result slots.
  const payload = await page.evaluate(async () =>
    (
      await fetch("/api/state", {
        headers: { "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__ },
      })
    ).json(),
  );
  const sourceRun = payload.state.history.find((h: any) => h.id === firstRun);
  const newRun = {
    ...sourceRun,
    id: "live-batting",
    items: sourceRun.items.slice(0, 1),
  };
  payload.state.history.unshift(newRun);
  let progress = 1;
  await page.route("**/api/state", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: payload })
      : route.continue(),
  );
  await page.route("**/api/jobs", (route) =>
    route.fulfill({
      json: {
        jobs: [
          {
            id: newRun.id,
            status: "running",
            name: "타율 테스트",
            progress,
            total: Math.max(4, progress),
          },
        ],
      },
    }),
  );
  await page.reload();
  await nav.getByRole("button", { name: "타율 테스트", exact: true }).click();
  await expect(thumbs).toHaveCount(1);
  await expect(page.locator(".batting-job-status")).toContainText("1/4장");
  newRun.items = [
    ...sourceRun.items,
    {
      ...sourceRun.items[2],
      path: "failed-batting-image",
      error: "테스트 생성 오류",
    },
  ];
  progress = 4;
  await expect(thumbs).toHaveCount(4);
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await thumbs.nth(3).click();
  await expect(stage).toContainText("테스트 생성 오류");
  await page.keyboard.press("ArrowLeft");
  await expect(stage.locator("img")).toBeVisible();
  newRun.items = Array.from({ length: 36 }, (_, i) => ({
    ...sourceRun.items[i % 3],
    path: `rail-image-${i}`,
    preset: `비교 프리셋 ${Math.floor(i / 6) + 1}`,
  }));
  progress = 36;
  await expect(thumbs).toHaveCount(36);
  const rail = page.locator(".batting-thumbnails");
  await expect
    .poll(() =>
      rail.evaluate(
        (e) =>
          e.scrollWidth > e.clientWidth && e.scrollHeight <= e.clientHeight,
      ),
    )
    .toBeTruthy();
  const groupBoxes = await page
    .locator(".batting-result-group")
    .evaluateAll((groups) => groups.map((g) => g.getBoundingClientRect().y));
  expect(new Set(groupBoxes).size).toBe(1);
  await thumbs.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(thumbs.nth(6)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(thumbs.nth(12)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => rail.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(0);
  const scrollBeforeWheel = await rail.evaluate((e) => e.scrollLeft);
  await rail.hover();
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => rail.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(scrollBeforeWheel);
  const settings = await page.locator(".batting-settings").boundingBox();
  const preview = await page.locator(".batting-preview-panel").boundingBox();
  const gallery = await page.locator(".batting-gallery").boundingBox();
  expect(preview!.x - settings!.x - settings!.width).toBeGreaterThanOrEqual(30);
  expect(gallery!.y - preview!.y - preview!.height).toBeGreaterThanOrEqual(18);
  await page.screenshot({
    path: "test-results/batting-horizontal-gallery.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  expect(errors).toEqual([]);
});
