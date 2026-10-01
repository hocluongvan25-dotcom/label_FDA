import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const firstReview = "/reviews/30000000-0000-4000-8000-000000000001";
async function ready(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".app-shell")).toBeVisible();
}
async function persona(page: Page, name: string) {
  await ready(page, "/settings");
  await page.locator(".role-button").filter({ hasText: name }).click();
  await expect(page.locator(".role-button.active")).toContainText(name);
}

test("dashboard, guides, mobile navigation and readable overflow-free layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(
    page.getByRole("heading", {
      name: "Rà soát nhãn, rõ từng bước.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Hồ sơ sản phẩm", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/vexim-dashboard.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await ready(page, "/settings");
  await page.getByRole("button", { name: /Xem quy trình sử dụng/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/products");
  await page.getByRole("button", { name: "Mở menu" }).click();
  await expect(page.locator(".sidebar.sidebar-open")).toBeVisible();
  await page.getByRole("link", { name: "Tổng quan", exact: true }).click();
  await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
  await ready(page, "/products");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/vexim-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("reviewer reasons, region selection, manual evidence, version comparison and requests", async ({
  page,
}) => {
  await ready(page, firstReview);
  await expect(
    page.getByRole("heading", { name: "Trà sen túi lọc", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Xác nhận", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Lý do / ghi chú chuyên viên")
    .fill("Đối chiếu bản gốc: cần chuyên gia xác nhận medical claim.");
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    page.getByText("Đã xác nhận finding.", { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chọn vùng evidence" }).click();
  await expect(page.locator(".label-image-wrap img")).toBeVisible();
  const image = await page.locator(".label-image-wrap").boundingBox();
  const viewport = await page.locator(".label-canvas").boundingBox();
  if (!image || !viewport) throw new Error("Missing label view");
  const x = Math.max(image.x + image.width * 0.15, viewport.x + 10);
  const y = Math.max(image.y + image.height * 0.15, viewport.y + 20);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 65, { steps: 8 });
  await page.mouse.up();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal
    .getByLabel("Tiêu đề finding")
    .fill("Vùng nhãn cần đối chiếu thủ công");
  await modal.getByLabel("Mức độ").selectOption("minor");
  await modal
    .getByLabel("Mô tả rủi ro")
    .fill("Chuyên viên chọn vùng trên bản gốc để kiểm tra lại độ rõ của chữ.");
  await modal.getByLabel("Evidence — nguyên văn trên nhãn").fill("AN NHIEN");
  await modal
    .getByLabel("Hành động đề xuất")
    .fill("Đối chiếu file độ phân giải cao trước khi chốt báo cáo.");
  await modal
    .getByRole("button", { name: "Thêm finding", exact: true })
    .click();
  await expect(modal).not.toBeVisible();
  await expect(
    page.getByText("Vùng nhãn cần đối chiếu thủ công", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/vexim-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /So sánh/ }).click();
  await expect(
    page.getByRole("dialog", { name: "So sánh hai phiên bản nhãn" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Yêu cầu bổ sung" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("customer draft autosave, upload versions and tenant-scoped read-only reviewer UI", async ({
  page,
}) => {
  await persona(page, "Minh Anh");
  await ready(page, "/products/new");
  await page
    .getByLabel("Tên sản phẩm", { exact: true })
    .fill("UI QA Green Tea");
  await page.getByLabel("Thương hiệu", { exact: true }).fill("QA TEA");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some(
          (k) =>
            k.startsWith("vexim-intake:") &&
            localStorage.getItem(k)?.includes("UI QA Green Tea"),
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("Tên sản phẩm", { exact: true })).toHaveValue(
    "UI QA Green Tea",
  );

  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "UI QA Green Tea", exact: true }),
  ).toBeVisible();
  await ready(page, "/products/d0000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Tải nhãn mới" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  const bytes = await sharp(await readFile("public/samples/lotus-front-v2.svg"))
    .png()
    .toBuffer();
  await modal.getByLabel("Chọn file nhãn").setInputFiles({
    name: "ui-qa-label.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await modal.getByRole("checkbox").check();
  await modal.getByRole("button", { name: "Tải lên và rà soát" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText(/v3/).first()).toBeVisible();
  await ready(page, firstReview);
  await expect(
    page.getByRole("button", { name: "Xác nhận", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Chọn vùng evidence" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Nguồn pháp lý", exact: true }),
  ).toHaveCount(0);
});

test("human approval creates immutable report and downloads JSON with disclaimer", async ({
  page,
}) => {
  await ready(page, firstReview);
  const total = await page.locator(".finding-list-item.open").count();
  for (let i = 0; i < total; i++) {
    await page
      .locator(".finding-list-item")
      .filter({ hasText: "Chưa xử lý" })
      .first()
      .click();
    await page
      .getByLabel("Lý do / ghi chú chuyên viên")
      .fill(
        "Đã đối chiếu evidence gốc. Giữ finding và yêu cầu chỉnh sửa; không khẳng định nhãn đạt FDA.",
      );
    await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
    await expect(page.locator(".finding-list-item.open")).toHaveCount(
      total - 1 - i,
    );
  }
  await page.getByRole("button", { name: /duyệt báo cáo/i }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal
    .getByLabel("Ghi chú phê duyệt")
    .fill(
      "Rà soát sơ bộ trong phạm vi trà khô. Cần sửa medical claim và bổ sung hồ sơ; không thay thế tư vấn pháp lý.",
    );
  await modal.getByRole("checkbox").check();
  await modal.getByRole("button", { name: "Duyệt & tạo báo cáo" }).click();
  await expect(page).toHaveURL(/\/reports\?report=/);
  await expect(
    page.getByRole("heading", { name: "Báo cáo rà soát", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/vexim-report.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải JSON", exact: true }).click();
  const download = await downloadPromise;
  const file = await download.path();
  if (!file) throw new Error("No download");
  const report = JSON.parse(await readFile(file, "utf8"));
  expect(report.disclaimer).toContain("FDA");
  expect(report.reviewer.id).toBeTruthy();
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải báo cáo PDF" }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = await pdfDownload.path();
  expect((await readFile(pdfPath!)).subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    report.findings.every((f: { status: string }) => f.status !== "open"),
  ).toBe(true);
});

test("regulatory source changes require independent approval and preserve version history", async ({
  page,
}) => {
  await persona(page, "Hà Trần");
  await ready(page, "/sources");
  const citation = (await page
    .locator(".source-row-title")
    .first()
    .textContent())!.trim();
  await page.locator(".source-row-title").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tạo bản draft mới" })
    .click();
  const editor = page.getByRole("dialog", { name: "Draft nguồn tham chiếu" });
  await editor
    .getByLabel("Snapshot / trích đoạn nguồn đã đối chiếu")
    .fill(
      "Nội dung fixture DEMO cho kiểm thử giao diện đăng ký và duyệt nguồn độc lập. Không phải trích đoạn luật thực, không sử dụng cho hồ sơ hoặc kết luận pháp lý production.",
    );
  await editor.getByRole("button", { name: "Lưu draft nguồn" }).click();
  await expect(editor).not.toBeVisible();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("DRAFT", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Phê duyệt nguồn" }).click();
  const approval = page.getByRole("dialog", { name: "Xác nhận nguồn pháp lý" });
  await approval.getByRole("checkbox").check();
  await approval.getByRole("button", { name: "Phê duyệt snapshot" }).click();
  await expect(approval).toBeVisible();
  await expect(
    page.locator("tbody tr").filter({ hasText: citation }).first(),
  ).toContainText("Chờ phê duyệt");
  await approval.getByRole("button", { name: "Hủy", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng", exact: true })
    .first()
    .click();
  await persona(page, "Minh Phạm");
  await ready(page, "/sources");
  await page.getByRole("button", { name: citation, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Phê duyệt nguồn" })
    .click();
  await approval.getByRole("checkbox").check();
  await approval.getByRole("button", { name: "Phê duyệt snapshot" }).click();
  await expect(approval).not.toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("CURRENT", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("v2", { exact: true }),
  ).toBeVisible();
});
