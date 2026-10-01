import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator(".app-shell")).toBeVisible();
}
async function persona(page: Page, name: string) {
  await ready(page, "/settings");
  await page.locator(".role-button").filter({ hasText: name }).click();
  await expect(page.locator(".role-button.active")).toContainText(name);
}
test("API knowledge demo: DRAFT exclusion, private synthetic raw, independent activation, citations and FR tasks", async ({
  page,
}) => {
  const errors: string[] = [];
  const upstream: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/https:\/\/www\.(ecfr|federalregister)\.gov/.test(r.url()))
      upstream.push(r.url());
  });
  await persona(page, "Hà Trần");
  await ready(page, "/knowledge");
  await expect(
    page.getByRole("heading", { name: "Kho tri thức pháp quy", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Đang mô phỏng trên trình duyệt/)).toBeVisible();
  await page
    .getByRole("button", { name: "Chạy đồng bộ mô phỏng", exact: true })
    .click();
  await expect(page.locator(".knowledge-snapshot")).toHaveCount(1);
  await expect(page.locator(".knowledge-snapshot").first()).toContainText(
    "Bản nháp",
  );
  await page
    .getByRole("button", { name: "Truy xuất có citation", exact: true })
    .click();
  await page.getByLabel("Review as-of").fill("2026-09-25");
  await page
    .getByRole("button", { name: "Truy xuất nguồn đã active", exact: true })
    .click();
  await expect(
    page.getByText(/Không có nguồn ACTIVE khớp phạm vi/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Snapshots & phiên bản", exact: true })
    .click();
  await page.locator(".knowledge-snapshot").first().click();
  let modal = page.getByRole("dialog");
  await expect(
    modal.getByText("MÔ PHỎNG · KHÔNG PHẢI NGUỒN THẬT", { exact: true }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await modal
    .getByRole("button", { name: "Raw snapshot DEMO", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(
    "DEMO-not-a-government-snapshot.txt",
  );
  const path = await download.path();
  if (!path) throw new Error("Missing synthetic raw download");
  expect(await readFile(path, "utf8")).toContain("DEMO ONLY");
  for (const check of await modal.getByRole("checkbox").all())
    await check.check();
  await modal.getByLabel("Phân loại thay đổi").selectOption("text_only");
  await modal
    .getByRole("button", { name: "Lưu checklist / gửi duyệt", exact: true })
    .click();
  await expect(
    modal.getByText("Chờ duyệt độc lập", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Phê duyệt & kích hoạt", exact: true }),
  ).toBeDisabled();
  await modal
    .getByRole("button", { name: "Đóng", exact: true })
    .first()
    .click();
  await persona(page, "Minh Phạm");
  await ready(page, "/knowledge");
  await page.locator(".knowledge-snapshot").first().click();
  modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Phê duyệt & kích hoạt", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Xác nhận phê duyệt độc lập", exact: true })
    .click();
  await expect(modal.getByText("Đang sử dụng", { exact: true })).toBeVisible();
  await modal
    .getByRole("button", { name: "Đóng", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Truy xuất có citation", exact: true })
    .click();
  await page.getByLabel("Review as-of").fill("2026-09-25");
  await page
    .getByRole("button", { name: "Truy xuất nguồn đã active", exact: true })
    .click();
  await expect(page.locator(".knowledge-citations article")).toHaveCount(1);
  await expect(page.locator(".knowledge-citations article")).toContainText(
    "21 CFR 101.9",
  );
  await expect(page.locator(".knowledge-citations article")).toContainText(
    "DEMO ONLY",
  );
  await page.getByLabel("Nguồn / công việc").selectOption("fr_monitor");
  await page.getByLabel("Từ ngày xuất bản").fill("2026-09-20");
  await page.getByLabel("Đến ngày").fill("2026-09-25");
  await page
    .getByRole("button", { name: "Chạy đồng bộ mô phỏng", exact: true })
    .click();
  await expect(page.locator(".knowledge-alert")).toHaveCount(1);
  await expect(page.locator(".knowledge-alert")).toContainText(
    "Không có rules nào thay đổi",
  );
  await page
    .locator(".knowledge-alert")
    .getByRole("button", { name: "Xem snapshot / tác vụ", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(/Tác vụ monitor-only/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Phê duyệt & kích hoạt", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Snapshots & phiên bản", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/vexim-knowledge.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/knowledge");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/vexim-knowledge-mobile.png",
    fullPage: true,
  });
  await persona(page, "Minh Anh");
  await ready(page, "/knowledge");
  await expect(
    page.getByRole("heading", {
      name: "Kho tri thức dành cho nhân sự Vexim",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Chạy đồng bộ mô phỏng", exact: true }),
  ).toHaveCount(0);
  expect(upstream).toEqual([]);
  expect(errors).toEqual([]);
});
