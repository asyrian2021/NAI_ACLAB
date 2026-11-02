import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Reference screenshots of every menu, taken from fixed mock data.
 *
 * - Visual regression: each screen is compared with tests/ui/__screenshots__.
 *   Refresh the baselines on purpose with `npm run test:screens:update`.
 * - Docs: updating the baselines also rewrites docs/screenshots/v2/*.png,
 *   so the README images always match the current UI.
 *
 * Timestamps and file names change on every run, so they are masked in the
 * comparison (but not in the docs images).
 */

const docsDir = path.resolve("docs", "screenshots", "v2");

async function seedFixedData(page: Page) {
  await page.evaluate(async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
    };
    const call = async (route: string, body?: unknown) => {
      const r = await fetch("/api/" + route, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${route}: HTTP ${r.status}`);
      return r.json();
    };
    const waitFor = async (jobId: string, count: number) => {
      for (let i = 0; i < 200; i++) {
        const { state: next } = await call("state");
        const run = next.history.find((h: any) => h.id === jobId);
        if (run && run.items.length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Generation timed out: " + jobId);
    };

    let { state } = await call("state");
    const ids = state.history.map((h: any) => h.id);
    if (ids.length) await call("history/delete", { ids });
    ({ state } = await call("state"));

    // One artist with a fixed weight keeps the prompt, and therefore the
    // deterministic mock image, identical on every run.
    state.quality_prompt = "masterpiece, best quality";
    state.negative_prompt = "lowres, bad anatomy";
    state.categories = [
      {
        ...state.categories[0],
        name: "메인 작가",
        tags: ["artist:sample_painter"],
        min_weight: 1,
        max_weight: 1,
        all_artists: true,
      },
    ];
    const base = state.prompt_presets[0];
    state.prompt_presets = [
      {
        ...base,
        name: "해변 산책",
        base_prompt: "beach, sunset, walking",
        characters: [{ prompt: "1girl, sundress", negative: "" }],
      },
      {
        ...base,
        name: "도서관",
        base_prompt: "library, bookshelf, indoors",
        characters: [{ prompt: "1boy, glasses", negative: "" }],
      },
    ];
    state.batting_scenes = state.prompt_presets.map((p: any) => ({
      name: "",
      preset: p.name,
      image_size: "portrait",
      count: 1,
    }));
    state.generation.preset = "해변 산책";
    state.generation.fixed_artists = [];
    state.generation.count = 3;
    state.generation.image_size = "custom";
    Object.assign(state.api, {
      mock_mode: true,
      width: 256,
      height: 384,
      seed: 1234,
    });
    ({ state } = await call("state", { state }));

    const studio = await call("generate", { state });
    await waitFor(studio.job_id, 3);
    const batting = await call("batting/generate", { state });
    await waitFor(batting.job_id, 2);
  });
}

async function settle(page: Page) {
  await expect(page.locator(".statusbar .status-message")).toContainText(
    "준비됨",
    {
      timeout: 15000,
    },
  );
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    );
  });
}

async function capture(page: Page, name: string, mask: Locator[] = []) {
  await settle(page);
  const updating = ["all", "changed"].includes(
    test.info().config.updateSnapshots,
  );
  if (updating)
    await page.screenshot({ path: path.join(docsDir, `${name}.png`) });
  await expect(page).toHaveScreenshot(`${name}.png`, {
    mask,
    animations: "disabled",
    caret: "hide",
  });
}

test("reference screenshots of every menu", async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await nav.waitFor();
  await seedFixedData(page);
  await page.reload();
  await nav.waitFor();

  const timestamps = [
    page.locator(".generation-group-heading span"),
    page.locator(".image-card figcaption"),
    page.locator(".sweep-source-group time"),
    page.locator(".batting-results-heading select"),
  ];

  // "생성 1" is the studio run; "생성 2" is the batting run queued after it.
  await page
    .getByRole("button", { name: "생성 1 이미지 1 선택", exact: true })
    .click();
  await capture(page, "01-studio", timestamps);

  await page
    .getByRole("button", { name: "기준으로 고정", exact: true })
    .click();
  await capture(page, "02-studio-compare", timestamps);
  await page.getByRole("button", { name: "슬라이더", exact: true }).click();
  await capture(page, "02b-studio-slider", timestamps);
  await page.getByRole("button", { name: "나란히", exact: true }).click();
  await page.getByRole("button", { name: "감상", exact: true }).click();
  await page.getByRole("button", { name: "단축키 안내", exact: true }).click();
  await capture(page, "02c-shortcuts", timestamps);
  await page.getByRole("button", { name: "단축키 안내 닫기" }).click();

  await nav.getByRole("button", { name: "프롬프트", exact: true }).click();
  await capture(page, "03-presets");

  await nav.getByRole("button", { name: "작가", exact: true }).click();
  await capture(page, "04-artists");

  await nav.getByRole("button", { name: "타율 테스트", exact: true }).click();
  await capture(page, "05-batting", timestamps);

  await nav
    .getByRole("button", { name: "가이던스 테스트", exact: true })
    .click();
  await page
    .getByRole("button", { name: "원본 이미지 1 선택", exact: true })
    .click();
  await capture(page, "06-guidance", timestamps);

  await nav.getByRole("button", { name: "설정", exact: true }).click();
  await capture(page, "07-settings");
});
