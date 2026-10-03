import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const firstReview = "/reviews/30000000-0000-4000-8000-000000000001";
async function ready(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 45_000 });
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

test("review comparison shows 15 DRAFT prompts, no OCR, and expert-gated paragraph warnings", async ({
  page,
}) => {
  await ready(page, firstReview);
  await expect(page.getByTestId("review-comparison-board")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Artwork / nhãn gốc", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "OCR chưa chạy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Rule Pack · 15/15", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("review-rule-row")).toHaveCount(15);
  await expect(
    page.getByTestId("review-rule-row").filter({ hasText: "DEMO · DRAFT" }),
  ).toHaveCount(15);
  await expect(
    page.getByTestId("review-rule-row").filter({ hasText: "Regression: pending" }),
  ).toHaveCount(15);
  await expect(page.getByTestId("ocr-low-confidence-field")).toHaveCount(0);
  await expect(page.locator(".review-ocr-warning")).toHaveCount(0);
  await expect(page.getByTestId("review-comparison-board")).toContainText(
    "không có OCR hoặc triage",
  );

  await page.evaluate((reviewId) => {
    const storageKey = "vexim-workspace-v3";
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    const review = saved?.data?.reviews?.find(
      (item: { id: string }) => item.id === reviewId,
    );
    if (!review) throw new Error("Synthetic review fixture was not loaded");
    review.triage_route = "EXPERT_REVIEW_REQUIRED";
    review.triage_evaluated_at = new Date().toISOString();
    review.triage_policy_version = "synthetic-e2e-fixture";
    review.report_status = "BLOCKED";
    review.expert_review_status = "PENDING";
    review.triage_reasons = [
      {
        gate: "BLOCKED_REGULATORY_SOURCE",
        code: "UNRESOLVED_REGULATORY_CITATION",
        message:
          "Citation syntax may be valid, but one or more paragraph paths remain unresolved; expert review is required and automatic issuance is blocked.",
        rule_key: "CLAIM-001",
      },
    ];
    localStorage.setItem(storageKey, JSON.stringify(saved));
  }, "30000000-0000-4000-8000-000000000001");
  await page.reload();
  const paragraphBadge = page.getByText(
    "Paragraph paths · EXPERT REVIEW REQUIRED",
    { exact: true },
  );
  await expect(paragraphBadge).toBeVisible();
  await expect(paragraphBadge).toHaveClass(/badge-red/);
  await expect(page.getByTestId("review-comparison-board")).toContainText(
    "SYNTHETIC DEMO DATA",
  );

  await page.getByRole("button", { name: "Extraction" }).click();
  const extraction = page.getByRole("dialog");
  await expect(extraction).toContainText("Không có OCR output");
  await expect(extraction.locator(".field-list-item")).toHaveCount(0);
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
  const recordedDisposition = page.getByTestId("finding-disposition");
  await expect(recordedDisposition).toContainText("Disposition");
  await expect(recordedDisposition).toContainText("Đã xác nhận");
  await expect(recordedDisposition).toContainText("Linh Nguyễn");
  await expect(recordedDisposition).toContainText(
    "Đối chiếu bản gốc: cần chuyên gia xác nhận medical claim.",
  );
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
  await ready(page, "/products/d0000000-0000-4000-8000-000000000005");
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
  await expect(page.getByText(/v2/).first()).toBeVisible();
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

test("the DRAFT-only tea review stays unsigned and has no generated artifacts", async ({
  page,
}) => {
  await ready(page, firstReview);
  await expect(page.locator(".finding-list-item.open")).toHaveCount(15);
  await expect(page.getByTestId("review-rule-row")).toHaveCount(15);
  await expect(
    page.getByTestId("review-rule-row").filter({ hasText: "DEMO · DRAFT" }),
  ).toHaveCount(15);
  await expect(
    page.getByRole("button", { name: "Phê duyệt báo cáo", exact: true }),
  ).toHaveCount(0);

  const fixture = await page.evaluate((reviewId) => {
    const saved = JSON.parse(
      localStorage.getItem("vexim-workspace-v3") ?? "null",
    );
    const data = saved?.data;
    const review = data?.reviews?.find(
      (item: { id: string }) => item.id === reviewId,
    );
    return {
      review,
      findings: data?.findings?.filter(
        (item: { review_id: string }) => item.review_id === reviewId,
      ),
      reports: data?.reports?.filter(
        (item: { review_id: string }) => item.review_id === reviewId,
      ).length,
      preScreeningReports: data?.preScreeningReports?.filter(
        (item: { review_id: string }) => item.review_id === reviewId,
      ).length ?? 0,
      rules: data?.rules?.map((item: { status: string }) => item.status),
      sources: data?.sources?.map((item: { status: string }) => item.status),
    };
  }, "30000000-0000-4000-8000-000000000001");
  expect(fixture.review.status).toBe("HUMAN_REVIEW");
  expect(fixture.review.triage_evaluated_at).toBeNull();
  expect(fixture.review.approved_by).toBeNull();
  expect(fixture.review.rule_snapshot).toHaveLength(15);
  expect(fixture.findings).toHaveLength(15);
  expect(fixture.findings.every((finding: { status: string }) => finding.status === "open")).toBe(true);
  expect(fixture.reports).toBe(0);
  expect(fixture.preScreeningReports).toBe(0);
  expect(fixture.rules.every((status: string) => status === "DRAFT")).toBe(true);
  expect(fixture.sources.every((status: string) => status === "DRAFT")).toBe(true);
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
  await editor
    .getByLabel("Ngày truy xuất")
    .fill(new Date().toISOString().slice(0, 10));
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
