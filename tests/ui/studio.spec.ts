import { test, expect } from "@playwright/test";

test("unified presets, global prompts, random generation, comparison and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".left-panel > section").nth(0)).toContainText(
    "프롬프트 프리셋",
  );
  await expect(page.locator(".left-panel > section").nth(1)).toContainText(
    "생성 매수",
  );
  await expect(page.locator(".left-panel > section").nth(2)).toContainText(
    "작가 조합",
  );
  await expect(
    page.getByRole("button", { name: "체험 이미지 생성", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "프롬프트", exact: true }).click();
  await page
    .getByRole("textbox", { name: "공통 퀄리티", exact: true })
    .fill("common quality");
  await page
    .getByRole("textbox", { name: "공통 네거티브", exact: true })
    .fill("common negative");
  await page
    .getByRole("textbox", { name: "베이스 프롬프트", exact: true })
    .fill("coastal train");
  await page
    .getByRole("textbox", { name: "캐릭터 프롬프트", exact: true })
    .fill("adult woman");
  await page
    .getByRole("textbox", { name: "캐릭터 네거티브", exact: true })
    .fill("character negative");
  await page.getByRole("button", { name: "프리셋 추가", exact: true }).click();
  await page.getByLabel("프리셋 이름").fill("두 번째 장면");
  await page
    .getByRole("textbox", { name: "베이스 프롬프트", exact: true })
    .fill("garden");
  await expect(
    page.getByRole("textbox", { name: "공통 퀄리티", exact: true }),
  ).toHaveValue("common quality");
  await page.getByRole("button", { name: "기본", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "베이스 프롬프트", exact: true }),
  ).toHaveValue("coastal train");
  await page.getByRole("button", { name: "작가", exact: true }).click();
  await page
    .getByRole("textbox", { name: "작가 태그", exact: true })
    .first()
    .fill("artist:sample_a\nartist:sample_b");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByText("고급 설정", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("API endpoint")).toHaveCount(0);
  await expect(page.getByLabel("User agent")).toHaveCount(0);
  await expect(page.getByLabel("가로 픽셀")).toHaveCount(0);
  await page.getByLabel("Guidance rescale", { exact: true }).fill("0.3");
  await page.locator(".editor-page").evaluate(async (e) => {
    await Promise.all(e.getAnimations().map((a) => a.finished));
  });
  const guidance = await page
    .getByLabel("Prompt guidance", { exact: true })
    .boundingBox();
  const rescale = await page
    .getByLabel("Guidance rescale", { exact: true })
    .boundingBox();
  expect(guidance!.y).toBe(rescale!.y);
  expect(rescale!.x).toBeGreaterThan(guidance!.x);
  await page.getByRole("button", { name: "작업실", exact: true }).click();
  await page
    .getByRole("combobox", { name: "이미지 크기", exact: true })
    .selectOption("custom");
  await page.getByLabel("가로 픽셀").fill("128");
  await page.getByLabel("세로 픽셀").fill("192");
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await expect(page.locator(".save-status")).toBeVisible();
  await page.getByRole("button", { name: "작업실", exact: true }).click();
  await page
    .getByRole("button", { name: "프롬프트 미리보기", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("coastal train");
  await expect(page.getByRole("dialog")).toContainText(
    "common quality | adult woman",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "common negative | character negative",
  );
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.getByLabel("생성 매수", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  await expect(page.locator(".thumbnails .thumbnail-button")).toHaveCount(2, {
    timeout: 30000,
  });
  await expect(page.locator(".right-panel")).toContainText("common quality");
  await expect(page.getByRole("button", { name: "대기열 닫기" })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await expect(page.getByRole("status")).toContainText("준비됨", {
    timeout: 7000,
  });
  await page
    .getByRole("button", { name: "기준으로 고정", exact: true })
    .click();
  await expect(page.locator(".stage .image-card")).toHaveCount(2);
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await expect(page.locator(".stage img").first()).toHaveCSS(
    "transform",
    "matrix(2, 0, 0, 2, 0, 0)",
  );
  await page.getByRole("button", { name: "즐겨찾기", exact: true }).click();
  await page
    .getByRole("button", { name: "이 조합으로 이어서", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "랜덤으로 전환", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".left-panel .section-heading")
      .getByRole("button", { name: "랜덤으로 전환", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await expect(page.getByLabel("가로 픽셀")).toHaveValue("128");
  await expect(page.getByLabel("세로 픽셀")).toHaveValue("192");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    page.getByLabel("Guidance rescale", { exact: true }),
  ).toHaveValue("0.3");
  await page.getByRole("button", { name: "작업실", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "랜덤으로 전환", exact: true }),
  ).toBeVisible();
  const beforeOrder = await page
    .locator(".fixed-artist-heading span")
    .allTextContents();
  await page
    .locator(".drag-handle")
    .first()
    .dragTo(page.locator(".fixed-artist").nth(1));
  await expect(page.locator(".fixed-artist-heading span").first()).toHaveText(
    beforeOrder[1],
  );
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await expect(page.locator(".fixed-artist-heading span").first()).toHaveText(
    beforeOrder[1],
  );
  await page
    .getByRole("button", { name: "프롬프트 미리보기", exact: true })
    .click();
  const assembled = await page
    .locator(".modal .prompt-text")
    .first()
    .textContent();
  expect(assembled!.indexOf(beforeOrder[1])).toBeLessThan(
    assembled!.indexOf(beforeOrder[0]),
  );
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.getByRole("button", { name: "모아보기", exact: true }).click();
  await expect(page.locator(".stage.grid .image-card")).toHaveCount(2);
  expect(
    await page
      .locator(".stage.grid")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
  ).toBeGreaterThan(1);
  await page.getByRole("button", { name: "감상", exact: true }).click();
  await page.getByLabel("생성 매수", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  await expect(page.locator(".generation-group")).toHaveCount(2, {
    timeout: 15000,
  });
  await expect(
    page.locator(".generation-group").nth(0).locator(".thumbnail-button"),
  ).toHaveCount(1);
  await expect(
    page.locator(".generation-group").nth(1).locator(".thumbnail-button"),
  ).toHaveCount(2);
  await expect(page.locator(".generation-group-heading").nth(0)).toContainText(
    "1장",
  );
  await expect(page.locator(".generation-group-heading").nth(1)).toContainText(
    "2장",
  );
  await expect(page.getByRole("button", { name: "대기열 닫기" })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "집중 보기", exact: false }).click();
  await expect(page.locator(".left-panel")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".left-panel")).toBeVisible();
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 880, height: 700 });
  const filmBefore = await page.locator(".filmstrip").boundingBox();
  await expect(page.locator(".prompt-section details[open]")).toHaveCount(0);
  // Stress the actual saved-image information area, including very long captions.
  await page
    .locator(".prompt-section .prompt-text")
    .evaluateAll((nodes) =>
      nodes.forEach((n) => (n.textContent = "long prompt, ".repeat(3000))),
    );
  await page.locator(".prompt-section summary").first().click();
  await page.locator(".prompt-section summary").last().click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBeTruthy();
  expect((await page.locator(".filmstrip").boundingBox())!.y).toBe(
    filmBefore!.y,
  );
  await page.locator(".right-panel").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  expect((await page.locator(".filmstrip").boundingBox())!.y).toBe(
    filmBefore!.y,
  );
  await page.getByRole("button", { name: "대기열 0", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "대기열 닫기" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/studio-compact.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "타율 테스트", exact: true })
    .click();
  await page.getByRole("button", { name: "씬 추가", exact: true }).click();
  await expect(page.getByLabel("씬 이름")).toHaveCount(0);
  await expect(page.locator(".scene-editor select").first()).toHaveValue(
    "기본",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".editor-page")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
});

test("autosave, count ranges and studio seed controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "작가", exact: true }).click();
  const group = page.locator(".artist-editors > section").first();
  await group
    .getByRole("textbox", { name: "작가 태그", exact: true })
    .fill("artist:a\nartist:b\nartist:c\nartist:d\nartist:e");
  await group.getByLabel("등록 작가 전체 사용").uncheck();
  await group.getByLabel("최대 추첨 인원").fill("5");
  await group.getByLabel("최소 추첨 인원").fill("3");
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await page.getByRole("button", { name: "작가", exact: true }).click();
  await expect(group.getByLabel("최소 추첨 인원")).toHaveValue("3");
  await expect(group.getByLabel("최대 추첨 인원")).toHaveValue("5");
  await group.getByLabel("최소 추첨 인원").fill("");
  await expect(page.locator(".save-status")).toContainText("미저장");
  await page.waitForTimeout(900);
  await expect(group.getByLabel("최소 추첨 인원")).toHaveValue("");
  await group.getByLabel("최소 추첨 인원").fill("7");
  await expect(page.locator(".save-status")).toContainText("미저장");
  await group.getByLabel("최소 추첨 인원").fill("3");
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.getByRole("button", { name: "작업실", exact: true }).click();
  await expect(page.locator(".left-panel").getByLabel("시드 모드")).toHaveCount(
    0,
  );
  await expect(
    page.locator(".left-panel").getByLabel("Seed", { exact: true }),
  ).toHaveCount(0);
  for (const width of [880, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const first = await page
      .getByLabel("Prompt guidance", { exact: true })
      .boundingBox();
    const second = await page
      .getByLabel("Guidance rescale", { exact: true })
      .boundingBox();
    expect(first!.y).toBe(second!.y);
    expect(first!.height).toBe(second!.height);
  }
  await page.getByRole("button", { name: "이 시드 사용", exact: true }).click();
  const seedText = await page.locator(".seed-setting").innerText();
  const fixedSeed = seedText.match(/Seed (\d+)/)![1];
  await expect(
    page.getByRole("button", { name: "이 시드 사용", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "시드 고정 해제", exact: true }),
  ).toHaveCount(0);
  for (const title of ["Prompt guidance", "Guidance rescale"]) {
    const input = page.getByLabel(title, { exact: true });
    await input.fill(title === "Prompt guidance" ? "5" : "0.4");
    await input.press("ArrowUp");
    await expect(input).toHaveValue(
      title === "Prompt guidance" ? "5.1" : "0.5",
    );
    await input.press("ArrowDown");
    await expect(input).toHaveValue(title === "Prompt guidance" ? "5" : "0.4");
  }
  await page.getByLabel("Prompt guidance", { exact: true }).fill("6");
  await page.getByLabel("Guidance rescale", { exact: true }).fill("0.4");
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await expect(page.locator(".seed-setting")).toContainText(
    `Seed ${fixedSeed} 고정`,
  );
  await expect(page.getByLabel("Prompt guidance", { exact: true })).toHaveValue(
    "6",
  );
  const groupsBefore = await page.locator(".generation-group").count();
  await page.getByLabel("생성 매수", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  await expect(page.locator(".generation-group")).toHaveCount(
    groupsBefore + 1,
    { timeout: 30000 },
  );
  await page.locator(".thumbnail-button").first().click();
  await expect(page.locator(".right-panel")).toContainText(`Seed ${fixedSeed}`);
  await page.getByRole("button", { name: "이 시드 사용", exact: true }).click();
  await expect(page.locator(".seed-setting")).toContainText("랜덤 시드");
  await expect(
    page.getByRole("button", { name: "이 시드 사용", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await expect(page.locator(".seed-setting")).toContainText("랜덤 시드");
  await page.getByRole("button", { name: "이 시드 사용", exact: true }).click();
  await expect(page.locator(".seed-setting")).toContainText(
    `Seed ${fixedSeed} 고정`,
  );
  await page.locator(".thumbnail-button").last().click();
  await expect(page.locator(".seed-setting")).toContainText(
    `Seed ${fixedSeed} 고정`,
  );
  await expect(page.locator("select option").first()).toHaveCSS(
    "background-color",
    "rgb(48, 50, 52)",
  );
});

test("footer progress combines a queue batch and notifications expire", async ({
  page,
}) => {
  let jobs = [
    {
      id: "progress-a",
      name: "test",
      status: "running",
      progress: 1,
      total: 4,
    },
  ];
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs } }));
  await page.goto("/");
  const bar = page.getByRole("progressbar", {
    name: "전체 이미지 생성 진행률",
  });
  await expect(bar).toHaveAttribute("aria-valuenow", "1");
  await expect(bar).toHaveAttribute("aria-valuemax", "4");
  jobs = [
    { id: "progress-a", name: "test", status: "done", progress: 4, total: 4 },
    {
      id: "progress-b",
      name: "test2",
      status: "running",
      progress: 2,
      total: 6,
    },
  ];
  await expect(bar).toHaveAttribute("aria-valuenow", "6");
  await expect(bar).toHaveAttribute("aria-valuemax", "10");
  await page
    .getByRole("button", { name: "프롬프트 미리보기", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("미리 조합");
  await expect(page.getByRole("status")).not.toContainText("미리 조합", {
    timeout: 3500,
  });
  await expect(bar).toHaveAttribute("aria-valuenow", "6");
  jobs = jobs.map((j) => ({ ...j, status: "done", progress: j.total }));
  await expect(bar).toHaveAttribute("aria-valuenow", "10");
  await expect(page.locator(".total-progress")).not.toHaveClass(/running/);
  jobs = [
    ...jobs,
    { id: "progress-c", name: "new", status: "running", progress: 0, total: 3 },
  ];
  await expect(bar).toHaveAttribute("aria-valuemax", "3");
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
});
