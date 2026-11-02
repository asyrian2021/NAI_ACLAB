import { test, expect, type Page } from "@playwright/test";

/** Queues `count` mock images through the API and waits until they exist. */
async function generate(page: Page, count: number, width = 512, height = 768) {
  return page.evaluate(
    async ({ count, width, height }) => {
      const headers = {
        "Content-Type": "application/json",
        "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
      };
      const call = async (route: string, body?: unknown) =>
        (
          await fetch("/api/" + route, {
            method: body === undefined ? "GET" : "POST",
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        ).json();
      const { state } = await call("state");
      state.categories[0].tags = ["artist:viewer_one", "artist:viewer_two"];
      state.categories[0].disabled_tags = [];
      state.generation.fixed_artists = [];
      state.generation.count = count;
      state.generation.image_size = "custom";
      Object.assign(state.api, { mock_mode: true, width, height, seed: -1 });
      const { job_id } = await call("generate", { state });
      for (let i = 0; i < 300; i++) {
        const { state: next } = await call("state");
        const run = next.history.find((h: any) => h.id === job_id);
        if (run && run.items.length >= count) return run.items as any[];
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("generation timed out");
    },
    { count, width, height },
  );
}

const stageImage = (page: Page) => page.locator(".stage img").first();
const zoomOf = (page: Page) =>
  stageImage(page).evaluate(
    (img) => new DOMMatrix(getComputedStyle(img).transform).a,
  );

test("viewer zooms at the cursor, toggles 1:1, keeps panning in bounds and blends comparisons", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await generate(page, 2);
  await page.reload();
  await expect(stageImage(page)).toBeVisible();
  await stageImage(page).evaluate((img: HTMLImageElement) => img.decode());
  const readout = page.locator(".zoom-readout");
  await expect(readout).toHaveText("100%");

  const box = (await page.locator(".stage .image-well").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1.5);
  await expect(readout).not.toHaveText("100%");

  await page.getByRole("button", { name: "화면 맞춤", exact: true }).click();
  await expect.poll(() => zoomOf(page)).toBe(1);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => zoomOf(page)).toBe(1);

  // Dragging far past the edge stops where the picture still covers the well.
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 3000,
    box.y + box.height / 2 + 3000,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  const edges = await page.evaluate(() => {
    const well = document
      .querySelector(".stage .image-well")!
      .getBoundingClientRect();
    const img = document.querySelector<HTMLImageElement>(".stage img")!;
    const rect = img.getBoundingClientRect();
    const zoom = new DOMMatrix(getComputedStyle(img).transform).a;
    const fit = Math.min(
      img.offsetWidth / img.naturalWidth,
      img.offsetHeight / img.naturalHeight,
    );
    const w = img.naturalWidth * fit * zoom;
    const h = img.naturalHeight * fit * zoom;
    const left = rect.left + (rect.width - w) / 2;
    const top = rect.top + (rect.height - h) / 2;
    return { left, top, wellLeft: well.left, wellTop: well.top, w, h, well };
  });
  expect(edges.left).toBeLessThanOrEqual(edges.wellLeft + 1);
  expect(edges.left + edges.w).toBeGreaterThanOrEqual(edges.well.right - 1);
  expect(edges.top).toBeLessThanOrEqual(edges.wellTop + 1);
  expect(edges.top + edges.h).toBeGreaterThanOrEqual(edges.well.bottom - 1);

  // Slider and overlay comparison share one well.
  await page
    .getByRole("button", { name: "기준으로 고정", exact: true })
    .click();
  await expect(page.locator(".stage .image-card")).toHaveCount(2);
  await page.getByRole("button", { name: "슬라이더", exact: true }).click();
  await expect(page.locator(".stage .image-card")).toHaveCount(1);
  const divider = page.getByRole("slider", { name: "비교 위치" });
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "55");
  // At fit size a click anywhere moves the divider (zoomed in, it pans).
  await page.getByRole("button", { name: "화면 맞춤", exact: true }).click();
  const well = (await page.locator(".blend-well").boundingBox())!;
  await page.mouse.click(well.x + well.width * 0.2, well.y + well.height / 2);
  await expect
    .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
    .toBeLessThan(25);
  await page.getByRole("button", { name: "겹쳐 보기", exact: true }).click();
  await page.getByLabel("겹침 비율").fill("80");
  await expect(page.locator(".blend-top")).toHaveCSS("opacity", "0.8");
  await page.getByRole("button", { name: "나란히", exact: true }).click();
  await expect(page.locator(".stage .image-card")).toHaveCount(2);
});

test("errors stay until dismissed or the engine reconnects; normal messages expire", async ({
  page,
}) => {
  let offline = false;
  await page.route("**/api/jobs", (route) =>
    offline ? route.abort() : route.continue(),
  );
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  offline = true;
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("엔진 연결을 확인하세요");
  await page.waitForTimeout(3600);
  await expect(banner).toBeVisible();
  offline = false;
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".status-message")).toContainText("다시 연결");
  await expect(page.locator(".status-message")).not.toContainText("다시 연결", {
    timeout: 4000,
  });

  offline = true;
  await expect(banner).toBeVisible();
  offline = false;
  await page.getByRole("button", { name: "오류 닫기" }).click();
  await expect(banner).toHaveCount(0);
});

test("new results are announced without moving the view, and pending slots show progress", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await generate(page, 1, 128, 128);
  await page.reload();
  const before = await page.locator(".image-title").textContent();
  const viewing = await page
    .locator('.thumbnail-button[aria-pressed="true"]')
    .getAttribute("aria-label");
  const fresh = await generate(page, 2, 128, 128);
  const badge = page.getByRole("button", { name: /새 이미지 2장/ });
  await expect(badge).toBeVisible();
  await expect(page.locator(".thumbnail-button.is-new")).toHaveCount(2);
  await expect(
    page.locator('.thumbnail-button[aria-pressed="true"]'),
  ).toHaveAttribute("aria-label", viewing!);
  expect(await page.locator(".image-title").textContent()).toBe(before);
  await badge.click();
  await expect(badge).toHaveCount(0);
  await expect(page.locator(".stage img").first()).toHaveAttribute(
    "src",
    fresh[1].image_url,
  );

  const jobs = [
    {
      id: "pending-run",
      name: "대기 작업",
      status: "running",
      progress: 1,
      total: 4,
    },
  ];
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs } }));
  const slots = page.locator(".generation-pending .thumbnail-placeholder");
  await expect(slots).toHaveCount(3);
  await expect(page.locator(".generation-pending")).toContainText("1/4장");
  jobs[0] = { ...jobs[0], progress: 3 };
  await expect(slots).toHaveCount(1);
});

test("deletions use undo toasts and an in-app confirmation instead of browser dialogs", async ({
  page,
}) => {
  let nativeDialogs = 0;
  page.on("dialog", (d) => {
    nativeDialogs++;
    void d.dismiss();
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await nav.getByRole("button", { name: "프롬프트", exact: true }).click();
  await page.getByRole("button", { name: "프리셋 추가", exact: true }).click();
  await page.getByLabel("프리셋 이름").fill("지울 프리셋");
  await page.getByRole("button", { name: "프리셋 삭제" }).click();
  await expect(page.getByRole("button", { name: "지울 프리셋" })).toHaveCount(
    0,
  );
  const toast = page.locator(".toast");
  await expect(toast).toContainText("“지울 프리셋” 프리셋을 삭제했습니다.");
  await toast.getByRole("button", { name: "실행 취소" }).click();
  await expect(page.getByRole("button", { name: "지울 프리셋" })).toBeVisible();
  await expect(toast).toHaveCount(0);

  await nav.getByRole("button", { name: "작가", exact: true }).click();
  const groups = page.locator(".artist-editor");
  const count = await groups.count();
  await page.getByRole("button", { name: "작가 그룹 삭제" }).last().click();
  await expect(groups).toHaveCount(count - 1);
  await page
    .locator(".toast")
    .getByRole("button", { name: "실행 취소" })
    .click();
  await expect(groups).toHaveCount(count);

  await nav.getByRole("button", { name: "작업실", exact: true }).click();
  await generate(page, 1, 64, 64);
  await page.reload();
  const filter = page.getByRole("combobox", { name: "생성 기록 선택" });
  const runId = await filter.locator("option").nth(1).getAttribute("value");
  await filter.selectOption(runId!);
  await page.getByRole("button", { name: "선택한 생성 기록 삭제" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "생성 기록을 삭제할까요?",
  });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(filter.locator(`option[value="${runId}"]`)).toHaveCount(1);
  await page.getByRole("button", { name: "선택한 생성 기록 삭제" }).click();
  await confirm.getByRole("button", { name: "기록 삭제" }).click();
  await expect(filter.locator(`option[value="${runId}"]`)).toHaveCount(0);
  expect(nativeDialogs).toBe(0);
});

test("artist rows flag engine issues, can be switched off, and accept pasted lists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "작가", exact: true }).click();
  const group = page.locator(".artist-editor").first();
  await group.getByRole("button", { name: "텍스트로 편집" }).click();
  await group.getByRole("textbox", { name: "작가 태그", exact: true }).fill("");
  await group.getByRole("button", { name: "목록으로 보기" }).click();
  const add = group.getByRole("textbox", { name: "작가 태그 추가" });
  await add.fill(
    "artist:row_a, 1.2::artist:row_b ::\nartist:row_a\nnot_an_artist",
  );
  await add.press("Enter");
  await expect(group.locator(".tag-row")).toHaveCount(3);
  await expect(group.getByRole("textbox", { name: "작가 태그 2" })).toHaveValue(
    "artist:row_b",
  );
  await expect(page.locator(".toast")).toContainText("1명은 건너뛰었습니다");
  await expect(group.locator(".tag-issue")).toHaveText(["artist: 없음"]);
  await group
    .getByRole("textbox", { name: "작가 태그 3" })
    .fill("artist:row_a");
  await expect(group.locator(".tag-issue")).toHaveText(["중복"]);
  await group.getByRole("button", { name: "작가 태그 3 삭제" }).click();
  await expect(group.locator(".tag-editor-head")).toContainText(
    "사용 2 / 등록 2명",
  );

  await group.getByRole("switch", { name: "artist:row_b 사용" }).uncheck();
  await expect(group.locator(".tag-editor-head")).toContainText(
    "사용 1 / 등록 2명",
  );
  await expect(page.locator(".save-status")).toHaveText("자동 저장됨");
  const saved = await page.evaluate(
    async () =>
      (
        await (
          await fetch("/api/state", {
            headers: {
              "X-NAI-ACLAB-Token": (window as any).__NAI_ACLAB_TOKEN__,
            },
          })
        ).json()
      ).state.categories[0],
  );
  expect(saved.tags).toEqual(["artist:row_a", "artist:row_b"]);
  expect(saved.disabled_tags).toEqual(["artist:row_b"]);
  await page.reload();
  await page.getByRole("button", { name: "작가", exact: true }).click();
  await expect(
    group.getByRole("switch", { name: "artist:row_b 사용" }),
  ).not.toBeChecked();
  await group.getByRole("button", { name: "모두 사용" }).click();
  await expect(
    group.getByRole("switch", { name: "artist:row_b 사용" }),
  ).toBeChecked();
});

test("studio shortcuts, help sheet and the weight slider", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await generate(page, 2, 64, 64);
  await page.reload();
  await expect(page.locator(".stage img").first()).toBeVisible();

  await page.keyboard.press("Shift+?");
  const help = page.getByRole("dialog", { name: "단축키 안내" });
  await expect(help).toBeVisible();
  await expect(help).toContainText("생성 대기열에 추가");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await page.keyboard.press("3");
  await expect(
    page.getByRole("button", { name: "모아보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("1");
  await expect(
    page.getByRole("button", { name: "감상", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const favorite = page.getByRole("button", { name: "즐겨찾기", exact: true });
  const wasFavorite = await favorite.getAttribute("aria-pressed");
  await page.keyboard.press("h");
  await expect(favorite).not.toHaveAttribute("aria-pressed", wasFavorite!);
  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "비교", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("=");
  await expect(page.locator(".zoom-readout")).toHaveText("125%");
  await page.keyboard.press("0");
  await expect(page.locator(".zoom-readout")).toHaveText("100%");

  let queued = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/generate")) queued++;
  });
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => queued).toBe(1);
  await expect(page.locator(".sparkle-burst")).toHaveCount(1);

  await page
    .getByRole("button", { name: "이 조합으로 이어서", exact: true })
    .click();
  const slider = page.locator(".weight-slider").first();
  await slider.fill("1.5");
  await expect(
    page.locator(".fixed-artist .weight-row input[type=number]").first(),
  ).toHaveValue("1.5");
});

test("effects play by default and are skipped when reduced motion is requested", async ({
  page,
}) => {
  const running = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .map((a) =>
          a instanceof CSSAnimation
            ? a.animationName
            : a instanceof CSSTransition
              ? "transition:" + a.transitionProperty
              : "script",
        ),
    );
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).waitFor();
  await generate(page, 1, 64, 64);
  await page.reload();
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(page.locator(".nav-indicator")).toBeVisible();

  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  expect(await running()).toContain("spark");
  await nav.getByRole("button", { name: "설정", exact: true }).click();
  expect(await running()).toContain("transition:transform");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await nav.getByRole("button", { name: "작업실", exact: true }).click();
  await page
    .getByRole("button", { name: "체험 이미지 생성", exact: true })
    .click();
  const reduced = await running();
  expect(reduced).not.toContain("spark");
  expect(reduced.filter((n) => n !== "spin")).toEqual([]);
});
