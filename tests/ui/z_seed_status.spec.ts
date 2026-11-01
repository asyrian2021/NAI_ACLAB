import { test, expect } from "@playwright/test";

test("seed indicators track the actual source and fixed batting seeds require confirmation", async ({
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
    Object.assign(state.api, {
      mock_mode: true,
      seed: 0,
      width: 64,
      height: 64,
    });
    state.generation.count = 1;
    state.generation.image_size = "custom";
    state.batting_scenes = [
      {
        name: "",
        preset: state.prompt_presets[0].name,
        image_size: "portrait",
        count: 1,
      },
    ];
    state.guidance_test.source_path = "";
    await fetch("/api/state", {
      method: "POST",
      headers,
      body: JSON.stringify({ state }),
    });
  });
  await page.reload();
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  const studioStatus = page.locator(".studio-generation .seed-status");
  await expect(studioStatus).toHaveClass(/fixed/);
  await expect(studioStatus).toHaveAttribute(
    "aria-label",
    "시드 고정 · Seed 0",
  );
  await expect(studioStatus).toHaveCSS("color", "rgb(244, 130, 130)");
  const studioResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/generate") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  const { job_id } = await (await studioResponse).json();
  const thumb = page.locator(`.thumbnail-button img[src*="${job_id}"]`).first();
  await expect(thumb).toBeVisible();
  await thumb.click();
  const seedToggle = page.getByRole("button", {
    name: "이 시드 사용",
    exact: true,
  });
  await seedToggle.click();
  await expect(studioStatus).toHaveClass(/random/);
  await expect(studioStatus).toHaveCSS("color", "rgb(150, 157, 161)");
  await seedToggle.click();
  await expect(studioStatus).toHaveAttribute(
    "aria-label",
    "시드 고정 · Seed 0",
  );
  await nav.getByRole("button", { name: "타율 테스트", exact: true }).click();
  await expect(page.locator(".batting-generation .seed-status")).toHaveClass(
    /fixed/,
  );
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/batting/generate")) requests++;
  });
  const start = page.getByRole("button", {
    name: "타율 테스트 시작",
    exact: true,
  });
  const dialog = page.getByRole("alertdialog", {
    name: "고정 시드로 시작할까요?",
    exact: true,
  });
  await start.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("현재 시드: 0 (고정)");
  await expect(
    dialog.getByRole("button", { name: "취소", exact: true }),
  ).toBeFocused();
  expect(requests).toBe(0);
  await page.screenshot({ path: "test-results/fixed-seed-confirmation.png" });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await expect(start).toBeFocused();
  await start.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await start.click();
  await dialog
    .getByRole("button", { name: "고정 시드로 시작", exact: true })
    .click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator(".batting-image-values")).toContainText("Seed 0");
  await nav.getByRole("button", { name: "작업실", exact: true }).click();
  await seedToggle.click();
  await expect(studioStatus).toHaveClass(/random/);
  await nav.getByRole("button", { name: "타율 테스트", exact: true }).click();
  await expect(page.locator(".batting-generation .seed-status")).toHaveClass(
    /random/,
  );
  await start.click();
  await expect.poll(() => requests).toBe(2);
  await expect(dialog).toHaveCount(0);
  await nav
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  const guidanceStatus = page.locator(".guidance-generation .seed-status");
  await expect(guidanceStatus).toHaveAttribute(
    "aria-label",
    "원본 이미지를 선택하세요",
  );
  await page
    .getByRole("button", { name: "원본 이미지 1 선택", exact: true })
    .click();
  await expect(guidanceStatus).toHaveClass(/fixed/);
  await expect(guidanceStatus).toHaveCSS("color", "rgb(244, 130, 130)");
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  const seed = await page.evaluate(
    async () =>
      (
        await (
          await fetch("/api/state", {
            headers: {
              "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
            },
          })
        ).json()
      ).state.api.seed,
  );
  expect(seed).toBe(-1);
});
