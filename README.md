# Vexim Label Review

MVP rà soát **nhãn trà khô đóng gói / trà túi lọc xuất khẩu Hoa Kỳ**, theo tài liệu v0.1. Giao diện tiếng Việt, hướng tới hồ sơ thực tế và quy trình **evidence → rule → citation → chuyên viên**; không phải chatbot tư vấn luật.

> Kết quả là rà soát sơ bộ trong phạm vi được ghi nhận. Không phải phê duyệt/chứng nhận của FDA, không bảo đảm thông quan và không thay thế tư vấn pháp lý.

## Chạy ngay

Yêu cầu **Node.js 22.13+**, npm.

```bash
npm ci
npm run dev
```

Mở app ở cổng **3000**. Dev server bind `0.0.0.0` và hỗ trợ hostname Live Preview của Arena. Nếu chưa cấu hình Supabase, app mở **không gian demo có ghi rõ nhãn DEMO**, với dữ liệu tổng hợp được lưu trong trình duyệt. Chỉ thử file tin cậy trong demo: không có antivirus cục bộ.

### Những luồng đã xây dựng

- Dashboard: tìm kiếm, trạng thái, severity, lọc, sắp xếp, phân trang, CSV chống spreadsheet formula injection.
- Intake 4 bước: phân loại, công thức/thứ tự khối lượng/dị nguyên, claims/các bên liên quan, nhãn/thị trường/exemption; kiểm tra dữ liệu thiếu và tự lưu nháp trên thiết bị.
- Nhãn bất biến: PDF, PNG, JPEG, TIFF; hash SHA-256; nhiều phiên bản; ảnh normalized và dữ liệu trích xuất được lưu riêng.
- Workspace 3 pane: nhãn/zoom/bbox, danh sách findings, evidence/citation/quyết định. Xác nhận hoặc loại trừ có lý do, sửa field, thêm finding thủ công, yêu cầu bổ sung, nhận phụ trách, đối chiếu phiên bản và chạy lại pipeline.
- Báo cáo PDF có font tiếng Việt và JSON snapshot; ghi rõ scope, outcome, findings, evidence, thông tin thiếu, nguồn, người duyệt, disclaimer và lịch sử phiên bản.
- Source registry, 15 deterministic checks, rule versioning, regression fixtures, phê duyệt độc lập và audit append-only.
- Kho tri thức `/knowledge`: eCFR API-first / FDA Federal Register monitoring, private raw/hash snapshots, issue/version/as-of citations, independent checklist/activation, affected-rule regression và scheduled ingestion.
- Supabase Auth/Postgres/RLS/private Storage; bearer API; worker có lease/heartbeat, intermediate outputs, tối đa 3 lần thử tự động và dead-letter.

Demo có thể đổi giữa 5 persona tại **Cài đặt**. Đây là mô phỏng UX; dữ liệu demo không phải hồ sơ pháp lý hay một triển khai Supabase thực tế.

## Kết nối Supabase thực tế

1. Tạo dự án Supabase; chạy lần lượt:
   - `supabase/migrations/0001_initial.sql`
   - `supabase/migrations/0002_registry_seed.sql`
   - `supabase/migrations/0003_regulatory_ingestion.sql`
   - `supabase/migrations/0004_guidance_expert_review.sql` (expert-review workflow cho tài liệu dạng FDA Guidance)
2. Sao chép `.env.example` thành `.env.local`. Điền project URL/public anon key cho browser và **service-role key chỉ ở server/worker**. Không đưa secret vào `NEXT_PUBLIC_*`, repository hoặc chat.
3. Trong Supabase Auth, đặt Site URL/redirect allowlist đúng domain app; bật xác nhận email. Cấu hình SMTP nếu dùng lời mời doanh nghiệp.
4. Tạo/xác nhận tài khoản Auth. Cấp staff bằng công cụ trusted (không qua metadata signup):

   ```bash
   npm run staff -- --email reviewer@your-company.example --role reviewer
   npm run staff -- --email regulatory-a@your-company.example --role regulatory_admin
   npm run staff -- --email regulatory-b@your-company.example --role regulatory_admin
   npm run staff -- --email operations@your-company.example --role system_admin
   ```

   Cần **2 Regulatory Admin độc lập** để tạo và duyệt nguồn/rules. System Admin không có quyền thay đổi luật hoặc duyệt báo cáo.

5. Cấu hình **ClamAV** cho worker. Cách gọn nhất: `docker compose -f docker-compose.worker.yml up -d --build` chạy luôn worker + ClamAV, hoặc chỉ scanner bằng `docker compose -f docker-compose.dev.yml up -d` rồi đặt `CLAMAV_HOST=127.0.0.1`, `CLAMAV_PORT=3310`. Trong triển khai container/cloud, dùng endpoint scanner private có thể truy cập từ worker.
6. Khởi động app và một worker riêng:

   ```bash
   npm run dev
   # Terminal/container thứ hai, dùng cùng cấu hình server:
   npm run worker
   ```

7. Kiểm tra điều kiện chạy thật trước khi nhận hồ sơ:

   ```bash
   npm run doctor
   ```

   Doctor báo thiếu env, ClamAV chưa reachable, hàng đợi kẹt, bucket storage và số rules ACTIVE. Trong app, panel **Phân tích nhãn theo từng bước** hiển thị cùng nguyên nhân (thiếu worker, lease hết hạn, job lỗi, thiếu scanner, thiếu rules) kèm cách xử lý. Xem [Operations](docs/OPERATIONS.md).

8. Registry seed chỉ có **12 nguồn / 15 rules ở DRAFT**. Regulatory Admin phải đăng ký văn bản thực đã truy xuất, ngày hiệu lực/retrieval và duyệt độc lập; chạy regression rồi duyệt rules. Không có nội dung luật, hash hay phê duyệt thật bị bịa trong seed. Khi chưa đủ 15 rules hiện hành, review là `SOURCE_UNAVAILABLE`, không thể phát hành kết luận không phát hiện vấn đề.

Hướng dẫn API-first mới: [Regulatory Knowledge](docs/REGULATORY_KNOWLEDGE.md) (worker/schedule, nguồn, QA/activation, staging XML thật).

Hướng dẫn chi tiết: [Setup](docs/SETUP.md), [Operations](docs/OPERATIONS.md), [Security](docs/SECURITY.md), [API](docs/API.md), [Providers](docs/PROVIDERS.md), [Testing](docs/TESTING.md). Bản hướng dẫn nhanh cũng có tại `/setup-guide.md` trong app.

### Phân biệt các môi trường

| Môi trường                  | Lưu dữ liệu                            | OCR                                                           | Malware                    | Báo cáo                                                             |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| Demo                        | localStorage + IndexedDB trên thiết bị | Local/PDF text layer                                          | Không có; chỉ file tin cậy | Gắn DEMO, không dùng cho hồ sơ thực                                 |
| Supabase thực               | Postgres + private Storage, RLS        | Local mặc định, hoặc approved facade                          | ClamAV bắt buộc            | Reviewer duyệt; clean scan + nguồn/rules hiện hành + artifacts thật |
| Supabase thực, thiếu worker | Postgres + private Storage, RLS        | Không chạy                                                    | Không chạy                 | Review đứng 0% · mọi bước “Chờ”; panel pipeline nêu rõ nguyên nhân  |
| Dev opt-in chưa có scanner  | Supabase dev riêng                     | Cho phép thử pipeline bằng `ALLOW_UNSCANNED_DEV_UPLOADS=true` | Gắn `dev_unscanned`        | **Không** đọc/signed URL hoặc phê duyệt báo cáo thật                |

App **không tự fallback** từ cấu hình Supabase bị lỗi sang dữ liệu mẫu. `NEXT_PUBLIC_ENABLE_DEMO=false` tắt nút demo và yêu cầu cấu hình thực đầy đủ.

## Triển khai trên Vercel

Import repository vào Vercel từ nhánh đã có mã nguồn; chọn **Next.js**, **Node.js 22.x**, install `npm ci`, build `npm run build`. Giữ Output Directory mặc định. Có thể mở demo bằng `NEXT_PUBLIC_ENABLE_DEMO=true` mà chưa cần Supabase.

Để tiếp nhận dữ liệu thật, cấu hình Supabase và server secrets trong Vercel Environment Variables, tắt demo, chạy migrations và triển khai **label/OCR worker, regulatory worker, ClamAV riêng**; Vercel không tự chạy các process này. Nếu chưa có worker, mọi review sẽ đứng ở 0% — đây là hành vi đúng, không phải lỗi treo: [Operations](docs/OPERATIONS.md). Chi tiết: [Setup → Web app trên Vercel](docs/SETUP.md#7-web-app-trên-vercel).

## Đồng bộ pháp quy qua API

Đặt contact vận hành (server + worker): `REGULATORY_CONTACT_EMAIL`; chạy một worker riêng:

```bash
npm run regulatory:worker -- --schedule
```

Mở **Kho tri thức pháp quy** (`/knowledge`). Admin A sync → raw + DRAFT chunks → kiểm tra/checklist; Admin B xem raw/checklist/QA và kích hoạt độc lập. Federal Register chỉ tạo review task/alert, không tự sửa rules. RAG chỉ dùng ACTIVE snapshot + APPROVED chunks khớp registry/as-of. Reports giữ issue/raw hash/parser/version nguyên gốc.

**Chưa có live upstream ingestion trong sandbox**: direct HTTPS tới eCFR/FR bị chặn. XML fixture local được ghi rõ **synthetic**. Không coi parser đã qualified cho production chỉ vì tests pass; cần golden XML thật §§101.3/101.7/101.9 và full Part 101 comparison ở staging trước khi kích hoạt luật thật. Không tự fallback issue date sang hôm nay.

## Kiểm tra chất lượng

Đã chạy thành công: TypeScript, lint, production build; **135 unit/integration-local tests** và **6 Playwright workflows** (desktop/mobile, reviewer/evidence, customer/autosave/upload, human PDF/JSON report, independent source approval, API knowledge workflow). Browser tests chạy ở demo; không thay thế staging Supabase thật.

```bash
npm run typecheck
npm run lint
npm test
npm run build
# Browser thường (cần Chromium của Playwright):
npm run test:e2e
# Linux sandbox thiếu browser/system libs: dùng binary/lib đã đóng gói qua npm:
npm run test:e2e:bundled
```

Unit/integration-local tests dùng **PostgreSQL WASM/PGlite với pgcrypto + pgvector thực**, shim Auth/Storage riêng; có kiểm tra RLS, RPC, nguồn/rule/version/report gates, queue, file normalization, OCR Tesseract thật và PDF Unicode. Worker tests dùng Storage và ClamAV protocol **giả lập có ghi rõ**, không phải kiểm chứng Supabase/ClamAV production.

**Chưa có dự án Supabase/khóa môi trường trong phiên xây dựng này**, nên chưa triển khai migration hoặc kiểm chứng Auth, signed Storage, SMTP và worker trên Supabase thực. Cần chạy checklist staging trong `docs/TESTING.md` trước khi tiếp nhận dữ liệu khách hàng thật.

## Kiến trúc và phạm vi

```
Browser UI ── bearer /api/v1 ── Supabase JWT + RLS + guarded RPC
    │                                  │
    └─ original uploads ── private Storage manifests
                                       │
                         queue ── trusted worker
                         scan → normalize → OCR → extraction → rules → verifier
                                       │
                                human reviewer
                                       │
                    immutable report snapshot → private PDF + JSON
```

- `src/lib`: contracts, extraction/rules/verifier, validation, report/PDF, fixtures.
- `src/components`: dashboard/intake/review/registry/customer/audit/settings UI.
- `src/server`: bearer context, API, malware adapter, native normalization, approved-provider facades, pipeline and report artifacts.
- `supabase/migrations`: schema, RLS/RBAC, immutable audit/snapshots, queue RPC và DRAFT catalog.
- `scripts`: local OCR/PDF assets, worker, trusted staff provisioning, browser test wrapper.

OCR/extraction hỗ trợ tiếng Anh và các checks bảo thủ; chưa xác minh tự động mọi kích thước chữ, vị trí panel, cấu trúc Nutrition Facts, nutrition values, chứng nhận organic/non-GMO, country-of-origin hay phân loại botanical phức tạp. Medical claims, supplement, đồ uống pha sẵn và trường hợp ngoài MVP cần chuyên gia. Embedding/chunks/vector search schema đã có, nhưng không tự crawl luật hoặc tạo embeddings chưa được duyệt.

Giới hạn: 50 MB/file, 20 files/review, 10 trang/PDF/TIFF, 32 MP ảnh, normalized budget 128 MB/review, JSON API 1 MB. Triển khai MVP cần quy mô workspace nhỏ; bổ sung server pagination/archival trước khi mở rộng dữ liệu lớn. Không đưa original labels, credentials, OCR artifacts hay build output vào Git.
