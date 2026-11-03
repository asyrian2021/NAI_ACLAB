import { test, expect } from "@playwright/test";

test("menu and progress stay visible while every editor scrolls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    state.categories = Array.from({ length: 12 }, (_, i) => ({
      ...state.categories[0],
      name: `스크롤 그룹 ${i + 1}`,
    }));
    state.prompt_presets[0].characters = Array.from({ length: 8 }, () => ({
      prompt: "test character",
      negative: "",
    }));
    // A preset can appear only once in the batting test, so use 12 presets.
    const base = state.prompt_presets[0];
    state.prompt_presets = Array.from({ length: 12 }, (_, i) =>
      i ? { ...base, name: `${base.name} ${i + 1}` } : base,
    );
    state.batting_scenes = state.prompt_presets.map((p: any) => ({
      name: "",
      preset: p.name,
      sizes: [{ image_size: "portrait", count: 1 }],
    }));
    Object.assign(state.api, {
      mock_mode: true,
      seed: -1,
      width: 64,
      height: 64,
    });
    state.generation.count = 1;
    state.generation.image_size = "custom";
    const { job_id } = await (
      await fetch("/api/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ state }),
      })
    ).json();
    for (let i = 0; i < 100; i++) {
      const next = await (await fetch("/api/state", { headers })).json();
      if (
        next.state.history.some((h: any) => h.id === job_id && h.items.length)
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Source generation timed out");
  });
  await page.reload();
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  async function checkBars() {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document
            .querySelector(".app-header")!
            .getBoundingClientRect();
          const footer = document
            .querySelector(".statusbar")!
            .getBoundingClientRect();
          return (
            Math.abs(header.top) < 1 &&
            Math.abs(footer.bottom - innerHeight) < 1 &&
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth
          );
        }),
      )
      .toBeTruthy();
  }
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 700 },
    { width: 700, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of [
      "프롬프트",
      "작가",
      "타율 테스트",
      "가이던스 테스트",
      "설정",
    ]) {
      await nav.getByRole("button", { name, exact: true }).click();
      const content = page.locator(
        name === "가이던스 테스트" ? ".sweep-main" : ".editor-page",
      );
      if (name === "가이던스 테스트") {
        const source = page.getByRole("button", {
          name: "원본 이미지 1 선택",
          exact: true,
        });
        if (await source.count()) await source.click();
      }
      await checkBars();
      await content.evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      if (name !== "설정")
        await expect
          .poll(() => content.evaluate((e) => e.scrollTop))
          .toBeGreaterThan(0);
      await checkBars();
      await page
        .getByRole("button", { name: /^대기열 \d+$/, exact: false })
        .click();
      const panel = page.locator(".queue-panel");
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      const footer = await page.locator(".statusbar").boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y);
      await checkBars();
      await page
        .getByRole("button", { name: "대기열 닫기", exact: true })
        .click();
      await content.hover();
      await page.mouse.wheel(0, -400);
      await checkBars();
    }
    await nav.getByRole("button", { name: "작업실", exact: true }).click();
    await checkBars();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await nav.getByRole("button", { name: "타율 테스트", exact: true }).click();
  await page.locator(".editor-page").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await checkBars();
  await page.screenshot({ path: "test-results/fixed-menu-and-status.png" });
  await checkBars();
});
