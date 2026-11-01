import { test, expect } from "@playwright/test";

test("queue auto-hides during generation, bounds completed rows, and image shortcuts prepare tests", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  const source = await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const { state } = await (await fetch("/api/state", { headers })).json();
    state.categories[0].tags = ["artist:shortcut_one", "artist:shortcut_two"];
    state.generation.fixed_artists = [];
    state.generation.count = 1;
    state.generation.image_size = "custom";
    Object.assign(state.api, {
      mock_mode: true,
      width: 64,
      height: 64,
      seed: 987654,
    });
    const { job_id } = await (
      await fetch("/api/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ state }),
      })
    ).json();
    for (let i = 0; i < 100; i++) {
      const { state: next } = await (
        await fetch("/api/state", { headers })
      ).json();
      const item = next.history.find((h: any) => h.id === job_id)?.items[0];
      if (item) return item;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Source image was not generated");
  });
  const finished = Array.from({ length: 20 }, (_, i) => ({
    id: "finished-" + i,
    name: "finished " + i,
    status: i === 0 ? "failed" : "done",
    progress: 1,
    total: 1,
  }));
  const jobs = [
    ...finished,
    {
      id: "slow-active",
      name: "long running",
      status: "running",
      progress: 2,
      total: 10,
    },
  ];
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs } }));
  await page.reload();
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  await expect(page.locator(".queue-panel")).toBeVisible();
  await expect(page.locator(".queue-panel .job")).toHaveCount(6);
  await expect(page.locator(".queue-panel")).toContainText("finished 19");
  await expect(page.locator(".queue-panel")).not.toContainText("finished 14");
  await expect(page.locator(".queue-panel")).toHaveCount(0, { timeout: 3500 });
  await expect(
    page.getByRole("button", { name: "대기열 1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".total-progress")).toHaveClass(/running/);
  await page.getByRole("button", { name: "대기열 1", exact: true }).click();
  await expect(page.locator(".queue-panel .job")).toHaveCount(6);
  await expect(page.locator(".queue-panel")).toHaveCount(0, { timeout: 3500 });
  let startedTests = 0;
  page.on("request", (r) => {
    if (/\/api\/(guidance|batting)\/generate$/.test(r.url())) startedTests++;
  });
  await page
    .locator(".right-panel")
    .getByRole("button", { name: "타율 테스트", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "주 메뉴" }).locator("button.active"),
  ).toHaveText("타율 테스트");
  await expect(
    page.getByText(`고정 조합 ${source.artists.length}명 사용`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  const fixed = await page.evaluate(
    async () =>
      (
        await (
          await fetch("/api/state", {
            headers: {
              "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
            },
          })
        ).json()
      ).state.generation.fixed_artists,
  );
  expect(fixed).toEqual(source.artists);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "작업실", exact: true })
    .click();
  await page
    .locator(".right-panel")
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "주 메뉴" }).locator("button.active"),
  ).toHaveText("가이던스 테스트");
  await expect(page.locator(".sweep-selected-preview img")).toHaveAttribute(
    "src",
    source.image_url,
  );
  const preview = await page
    .locator(".sweep-selected-preview img")
    .boundingBox();
  expect(preview!.height).toBeGreaterThanOrEqual(380);
  expect(preview!.width).toBeGreaterThanOrEqual(300);
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  const next = await page.evaluate(
    async () =>
      (
        await (
          await fetch("/api/state", {
            headers: {
              "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
            },
          })
        ).json()
      ).state,
  );
  expect(next.guidance_test.source_path).toBe(source.path);
  expect(next.api.seed).toBe(source.seed);
  expect(startedTests).toBe(0);
  await page.screenshot({
    path: "test-results/studio-test-shortcuts-preview.png",
    fullPage: true,
  });
});
