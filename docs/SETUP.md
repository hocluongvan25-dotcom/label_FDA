# Triển khai Vercel / Supabase / worker

## 1. Database

Dùng Supabase cloud được khuyến nghị khi mở Live Preview Arena. Chạy **0001_initial.sql → 0002_registry_seed.sql → 0003_regulatory_ingestion.sql** bằng SQL Editor (project owner) hoặc `supabase db push` sau khi link project. Đây là migration khởi tạo; không chạy lại `0001` trên schema đã tồn tại. Backup trước khi nâng cấp một database đang có dữ liệu.

Migration tạo Auth profile trigger, schema tenant, RLS, guarded RPCs, append-only audit, frozen dossiers/source versions/report snapshots, queue và các buckets **private**: `label-originals`, `label-normalized`, `review-reports`; migration 0003 thêm `regulatory-raw`. Original INSERT chỉ tại path đã đăng ký; không có quyền overwrite/delete cho customer. Chỉ đọc originals/normalized sau scan `clean`.

Catalog seed có 12 nguồn và 15 rules **DRAFT**. Không có nguồn thực được fetch hoặc duyệt tự động.

## 2. Môi trường

Sao chép `.env.example` → `.env.local`:

| Biến                                   | Dùng ở đâu     | Ý nghĩa                                                  |
| -------------------------------------- | -------------- | -------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL               | browser/server | URL HTTPS có thể truy cập từ trình duyệt người dùng      |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   | browser/server | Tên hiện hành của public publishable key; không phải service key |
| NEXT_PUBLIC_SUPABASE_ANON_KEY          | browser/server | Tên legacy của public anon key; vẫn được hỗ trợ |
| NEXT_PUBLIC_APP_URL                    | server/email   | Origin app thực để mời thành viên                        |
| NEXT_PUBLIC_ENABLE_DEMO                | browser        | `false` cho triển khai nhận dữ liệu thật                 |
| SUPABASE_SERVICE_ROLE_KEY              | server/worker  | Secret trusted; không đưa vào bundle, Git, chat          |
| CLAMAV_HOST / CLAMAV_PORT              | worker         | Scanner private có INSTREAM; default port 3310           |
| OCR_PROVIDER                           | worker         | `local` mặc định hoặc `approved`                         |
| APPROVED_* / APPROVED_PROVIDER_CONSENT | worker         | Chỉ cấu hình khi nhà cung cấp đã được tổ chức chấp thuận |

Public env được Next.js ghi nhận khi build; thay đổi cần restart/rebuild. Không dùng URL localhost trong browser để trỏ tới backend bên trong Arena: dùng Supabase cloud hoặc public proxy đúng host. `supabase/config.toml` dành cho phát triển local trên máy có Supabase CLI + Docker; chưa được chạy trong sandbox này.

## 3. Auth / staff / doanh nghiệp

- Bật email confirmation, Site URL, redirect allowlist đúng domain; cấu hình SMTP cho invitations. Không dùng allowlist `https://*.e2b.app/**` cho production; chỉ allow domain của bạn.
- Người dùng signup chỉ có customer profile. `raw_user_meta_data.role` bị bỏ qua.
- Tạo/xác nhận Auth users, sau đó chạy `npm run staff -- --email ... --role reviewer|regulatory_admin|system_admin` bằng môi trường trusted. Không có public endpoint cấp staff role.
- Cần 2 Regulatory Admin: người sửa nguồn/rule không tự duyệt bản mình tạo.
- Customer đăng nhập lần đầu tạo tổ chức → Customer Admin. Admin mời contributor/admin khác; lời mời chỉ được tự kích hoạt sau xác nhận email. Không gửi mật khẩu hoặc token trong chat.
- Reviewer nhận phụ trách trong workspace. System Admin có thể phân công một reviewer active qua API; không được duyệt báo cáo hoặc sửa luật.

## 4. Worker / scanner

App và worker là **2 process riêng**. Chạy worker trên container/VM long-lived, không phải một serverless request. `npm run worker` dùng service key để claim job và đọc private Storage.

Tuần tự: magic/hash/size → ClamAV → normalized pages/text layer → local hoặc approved OCR → grounded extraction → ACTIVE/current rules → verifier → human review. Heartbeat 30 giây, lease 6 phút, tối đa 3 attempts tự động, exponential retry/dead-letter. Persist intermediate outputs để retry không chạy lại bước đã thành công. Không worker nào được tự approve.

ClamAV cần được cập nhật definitions, INSTREAM capacity ≥50 MB và network chỉ cho worker. `docker-compose.dev.yml` là lựa chọn local; scanner có thể mất vài phút để tải definitions. File phát hiện malware bị đánh dấu rejected; không gửi OCR/model hoặc cho người dùng mở file.

`ALLOW_UNSCANNED_DEV_UPLOADS=true` chỉ dùng development, không có tác dụng trong production. File gắn `dev_unscanned` không được signed/read/approve report; đây không phải cách bypass chốt malware cho hồ sơ thật.

## 5. Registry thực

1. Editor Regulatory Admin mở nguồn, truy xuất văn bản official, đăng ký excerpt thực, retrieved_at và effective dates. Hash là SHA-256 của **exact UTF-8 excerpt đã đăng ký**, không tự nhận là hash của toàn bộ tài liệu web/PDF.
2. Regulatory Admin khác đối chiếu URI, citation, hash, ngày và phiên bản rồi duyệt CURRENT.
3. Editor tạo draft cho từng rule, chạy 15 fixtures, sau đó admin độc lập duyệt ACTIVE.
4. Khi thay đổi source, snapshot cũ được archive. Rule source snapshot cũ không còn được chạy. Tạo draft rule version mới, QA lại và duyệt; rerun reviews trước khi phát hành báo cáo mới.

Current sources/rules cần đủ cả bộ MVP. Không điền văn bản mẫu để kích hoạt production. Chunks/vector RPC có schema và stale-version filtering; embeddings/crawling không tự chạy hoặc gửi dữ liệu tới dịch vụ ngoài.

## 6. Báo cáo

Reviewer xử lý tất cả findings với lý do, đối chiếu evidence/originals và citations, xác nhận scope/disclaimer. DB tạo immutable snapshot; server ghi **PDF + JSON private**; chỉ sau khi hai artifacts được lưu, review mới chuyển COMPLETED. Nếu materialization thất bại, nội dung đã duyệt vẫn giữ và download có thể thử tạo artifacts lại; không nhân bản báo cáo hoặc chỉnh sửa snapshot cũ.

Kiểm tra staging theo `TESTING.md` trước go-live. Cấu hình backups, retention, observability không log nhãn/token, rate limits/WAF và pagination trước khi mở rộng dữ liệu.

## 7. Web app trên Vercel

Vercel chạy giao diện Next.js và các API Node.js. Vercel **không tự chạy** label/OCR worker, regulatory worker hoặc ClamAV; các process này phải được triển khai riêng theo mục 4 và 8.

1. Merge PR mã nguồn vào nhánh mà Vercel sẽ deploy (thường là `main`), hoặc cấu hình **Production Branch** thành nhánh chứa mã nguồn. Import repository `hocluongvan25-dotcom/label_FDA` vào Vercel.
2. Chọn **Framework Preset: Next.js**, **Root Directory: gốc repository**, **Node.js: 22.x**, **Install Command: `npm ci`**, **Build Command: `npm run build`**. Giữ Output Directory mặc định của Next.js. Postinstall tự tạo OCR/PDF assets; không bỏ qua scripts khi install.
3. Để thử giao diện bằng dữ liệu tổng hợp: đặt `NEXT_PUBLIC_ENABLE_DEMO=true`, không cần khóa Supabase. Chỉ thử file tin cậy; đây không phải môi trường nhận hồ sơ thật.
4. Với dữ liệu thật: đặt `NEXT_PUBLIC_ENABLE_DEMO=false`, cấu hình `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (hoặc alias legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `NEXT_PUBLIC_APP_URL`, `SUPABASE_SERVICE_ROLE_KEY` và `REGULATORY_CONTACT_EMAIL` trong **Vercel Environment Variables**. Không commit `.env.local`; không thêm prefix `NEXT_PUBLIC_` cho secret. Cấu hình riêng từng môi trường Preview/Production để preview không vô tình dùng dữ liệu production.
5. Chạy đủ migrations, cấu hình Supabase Auth Site URL/redirect allowlist theo domain Vercel, cấp staff roles, triển khai workers/scanner và kiểm tra registry trước khi nhận hồ sơ thật. Khi thay đổi biến `NEXT_PUBLIC_*`, phải **Redeploy** vì các giá trị này được ghi vào browser bundle lúc build.

Build local thành công không thay thế kiểm thử Vercel/Supabase staging. Thực hiện checklist trong `TESTING.md`; parser pháp quy còn cần golden XML thật theo `REGULATORY_KNOWLEDGE.md` trước khi kích hoạt luật production.

## 8. Regulatory Knowledge worker

Chạy additive migration `0003_regulatory_ingestion.sql` trước bản app mới. Đặt `REGULATORY_CONTACT_EMAIL` ở web server và regulatory worker; `REGULATORY_POLL_MS=5000` (1.000–60.000). Worker cần HTTPS outbound tới `www.ecfr.gov` và `www.federalregister.gov`. Không đưa label/formula/customer PII vào government queries.

`npm run regulatory:worker -- --schedule` là process/container riêng với label/OCR worker. Hoặc gọi `--schedule-once` hằng ngày qua cron; daily slot UTC idempotent. Hai Regulatory Admin kiểm tra raw/checklist và phê duyệt độc lập ở `/knowledge`. Không có law activation tự động. Chi tiết cache, golden XML fixtures, affected-rule QA và lifecycle: [REGULATORY_KNOWLEDGE.md](REGULATORY_KNOWLEDGE.md).
