# Vận hành: từ self-check 0% đến một lượt rà soát hoàn thành

Tài liệu này trả lời câu hỏi thường gặp nhất sau khi tạo hồ sơ: **vì sao review đứng ở “Đang phân tích · 0% · tất cả bước Chờ”?**

Pipeline không chạy trong web app. Web app (Vercel hoặc `npm run dev`) chỉ ghi nhận hồ sơ, tải file lên private Storage và tạo một job trong `pipeline_jobs`. Các bước quét mã độc → normalize → OCR → extraction → rules → verifier **chỉ** chạy trong worker có kết nối tới ClamAV. Nếu worker hoặc ClamAV vắng mặt, review sẽ đứng yên ở 0% — đây là hành vi đúng: hệ thống không được suy diễn kết quả khi chưa chạy thật.

## 1. Chẩn đoán trong 30 giây

```bash
npm run doctor
```

Doctor kiểm tra và chỉ in trạng thái (không in giá trị secret):

| Mục                      | Ý nghĩa khi không đạt                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Biến môi trường Supabase | Thiếu URL / anon key / service-role key cho worker                 |
| Kết nối Postgres         | URL, key hoặc migration chưa đúng                                  |
| ClamAV                   | `CLAMAV_HOST` trống hoặc daemon không reachable từ nơi worker chạy |
| Bộ quy tắc               | Chưa đủ 15 rules ACTIVE → review sẽ dừng ở `SOURCE_UNAVAILABLE`    |
| Nguồn tham chiếu         | Chưa có nguồn hiện hành → rules không thể hợp lệ                   |
| Worker / hàng đợi        | Chưa có `pipeline_outputs` nào, hoặc job chờ quá lâu / dead-letter |
| Storage buckets          | Thiếu bucket hoặc bucket bị public                                 |

Trong app, panel **Phân tích nhãn theo từng bước** hiển thị cùng thông tin này dưới dạng thẻ chẩn đoán kèm cách xử lý (thiếu worker, lease hết hạn, job lỗi, thiếu scanner, thiếu rules).

`GET /api/v1/health` cũng trả `{scanner_configured, scanner_reachable, scanner_detail, rules:{active,total}, queue:{...}, worker_last_activity}`.

## 2. Chạy worker + ClamAV

```bash
cp .env.example .env.local      # điền Supabase URL + service-role key (chỉ server/worker)
docker compose -f docker-compose.worker.yml up -d --build
docker compose -f docker-compose.worker.yml logs -f worker
npm run doctor
```

- ClamAV tải cơ sở chữ ký khi khởi động lần đầu; container có thể mất vài phút mới healthy. Worker chỉ start sau khi scanner healthy.
- `CLAMAV_HOST=clamav`, `CLAMAV_PORT=3310` được đặt sẵn trong compose; hai process phải cùng mạng docker.
- Không cần Docker: `CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3310 npm run worker` với ClamAV chạy cục bộ (`docker compose -f docker-compose.dev.yml up -d`).
- Worker và web app phải trỏ **cùng** dự án Supabase. Worker khác project sẽ không thấy job.

Thiết lập đầy đủ (migration, Auth, staff, Vercel): [SETUP.md](SETUP.md).

## 3. Kích hoạt bộ quy tắc (bắt buộc, không tự động)

Seed chỉ có 12 nguồn và 15 rules ở **DRAFT**. Không có công cụ nào tự kích hoạt: nội dung luật, hash và chữ ký phê duyệt phải thật, nếu không mọi kết luận tuân thủ sẽ là giả.

Quy trình nội bộ (2 Regulatory Admin độc lập; System Admin không được phép):

1. **Nguồn thật** — `npm run regulatory:worker -- --schedule` (hoặc đăng ký thủ công tại `/sources`: excerpt ≥ 80 ký tự, `retrieved_at`, canonical URL).
2. **Admin A** mở `/knowledge`, kiểm tra 9 mục checklist của snapshot DRAFT, phân loại thay đổi và ngày hiệu lực. Tài liệu dạng **FDA Guidance** theo mục 6 thay vì bước này.
3. **Admin B** (khác người tạo) kích hoạt snapshot → nguồn `CURRENT`, chunks `APPROVED`.
4. **Admin A** tạo/cập nhật 15 rule draft tại `/rules`, mỗi rule gắn đúng nguồn `CURRENT`.
5. **Regression** — 15 fixtures phải passed, `test_hash` khớp `definition_hash`.
6. **Admin B** (khác người tạo rule) duyệt → `ACTIVE`.
7. **Xác nhận** — `/rules` hiển thị 15 rules active; thiếu thì review dừng ở `SOURCE_UNAVAILABLE` và không được kết luận “không phát hiện vấn đề”.

Hướng dẫn này cũng hiển thị ngay trong trang **Quy tắc kiểm tra** khi số rules active < 15.

Chi tiết ingestion/golden XML: [REGULATORY_KNOWLEDGE.md](REGULATORY_KNOWLEDGE.md).

## 4. Chạy thử end-to-end

```bash
npm run doctor          # không còn mục chặn
# trong app: tạo hồ sơ → tải nhãn → Self-check
docker compose -f docker-compose.worker.yml logs -f worker
```

Tiến trình hợp lệ: `validation` (scan + normalize) → `ocr` → `extraction` → `rules` → `verification`, review chuyển `AI_REVIEW_READY`, chuyên viên xác nhận findings rồi duyệt báo cáo (PDF + JSON private).

## 5. Xử lý sự cố

| Hiện tượng                                              | Nguyên nhân thường gặp                                             | Xử lý                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 0% mãi, “Chưa có worker nào nhận tác vụ”                | Worker chưa chạy hoặc khác project Supabase                        | Chạy worker cùng `.env.local`; xem log container                                                                            |
| Job `retry`, lỗi “Malware scanner chưa được cấu hình”   | Thiếu `CLAMAV_HOST` trong môi trường **worker**                    | Cấu hình ClamAV cho worker; `ALLOW_UNSCANNED_DEV_UPLOADS` chỉ dùng dev                                                      |
| Job `running` nhưng lease hết hạn                       | Worker bị dừng/mất kết nối giữa chừng                              | Job tự trở lại hàng đợi; kiểm tra log và độ ổn định kết nối                                                                 |
| `dead_letter`                                           | Quá 3 lần thử (file hỏng, scanner, OCR)                            | Khắc phục nguyên nhân rồi “Chạy lại kiểm tra” từ bước phù hợp                                                               |
| Đến bước `rules` rồi `SOURCE_UNAVAILABLE`               | Chưa đủ 15 rules ACTIVE hoặc nguồn hết hiệu lực                    | Làm mục 3; kiểm tra `/knowledge`                                                                                            |
| Không mở được file nhãn                                 | File chưa `scan_status = clean`                                    | Chờ worker quét; đây là chốt an toàn, không bypass                                                                          |
| Lưu draft nguồn báo “Dữ liệu đầu vào chưa hợp lệ”       | Một trường không qua validation                                    | Modal hiện lỗi ngay dưới từng ô và trong thông báo; kiểm tra Ngày truy xuất, URL HTTPS, snapshot ≥ 80 ký tự, độ ưu tiên 1–6 |
| Nguồn FDA Guidance không phê duyệt được                 | Guidance cần đánh giá chuyên gia trước khi duyệt                   | Làm mục 6: Admin A ghi nhận đánh giá chuyên gia, Admin B (khác người) phê duyệt. Modal liệt kê đúng lý do đang chặn         |
| Báo “…remains DRAFT until its dedicated expert-review…” | Chuỗi này **không có trong repo**; do SQL/trigger tự thêm trong DB | Chạy truy vấn dò ở mục 6 để tìm hàm phát sinh, drop/guard đó đi rồi dùng workflow 0004                                      |

## 6. Workflow chuyên biệt cho FDA Guidance

Tài liệu có `document_type` chứa _guidance/guideline_ (ví dụ “FDA Label Claims Guidance v2”) không đi theo luồng eCFR:

1. **Admin A (người tạo hoặc người đối chiếu)** mở nguồn tại `/sources` → tick 9 mục checklist đánh giá chuyên gia, chọn tình trạng văn bản (final/draft), hiệu lực pháp lý (**guidance FDA = không ràng buộc**), ghi phạm vi áp dụng ≥ 40 ký tự → “Ghi nhận đánh giá chuyên gia”.
2. Nếu có rule ACTIVE trích dẫn nguồn: bấm “Chạy regression rule bị ảnh hưởng”, phải đạt trên đúng hash hiện tại.
3. **Admin B (người khác)** phê duyệt. Nút phê duyệt bị chặn và modal nêu rõ lý do khi: chưa có đánh giá, đánh giá đã cũ (đổi version/hash), chính bạn là người đánh giá, văn bản withdrawn/superseded, hoặc ghi nhận là “ràng buộc pháp lý”.
4. Sau khi duyệt: `status = CURRENT`, `ingestion_status = ACTIVE`, audit `regulatory.guidance_reviewed` → `regulatory.guidance_approved`.

Quy tắc hai người vẫn giữ nguyên; hệ thống không tự đánh giá, không tự duyệt, không tạo nội dung/hash/chữ ký giả.

### Dò một thông báo lạ phát sinh từ DB

Nếu bạn gặp thông báo không có trong mã nguồn (ví dụ `Ingested FDA Guidance remains DRAFT until its dedicated expert-review and approval workflow is implemented`), nó đến từ SQL đã chạy ngoài repo này. Tìm nguồn:

```sql
select proname, prosrc from pg_proc where prosrc ilike '%remains DRAFT%';
select t.tgname, t.tgrelid::regclass
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where p.prosrc ilike '%remains DRAFT%';
select conname, conrelid::regclass, pg_get_constraintdef(oid)
  from pg_constraint where pg_get_constraintdef(oid) ilike '%remains DRAFT%';
```

Sau khi xác định, drop function/trigger/constraint đó (hoặc sửa lại để gọi workflow 0004) — đừng tắt chốt an toàn bằng cách tự duyệt nguồn.

## 7. Nhật ký và giám sát

- `pipeline_jobs` (status, attempts, `last_error`, `locked_until`) và `pipeline_outputs` (kết quả trung gian) là nguồn sự thật về tiến độ.
- Audit log append-only ghi mọi quyết định, truy cập file và phê duyệt.
- Không log nội dung nhãn, token hay khóa. Log worker có thể chứa tên file và thông báo lỗi kỹ thuật.
