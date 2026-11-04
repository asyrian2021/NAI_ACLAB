import { test, expect } from "@playwright/test";

test("combination search runs from evolution through a round to a fixed combination", async ({
  page,
}) => {
  // Pick stages render full-size mock images at the campaign's image size.
  test.setTimeout(120000);
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
    const tags = (p: string, n: number) =>
      Array.from({ length: n }, (_, i) => `artist:${p}${i}`);
    state.categories = [
      {
        name: "탐색 메인",
        tags: tags("main", 10),
        min_weight: 1,
        max_weight: 1.3,
        granule: 0.05,
        picks: 0,
        min_picks: 2,
        max_picks: 3,
        all_artists: false,
        disabled_tags: [],
      },
      {
        name: "색감",
        tags: tags("color", 4),
        min_weight: 0.6,
        max_weight: 0.8,
        granule: 0.1,
        picks: 0,
        min_picks: 1,
        max_picks: 1,
        all_artists: false,
        disabled_tags: [],
      },
      {
        name: "탐색 신체",
        tags: tags("body", 6),
        min_weight: 0.5,
        max_weight: 0.8,
        granule: 0.1,
        picks: 0,
        min_picks: 1,
        max_picks: 2,
        all_artists: false,
        disabled_tags: [],
      },
    ];
    state.batting_scenes = [
      {
        name: "",
        preset: state.generation.preset,
        image_size: "custom",
        count: 1,
        tags: ["feet"],
      },
    ];
    state.api.mock_mode = true;
    state.api.seed = -1;
    state.api.width = 64;
    state.api.height = 96;
    state.generation.image_size = "custom";
    state.generation.fixed_artists = [];
    await fetch("/api/state", {
      method: "POST",
      headers,
      body: JSON.stringify({ state }),
    });
  });
  await page.reload();
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await nav.getByRole("button", { name: "탐색", exact: true }).click();
  await page.getByRole("button", { name: "새 캠페인", exact: true }).click();
  await page.getByPlaceholder("예: 수채화 톤 찾기").fill("e2e 탐색");
  // Groups start in the artist menu's order; modes are guessed from the names.
  await expect(page.locator(".plan-group strong")).toHaveText([
    "탐색 메인",
    "색감",
    "탐색 신체",
  ]);
  await expect(page.getByLabel("탐색 메인 탐색 방식")).toHaveValue("pick");
  await expect(page.getByLabel("탐색 신체 탐색 방식")).toHaveValue("rate");
  await expect(page.getByLabel("색감 탐색 방식")).toHaveValue("fixed");
  await expect(page.locator(".plan-preview")).toHaveText(
    "1단계 탐색 메인 고르기 → 2단계 탐색 신체 타율 → 재조정 탐색 메인 → 최종 확인",
  );
  await expect(page.getByLabel("색감 1번 작가")).toBeVisible();
  await expect(page.getByLabel("탐색 신체 1번 작가")).toBeVisible();
  // Preset and image size start unselected and must be chosen before starting.
  const startButton = page.getByRole("button", {
    name: "시작하고 첫 단계 생성",
  });
  const presetSelect = page.getByLabel("고르기 단계 프리셋");
  const sizeSelect = page.getByLabel("고르기 단계 이미지 크기");
  await expect(presetSelect).toHaveValue("");
  await expect(sizeSelect).toHaveValue("");
  await expect(startButton).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "고르기 단계의" }),
  ).toHaveText("고르기 단계의 프리셋과 이미지 크기를 선택하세요.");
  await presetSelect.selectOption({ index: 1 });
  await expect(startButton).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "고르기 단계의" }),
  ).toHaveText("고르기 단계의 이미지 크기를 선택하세요.");
  await sizeSelect.selectOption("portrait");
  await expect(startButton).toBeEnabled();
  await startButton.click();

  const cells = page.locator(".evolve-cell img");
  await expect(cells).toHaveCount(12, { timeout: 30000 });
  await expect(page.locator(".evolve-status strong")).toHaveText("0세대");
  // Keyboard only: pick 1st and 2nd, Enter saves and generates the next generation.
  await page.keyboard.press("2");
  await page.keyboard.press("5");
  await expect(page.locator(".rank-badge")).toHaveText(["1등", "2등"]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".evolve-status strong")).toHaveText("1세대");
  await expect(cells).toHaveCount(12, { timeout: 30000 });
  await expect(page.locator(".evolve-head .origin")).toHaveText([
    "엘리트",
    "엘리트",
    "교차",
    "변이",
    "변이",
    "랜덤",
  ]);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.locator(".evolve-status strong")).toHaveText("2세대");
  await expect(cells).toHaveCount(12, { timeout: 30000 });

  // The campaign and its pick history survive a reload.
  await page.reload();
  await nav.getByRole("button", { name: "탐색", exact: true }).click();
  await page.getByRole("button", { name: /e2e 탐색/ }).click();
  await expect(page.locator(".evolve-status strong")).toHaveText("2세대");
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "1단계 완료" }).click();
  await page.getByRole("button", { name: "이 조합으로 확정" }).click();
  // Only one scene exists, so the rate stage asks before starting.
  await expect(
    page.getByRole("alertdialog", { name: "검증할 장면이 부족합니다" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "그래도 진행" }).click();

  // Stage 2 round 1: 8 candidates × 1 scene × 2 seeds.
  await page.getByRole("button", { name: "16장 생성" }).click();
  await expect(page.locator(".round-cell img")).toHaveCount(16, {
    timeout: 30000,
  });
  await page.keyboard.press("1");
  await expect(page.locator(".round-cell.failed")).toHaveCount(1);
  await expect(page.locator(".candidate-rate").first()).toHaveText(
    /성공 1\/2 · 50%/,
  );
  // Browser focus follows the highlight, so a clicked cell or button does not
  // keep a second focus ring while the arrow keys move on.
  const focusIsOnHighlight = () =>
    page.evaluate(
      () =>
        document.activeElement?.classList.contains("round-cell") &&
        document.activeElement.classList.contains("focused"),
    );
  await page.locator(".round-cell").nth(3).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".round-cell.focused")).toHaveAttribute(
    "aria-label",
    /^후보 C · .* · 시드 1$/,
  );
  expect(await focusIsOnHighlight()).toBe(true);
  const firstLabel = page
    .getByRole("group", { name: "실패 라벨" })
    .getByRole("button")
    .first();
  await firstLabel.click();
  await firstLabel.click();
  await page.keyboard.press("ArrowRight");
  expect(await focusIsOnHighlight()).toBe(true);
  await expect(page.locator(".round-cell:focus")).toHaveCount(1);
  await page.getByRole("button", { name: "라운드 마감" }).click();
  await expect(page.locator(".evolve-status strong")).toHaveText("R2 / 3");
  // A candidate can be confirmed mid-way, without running the remaining rounds.
  await expect(page.locator(".candidate-confirm")).toHaveCount(4);
  await page.locator(".candidate-confirm").first().click();
  const early = page.getByRole("alertdialog", { name: /로 확정할까요\?$/ });
  await expect(early).toContainText("남은 라운드를 건너뛰고");
  await early.getByRole("button", { name: "이 후보로 확정" }).click();

  // Stage 4 retune starts in convergence mode; keep the main group as it is.
  await expect(page.locator(".evolve-status")).toContainText("수렴 모드");
  await page.getByRole("button", { name: "재조정 완료" }).click();
  await page.getByText("기존 탐색 메인 조합 그대로 두기").click();
  await page.getByRole("button", { name: "기존 조합으로 넘어가기" }).click();
  await page.getByRole("button", { name: "4장 생성" }).click();
  await expect(page.locator(".round-cell img")).toHaveCount(4, {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "확인 완료" }).click();

  await expect(page.getByRole("region", { name: "최종 조합" })).toContainText(
    "성공 4/4",
  );
  await page.getByRole("button", { name: "고정 조합으로 적용" }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const headers = {
          "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
        };
        const { state } = await (await fetch("/api/state", { headers })).json();
        return state.generation.fixed_artists.map((a: any) => a.category);
      }),
    )
    .toEqual(expect.arrayContaining(["탐색 메인", "색감", "탐색 신체"]));

  // The rate stage opens again where it was left (R2), dropping the later stages.
  await page
    .getByRole("region", { name: "단계별 우승" })
    .getByRole("button", { name: "2단계 · 탐색 신체 타율로 돌아가기" })
    .click();
  const reopen = page.getByRole("alertdialog", {
    name: "2단계 · 탐색 신체 타율로 돌아갈까요?",
  });
  await expect(reopen).toContainText("재조정 · 탐색 메인, 최종 확인");
  await reopen.getByRole("button", { name: "이 단계로 돌아가기" }).click();
  await expect(page.locator(".evolve-status strong")).toHaveText("R2 / 3");
  await expect(page.locator(".explore-steps li.current")).toHaveText(
    "2단계 탐색 신체",
  );
  await expect(
    page.getByRole("button", { name: "1단계 · 탐색 메인 고르기로 돌아가기" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "16장 생성" })).toBeVisible();
  expect(errors).toEqual([]);

  // Later specs count studio thumbnails (capped at 60), so remove this run's images and campaign.
  await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const get = async (route: string) =>
      (await fetch("/api/" + route, { headers })).json();
    const post = (route: string, body: unknown) =>
      fetch("/api/" + route, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const { state } = await get("state");
    const ids = state.history
      .filter((h: any) => h.type === "explore")
      .map((h: any) => h.id);
    await post("history/delete", { ids });
    for (const c of (await get("explore")).campaigns)
      await post("explore/delete", { id: c.id });
    state.generation.fixed_artists = [];
    await post("state", { state });
  });
});
