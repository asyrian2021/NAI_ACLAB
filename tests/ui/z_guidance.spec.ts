import { test, expect } from "@playwright/test";

test("guidance sweep preserves the source and draws a labeled comparison grid", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .waitFor();
  const buttons = await page.locator("header nav button").allTextContents();
  expect(buttons.indexOf("가이던스 테스트")).toBe(
    buttons.indexOf("타율 테스트") + 1,
  );
  await page.getByLabel("생성 매수", { exact: true }).fill("1");
  const before = await page.locator(".thumbnail-button").count();
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(before + 1, {
    timeout: 30000,
  });
  if (await page.getByRole("button", { name: "대기열 닫기" }).count())
    await page.getByRole("button", { name: "대기열 닫기" }).click();
  await page.getByRole("button", { name: "작가", exact: true }).click();
  const check = page.getByLabel("등록 작가 전체 사용").first();
  const box = await check.boundingBox();
  const label = await check.locator("..").boundingBox();
  expect(box!.x - label!.x).toBeLessThan(label!.width / 4);
  expect(
    await check
      .locator("..")
      .evaluate((e) => getComputedStyle(e).flexDirection),
  ).toBe("row");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  await page
    .getByRole("button", { name: "원본 이미지 1 선택", exact: true })
    .click();
  const selectedThumb = page.locator('.sweep-source[aria-pressed="true"] img');
  const preview = page.getByAltText("선택한 원본 프리뷰", { exact: true });
  await expect(preview).toHaveAttribute(
    "src",
    (await selectedThumb.getAttribute("src"))!,
  );
  const previewBounds = await preview.boundingBox();
  expect(previewBounds!.height).toBeGreaterThanOrEqual(220);
  expect(previewBounds!.width).toBeGreaterThanOrEqual(150);
  await page
    .getByRole("button", { name: "선택한 원본 크게 보기", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "원본 이미지 프리뷰", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByAltText("확대한 원본 이미지", { exact: true }),
  ).toHaveAttribute("src", (await preview.getAttribute("src"))!);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "원본 이미지 프리뷰", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("X축 · Guidance 끝", { exact: true }).fill("5.2");
  await page.getByLabel("X축 · Guidance 시작", { exact: true }).fill("5");
  await page.getByLabel("X축 · Guidance 간격", { exact: true }).fill("0.1");
  await page.getByLabel("Y축 · Rescale 끝", { exact: true }).fill("0.2");
  await page.getByLabel("Y축 · Rescale 시작", { exact: true }).fill("0");
  await page.getByLabel("Y축 · Rescale 간격", { exact: true }).fill("0.2");
  await expect(page.locator(".sweep-setup")).toContainText(
    "3열 × 2행 = 총 6장",
  );
  await expect(page.locator(".sweep-source-summary")).toContainText(
    "원본 설정:",
  );
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "원본 이미지 1 선택", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("X축 · Guidance 간격", { exact: true }),
  ).toHaveValue("0.1");
  await page
    .getByRole("button", { name: "가이던스 테스트 시작 · 6장", exact: true })
    .click();
  await expect(page.locator(".sweep-cell img")).toHaveCount(6, {
    timeout: 30000,
  });
  await expect(page.locator(".sweep-y")).toHaveText(["0.2", "0"]);
  await expect(page.locator(".sweep-x")).toHaveText(["5", "5.1", "5.2"]);
  await expect(page.locator(".sweep-axis-x")).toContainText("X축 · Guidance →");
  await expect(page.locator(".sweep-corner")).toContainText("Y축");
  await expect(page.locator(".sweep-corner")).toContainText("Rescale ↑");
  const axisTitle = await page.locator(".sweep-axis-x").boundingBox();
  const xValue = await page.locator(".sweep-x").first().boundingBox();
  const yValue = await page.locator(".sweep-y").first().boundingBox();
  const firstCell = await page.locator(".sweep-cell").first().boundingBox();
  expect(axisTitle!.y).toBeLessThan(xValue!.y);
  expect(xValue!.y).toBeLessThan(firstCell!.y);
  expect(yValue!.x).toBeLessThan(firstCell!.x);
  await expect(
    page.locator(".sweep-source-group").first().locator(".sweep-source"),
  ).toHaveCount(6);
  await expect(
    page.locator(".sweep-source-group").nth(1).locator(".sweep-source"),
  ).toHaveCount(1);
  await expect(
    page.locator(".sweep-source-group").first().locator("summary"),
  ).toContainText("가이던스 테스트 · 6장");
  await expect(
    page.locator(".sweep-source-group").nth(1).locator("summary"),
  ).toContainText("이미지 생성 · 1장");
  await page.locator(".sweep-source-group").first().locator("summary").click();
  await expect(
    page
      .locator(".sweep-source-group")
      .first()
      .locator(".sweep-source")
      .first(),
  ).toBeHidden();
  await page.locator(".sweep-source-group").first().locator("summary").click();

  await expect(
    page.getByRole("button", {
      name: "Guidance 5.2, Rescale 0.2 결과 보기",
      exact: true,
    }),
  ).toBeVisible();
  const snapshot = await page.evaluate(async () => {
    const r = await fetch("/api/state", {
      headers: { "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__ },
    });
    const { state } = await r.json();
    const run = state.history.find((h: any) => h.type === "guidance_test");
    const original = state.history
      .flatMap((h: any) => h.items)
      .find((i: any) => i.path === run.sweep.source_path);
    return { source: original, cells: run.items };
  });
  for (const item of snapshot.cells) {
    expect(item.seed).toBe(snapshot.source.seed);
    expect(item.prompt).toBe(snapshot.source.prompt);
    expect(item.negative_prompt).toBe(snapshot.source.negative_prompt);
    expect(item.artists).toEqual(snapshot.source.artists);
  }
  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  const fullView = page.getByRole("dialog", {
    name: "비교 격자 전체 화면",
    exact: true,
  });
  await expect(fullView).toBeVisible();
  const fullBounds = await fullView.boundingBox();
  expect(fullBounds!.x).toBe(0);
  expect(fullBounds!.y).toBe(0);
  expect(fullBounds!.width).toBe(page.viewportSize()!.width);
  expect(fullBounds!.height).toBe(page.viewportSize()!.height);
  await expect(fullView.locator(".sweep-cell img")).toHaveCount(6);
  await expect
    .poll(() =>
      fullView
        .locator(".sweep-grid-full")
        .evaluate(
          (e) =>
            e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth,
        ),
    )
    .toBeTruthy();
  await page.screenshot({ path: "test-results/guidance-grid-fullscreen.png" });
  await fullView
    .getByRole("button", {
      name: "Guidance 5, Rescale 0.2 결과 보기",
      exact: true,
    })
    .click();
  const nestedViewer = page.getByRole("dialog", {
    name: "가이던스 테스트 이미지 확대",
    exact: true,
  });
  await expect(nestedViewer).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(nestedViewer.locator(".viewer-guidance")).toHaveText(
    "Guidance 5.1",
  );
  await page.keyboard.press("Escape");
  await expect(nestedViewer).toHaveCount(0);
  await expect(fullView).toBeVisible();
  const beforeZoom = await fullView
    .locator(".sweep-cell")
    .first()
    .boundingBox();
  await fullView
    .getByRole("button", { name: "격자 확대", exact: true })
    .click();
  const afterZoom = await fullView.locator(".sweep-cell").first().boundingBox();
  expect(afterZoom!.height).toBeGreaterThan(beforeZoom!.height);
  await fullView
    .getByRole("button", { name: "화면 맞춤", exact: true })
    .click();
  await page.setViewportSize({ width: 880, height: 700 });
  await expect
    .poll(() =>
      fullView
        .locator(".sweep-grid-full")
        .evaluate(
          (e) =>
            e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth,
        ),
    )
    .toBeTruthy();
  await page.screenshot({
    path: "test-results/guidance-grid-fullscreen-compact.png",
  });
  await page.keyboard.press("Escape");
  await expect(fullView).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "전체 화면", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "test-results/guidance-test-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 880, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/guidance-test-compact.png",
    fullPage: true,
  });
  await page.getByLabel("X축 · Guidance 끝", { exact: true }).fill("5.1");
  await expect(page.locator(".sweep-setup")).toContainText(
    "2열 × 2행 = 총 4장",
  );
  await page.getByLabel("X축 · Guidance 끝", { exact: true }).fill("5.2");
  await page.getByLabel("X축 · Guidance 간격", { exact: true }).fill("0");
  await expect(
    page.getByRole("button", { name: "가이던스 테스트 시작", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("X축 · Guidance 간격", { exact: true }).fill("0.1");
  await page
    .getByRole("button", {
      name: "Guidance 5.2, Rescale 0.2 결과 보기",
      exact: true,
    })
    .click();
  const imageView = page.getByRole("dialog", {
    name: "가이던스 테스트 이미지 확대",
    exact: true,
  });
  await expect(imageView).toBeVisible();
  await expect(imageView.locator(".viewer-guidance")).toHaveText(
    "Guidance 5.2",
  );
  await expect(imageView.locator(".viewer-rescale")).toHaveText("Rescale 0.2");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await expect(imageView.locator(".viewer-guidance")).toHaveText(
    "Guidance 5.2",
  );
  await expect(imageView.locator(".viewer-rescale")).toHaveText("Rescale 0.2");
  await page.keyboard.press("ArrowLeft");
  await expect(imageView.locator(".viewer-guidance")).toHaveText(
    "Guidance 5.1",
  );
  await expect(imageView.locator("img")).toHaveAttribute(
    "src",
    snapshot.cells.find((i: any) => i.sweep_x === 1 && i.sweep_y === 1)
      .image_url,
  );
  await page.keyboard.press("ArrowDown");
  await expect(imageView.locator(".viewer-rescale")).toHaveText("Rescale 0");
  await expect(imageView.locator("img")).toHaveAttribute(
    "src",
    snapshot.cells.find((i: any) => i.sweep_x === 1 && i.sweep_y === 0)
      .image_url,
  );
  await page.keyboard.press("ArrowDown");
  await expect(imageView.locator(".viewer-rescale")).toHaveText("Rescale 0");
  await page.keyboard.press("ArrowUp");
  await expect(imageView.locator(".viewer-rescale")).toHaveText("Rescale 0.2");
  await page.screenshot({ path: "test-results/guidance-image-viewer.png" });
  await page.keyboard.press("Escape");
  await expect(imageView).toHaveCount(0);
  await expect(page.locator("header nav button.active")).toHaveText(
    "가이던스 테스트",
  );
  await expect(page.locator(".stage")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  await expect(page.locator(".sweep-cell img")).toHaveCount(6);
  const payload = await page.evaluate(async () =>
    (
      await fetch("/api/state", {
        headers: { "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__ },
      })
    ).json(),
  );
  const base = payload.state.history.find(
    (h: any) => h.type === "guidance_test",
  );
  const testRun = {
    ...base,
    id: "overview-200",
    sweep: {
      ...base.sweep,
      x_values: [5],
      y_values: Array.from({ length: 200 }, (_, i) => i / 199),
    },
    items: Array.from({ length: 200 }, (_, i) => ({
      ...snapshot.cells[0],
      path: `overview-${i}.png`,
      sweep_x: 0,
      sweep_y: i,
    })),
  };
  testRun.items[198].error = "mock cell failure";
  testRun.items = testRun.items.filter((i: any) => i.sweep_y !== 197);
  payload.state.history.unshift(testRun);
  await page.route("**/api/state", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: payload })
      : route.continue(),
  );
  await page.reload();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  await expect(fullView.locator(".sweep-cell")).toHaveCount(200);
  await expect(fullView.locator(".sweep-cell img")).toHaveCount(198);
  await expect
    .poll(() =>
      fullView
        .locator(".sweep-grid-full")
        .evaluate(
          (e) =>
            e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth,
        ),
    )
    .toBeTruthy();
  await fullView
    .getByRole("button", { name: "원래 크기", exact: true })
    .click();
  await fullView
    .getByRole("button", {
      name: "Guidance 5, Rescale 1 결과 보기",
      exact: true,
    })
    .click({ timeout: 5000 });
  await page.keyboard.press("ArrowDown");
  await expect(imageView.getByRole("status")).toContainText(
    "mock cell failure",
  );
  await page.keyboard.press("ArrowDown");
  await expect(imageView.getByRole("status")).toContainText(
    "아직 생성되지 않은 칸",
  );
  await page.keyboard.press("ArrowDown");
  await expect(imageView.locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fullView).toBeVisible();
  await page.keyboard.press("Escape");
});
