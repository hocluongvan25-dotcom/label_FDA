# Kết nối Vexim Label Review với Supabase

1. Dùng Node.js 22.13+; chạy `npm ci`, `npm run dev`.
2. Tạo dự án Supabase cloud. Chạy `0001_initial.sql` rồi `0002_registry_seed.sql` trong `supabase/migrations` bằng project owner/SQL Editor.
3. Sao chép `.env.example` thành `.env.local`; điền Supabase URL và public anon key. Service-role key chỉ ở server/worker, không gửi trong chat hoặc gán vào NEXT_PUBLIC.
4. Đặt Site URL/redirect allowlist đúng origin app, bật email confirmation và cấu hình SMTP cho invitations. Đặt NEXT_PUBLIC_APP_URL.
5. Tạo/xác nhận Auth users. Dùng `npm run staff -- --email ... --role ...` để cấp reviewer, system_admin và **hai regulatory_admin độc lập** từ môi trường trusted.
6. Cấu hình ClamAV private (CLAMAV_HOST/PORT), rồi chạy `npm run worker` trong terminal/container riêng. OCR local là mặc định, không gửi nhãn sang AI ngoài.
7. Regulatory Admin đăng ký văn bản luật thực đã truy xuất; hash lưu trên exact excerpt. Admin khác duyệt CURRENT, chạy regression và duyệt 15 rules ACTIVE. Seed DRAFT chưa phải luật đã được kiểm chứng.
8. Customer tạo dossier, tải nhãn và submit. Reviewer đối chiếu bản gốc/fields/citations, xử lý findings có lý do, rồi xác nhận disclaimer và duyệt PDF/JSON.

File phải scan **clean** để mở/signed URL/approve. Dev bypass chỉ thử pipeline, không dùng cho hồ sơ thật. Báo cáo không phải phê duyệt/chứng nhận FDA, không bảo đảm thông quan, không thay thế tư vấn pháp lý.

Thiếu cấu hình thì demo ghi rõ trên mọi màn hình. Demo/local drafts không mã hóa và không có malware scanner: chỉ file tin cậy. App không fallback dữ liệu mẫu tự động khi Supabase đã được cấu hình nhưng bị lỗi.

README và docs/SETUP.md, SECURITY.md, PROVIDERS.md, API.md, TESTING.md trong repository có hướng dẫn đầy đủ. Chưa có Supabase project/key ở phiên xây dựng này nên integration thực cần kiểm tra staging trước go-live.

## Kho tri thức pháp quy qua API

Chạy migration 0003 cùng 0001/0002; đặt `REGULATORY_CONTACT_EMAIL` ở web server và worker. Khởi động `npm run regulatory:worker -- --schedule` độc lập với worker OCR.

Trang **Kho tri thức pháp quy**: sync eCFR → snapshot raw/DRAFT → Admin A checklist → Admin B duyệt độc lập. Federal Register tạo tác vụ rà soát, không sửa luật. Chỉ ACTIVE + APPROVED chunks khớp source/version/as-of được truy xuất.

Preview demo không gọi government APIs, không chứa raw XML thật, không cập nhật registry/rules. Fixture XML của sandbox là synthetic; cần kiểm chứng golden XML thật và Supabase staging trước production. Tài liệu đầy đủ trong repo: `docs/REGULATORY_KNOWLEDGE.md`.
