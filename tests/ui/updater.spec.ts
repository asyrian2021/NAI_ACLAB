import { test, expect } from "@playwright/test";

test("startup update notice persists, waits for generation and supports download retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.updateCalls = [];
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        w.updateCalls.push(command);
        if (command === "check_update")
          return {
            current: "2.1.1",
            version: "2.1.2",
            notes: "Test release notes",
          };
        if (command === "install_update") {
          args.progress.onmessage({ downloaded: 50, total: 100 });
          await new Promise((r) => setTimeout(r, 300));
          throw new Error("signature verification failed");
        }
      },
    };
  });
  let running = true;
  await page.route("**/api/jobs", (route) =>
    route.fulfill({
      json: {
        jobs: running
          ? [
              {
                id: "updater-test",
                name: "test",
                status: "running",
                progress: 0,
                total: 5,
              },
            ]
          : [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "새 버전 2.1.2" }).click();
  const dialog = page.getByRole("dialog", { name: "앱 업데이트" });
  await expect(dialog).toContainText("Test release notes");
  await expect(
    dialog.getByRole("button", { name: "지금 업데이트", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(3200);
  await expect(dialog).toBeVisible();
  running = false;
  await expect(
    dialog.getByRole("button", { name: "지금 업데이트", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "지금 업데이트", exact: true })
    .click();
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("value", "50");
  await expect(dialog).toContainText("signature verification failed");
  await expect(
    dialog.getByRole("button", { name: "지금 업데이트", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "업데이트 창 닫기" }).click();
  await expect(
    page.getByRole("button", { name: "새 버전 2.1.2" }),
  ).toBeVisible();
});

test("offline update check can retry without blocking the studio", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    let calls = 0;
    w.__TAURI_INTERNALS__ = {
      invoke: async () => {
        if (++calls <= 2) throw new Error("offline");
        return { current: "2.1.1" };
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "v2.1.1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "앱 업데이트" });
  await expect(dialog).toContainText("업데이트를 확인하지 못했습니다");
  await dialog.getByRole("button", { name: "업데이트 다시 확인" }).click();
  await expect(dialog).toContainText("최신 버전을 사용하고 있습니다");
  await dialog.getByRole("button", { name: "업데이트 창 닫기" }).click();
  await expect(
    page.getByRole("button", { name: "체험 이미지 생성", exact: true }),
  ).toBeEnabled();
});
