# Regulatory Knowledge System · eCFR / Federal Register

## Phạm vi đã tích hợp

Màn hình `/knowledge` và backend TypeScript dùng Supabase hiện hữu. Đây là kho evidence có version cho chuyên viên, **không phải chatbot pháp lý**. Không có tác vụ nào tự phê duyệt luật, sửa definitions của rules hay bảo đảm nhãn hợp pháp/FDA approval.

- eCFR: Title 21 → discovery Part 101 → full XML hoặc section → raw snapshot → parser → DRAFT chunks.
- Federal Register: FDA + ngày xuất bản + từ khóa pháp quy + loại văn bản + tùy chọn CFR 21/101 → document detail → snapshot/alert cần regulatory review. **Monitor-only**; không vào active RAG.
- FDA guidance: workflow manual source registry riêng vẫn được giữ. Không có scraper FDA HTML/PDF mới hoặc embedding provider tự động. openFDA không thay thế CFR.

## API chính thức và các điểm điều chỉnh so với ví dụ

1. `GET https://www.ecfr.gov/api/versioner/v1/titles.json`: lấy `latest_issue_date` của Title 21, **không dùng ngày hiện tại hoặc `up_to_date_as_of`**.
2. `GET /api/versioner/v1/structure/{issue}/title-21.json`: duyệt hierarchy để tìm các sections Part 101, kể cả reserved sections.
3. `GET /api/versioner/v1/full/{issue}/title-21.xml?part=101`, hoặc `?section=101.9`. Gửi `Accept-Encoding: gzip, deflate` theo tài liệu API.
4. Search là **`/api/search/v1/results`**, không có `.json`; discovery gửi `query` thuộc allowlist và `date={issue}`. Search chỉ là discovery, chưa phải evidence đã được phê duyệt.
5. Federal Register: `/api/v1/documents.json` với **`conditions[agencies][]`**=`food-and-drug-administration`, `conditions[publication_date][gte/lte]`, `conditions[term]`, tùy chọn `conditions[type][]`, `conditions[cfr][title/part]`. Detail `/api/v1/documents/{number}.json`.
6. Federal Register chỉ cho truy cập 2.000 kết quả đầu. Monitor phân trang 100/page, tối đa 20 pages; từ chối cửa sổ >32 ngày hoặc >2.000 kết quả, không lặng lẽ cắt dữ liệu. Kiểm tra bản chính thức ở **govinfo** trước khi dùng làm căn cứ pháp lý.

Nguồn tài liệu: [eCFR docs](https://www.ecfr.gov/developers/documentation/api/v1), [eCFR Swagger](https://www.ecfr.gov/developers/documentation/api/v1.json), [Federal Register REST API](https://www.federalregister.gov/reader-aids/developer-resources/rest-api), [FR Swagger](https://www.federalregister.gov/developers/documentation/api/v1.json).

`issue_date`, `retrieved_at`, `source_version`, `effective_from/to`, `review as_of_date` có ý nghĩa khác nhau. Không hardcode một ngày issue ở production. Ngày cố định trong demo chỉ là edition **mô phỏng**, được ghi nhãn rõ.

## Cấu hình / vận hành

Chạy migrations **0001 → 0002 → 0003** trước khi chạy app/worker mới. Không reset database cũ. Migration 0003 là additive và giữ nguyên reports đã phát hành.

Server web và regulatory worker cần:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<configured securely in your deployment>
REGULATORY_CONTACT_EMAIL=regulatory-operations@your-company.example
REGULATORY_POLL_MS=5000
```

Service key không được đưa vào `NEXT_PUBLIC_*`, Git hoặc chat. Contact email là contact vận hành của app, **không phải email khách hàng**. Không cần eCFR/FR API key. Hai Regulatory Admin độc lập vẫn cần để checklist và kích hoạt.

```bash
# Worker riêng, không thay label/OCR worker
npm run regulatory:worker

# Worker kèm daily schedule (idempotent UTC slot)
npm run regulatory:worker -- --schedule

# Hoặc scheduler/container gọi lệnh này mỗi ngày
npm run regulatory:worker -- --schedule-once

# Chỉ xử lý một job, hữu ích cho staging
npm run regulatory:worker -- --once

# Queue từ CLI trusted hoặc từ /knowledge
npm run regulatory:worker -- --enqueue ecfr_part101 --force
npm run regulatory:worker -- --enqueue ecfr_section --section 101.9
npm run regulatory:worker -- --enqueue ecfr_discovery --term "21 CFR 101.9"
npm run regulatory:worker -- --enqueue fr_monitor --term "food labeling" --start 2026-09-01 --end 2026-09-30 --part101-only
```

Các ngày trong lệnh monitor là ví dụ publication window, không là eCFR issue date. CLI load `.env.local` khi có; xem `--help` mà không cần credentials. Poll phải là integer 1.000–60.000 ms. Daily schedule enqueue fresh Part 101 hash check và 8 FDA legal terms với publication overlap 2 ngày. Sau downtime dài cần backfill có chủ đích bằng các cửa sổ ≤32 ngày; không giả định overlap 2 ngày đã bao phủ thời gian worker tắt.

Outbound chỉ HTTPS hai government hosts, không follow redirect, User-Agent có app/contact; timeout 30s, response/parser budget 20 MB. Rate limiter dùng Postgres để chia sẻ giữa các workers (1 reservation/second/upstream). Job lease 6 phút, heartbeat 30s, SKIP LOCKED, max **3 attempts tổng cộng**; HTTP client trong worker chỉ 1 attempt để không tạo 3×3 retries. Retry-After tối đa 1h; job queue xử lý backoff, không giữ request UI lâu.

- Retryable: network/timeout, 408/425/429/500/502/503/504, transient raw/monitoring storage failures.
- Terminal: invalid scope/contact/date, 400/401/403, parser/schema/coverage failures, body quá lớn, cache hash mismatch.
- Full XML 404: refresh titles **và structure** một lần nếu issue đổi; không fallback sang hôm nay.

## Cache, raw và provenance

Cache key = family + endpoint + sorted params. Dated full/structure paths và dated search chứa issue; FR queries chứa publication window. TTL: titles 6h, structure/search 24h, full XML/FR detail 30 ngày, FR searches 6h. Force refresh vẫn **ghi response mới**, không overwrite response cũ.

`regulatory-raw` là private bucket, `upload(upsert:false)`. Persist **exact decoded HTTP body bytes** trước khi parse (không tái tạo từ text hoặc serialize JSON lại), SHA-256, size, request URL, status, selected safe headers, retrieved/expiry timestamps, latency. HTTP compression đã được fetch giải nén; đây không phải hash của wire packet gzip. Invalid/error bodies trong budget cũng được giữ. Timeout không có body được ghi request event, không tạo một raw body giả.

- `regulatory_api_responses`: append-only metadata/raw reference.
- `regulatory_request_events`: HTTP và network failure monitoring, không lưu customer question/label.
- `regulatory_snapshots`: edition/raw hash/parser identity và approval lifecycle.
- `regulatory_snapshot_observations`: lần verify mới cùng body; không đổi timestamp đầu tiên của snapshot/report.
- `regulatory_snapshot_sections`, `regulatory_chunks`: normalized section/chunk hashes **khác raw hash**.
- `regulatory_snapshot_regressions`: immutable QA history, actual affected rule ids/versions/definition hashes và synthetic fixture outcomes.
- `regulatory_alerts`, ingestion jobs, schedule state, upstream reservations, retrieval counters.

Cùng edition/body/parser sẽ reuse snapshot và thêm observation. Cùng edition nhưng khác raw hash tạo snapshot mới + critical alert. Parser revision mới cũng tạo DRAFT khác dù raw body giống nhau. Không overwrite historical chunks/citations.

Raw Storage + raw response metadata chỉ Regulatory Admin/service. Cache reads bởi service được audit; admin raw link qua API được audit, signed URL sống 5 phút. Reviewer/system admin/customer không đọc raw. Staff có thể xem parsed draft/history để kiểm tra, **không đồng nghĩa được dùng chúng trong automatic RAG**.

## Parser / validation

Parser SAX (`saxes`) thực thi, không dùng regex để đọc toàn bộ XML tree. UTF-8 fatal decoding; DTD/XXE bị từ chối; bounds nodes/depth/body. Preserve raw XML và normalized HEAD/SECTNO/P/FP/NOTE/SOURCE/AUTH/table text, inline emphasis, hierarchy and cross-reference metadata.

- Citation lấy từ observed section/paragraph labels, dated canonical anchor.
- Explicit chains và italic numeric/roman levels được xử lý; ambiguous/unmarked deep labels giữ section-level `unresolved` evidence và warnings, **không đoán paragraph citation**.
- Footnote/note/table labels không được nhận làm paragraph path.
- Zero chunks, wrong/duplicate sections, malformed XML, thiếu section coverage đều fail-closed.
- `unresolved` paragraph chunks không vào retrieval. Warnings/hash/chunk-drop cần so sánh raw cụ thể và lý do regulatory trước khi phê duyệt.

**Giới hạn kiểm chứng quan trọng:** fixture `tests/fixtures/regulatory/part101-structural.xml` là **synthetic**, không phải body tải từ eCFR. Tài liệu API và rendered regulatory text đã được đối chiếu qua công cụ web; kết nối Node/curl HTTPS trực tiếp tới chính phủ từ sandbox thất bại trước TLS, nên chưa thu được byte-for-byte XML thật. **Không coi parser đã được qualified cho production chỉ vì synthetic tests pass.** Trước production phải lưu golden fixtures §§101.3, 101.7, 101.9 từ raw responses thật, đối chiếu labels/table/notes/citations toàn Part 101 và được hai chuyên viên xác nhận. Xem checklist staging dưới đây.

## Quy trình review / activation

1. Sync tạo FETCHED → parsed **DRAFT**. Active source/index không đổi.
2. Worker chạy code catalog fixtures và QA current **affected active rule definitions**. Không có customer labels trong fixtures; không thay rule definitions.
3. Regulatory Admin A kiểm tra raw/API URL/issue/title/hash/parser/citations/jurisdiction/affected rules/effective dates. Phân loại text-only / interpretation / mandatory conditions / exemption / claim criteria. `unknown` không được kích hoạt. Effective date chưa rõ phải explicit acknowledge; không lấy issue làm effective date.
4. Lưu checklist → REGULATORY_REVIEW. Admin B xem checklist read-only, raw và QA; xác nhận riêng để kích hoạt. Người tạo/người checklist không tự duyệt.
5. RPC kiểm tra hash, independent identity, parser/coverage/citations, **fresh passing affected-rule QA** và overlapping source baseline. Source activation và rule publication được serialize; stale QA phải chạy lại từ UI/API.
6. Atomically archive section source versions, supersede edition/chunks cũ, cập nhật registry `CURRENT` + `ingestion_status=ACTIVE`, approve chunks. Không tự thay conditions/interpretation của compliance rules.
7. Rules tham chiếu source version/hash cũ bị stale, cần draft/regression/reapprove trước review/report tiếp theo. PDF/JSON báo cáo đã phát hành giữ nguyên frozen source version, issue, raw/section hash, API URL và parser.

Withdrawal loại nguồn khỏi auto retrieval ngay; không xóa raw/history/reports. Có audit và lý do. Không thể dùng manual source editor để thay API-backed source.

## FDA Guidance · quy trình đánh giá chuyên gia (migration 0004)

Guidance của FDA **không phải quy định và không ràng buộc pháp lý**, nên không thể duyệt như một CFR section. eCFR/FR (regulations) đi theo mục “Quy trình review / activation” ở trên; tài liệu có `document_type` chứa _guidance/guideline_ đi theo quy trình riêng này:

1. Đăng ký draft như bình thường (bản chụp ≥ 80 ký tự, `retrieved_at`, URL chính thức, hash do DB tính từ nội dung).
2. **Admin A – đánh giá chuyên gia** (UI: Nguồn pháp lý → mở guidance DRAFT; hoặc RPC `vexim_review_guidance_source`): xác nhận 9 mục checklist (`document_identity`, `official_url`, `issue_date`, `content_hash`, `guidance_status`, `binding_effect`, `scope`, `citations_traceable`, `affected_rules`), phân loại tình trạng văn bản (final/draft/withdrawn/superseded), hiệu lực pháp lý (guidance FDA = `non_binding`) và mô tả phạm vi áp dụng ≥ 40 ký tự. Draft guidance cần thêm `draft_guidance_ack`; alert `critical` chưa xử lý cần `override_reason` ≥ 20 ký tự.
3. Nếu có rule ACTIVE trích dẫn nguồn này: chạy regression (`POST /regulatory/sources/:id/regression`) trên đúng hash hiện tại; kết quả do service ghi, không phải do client khai báo.
4. **Admin B – phê duyệt độc lập**: `vexim_approve_source` yêu cầu đánh giá chuyên gia còn tươi (đúng `version` + `content_hash`), người duyệt **khác** người đánh giá, tình trạng final/draft, `binding_effect = non_binding`. Khi đạt: source `CURRENT`, `ingestion_status = ACTIVE` và audit `regulatory.guidance_approved`.
5. Mọi thay đổi nội dung (version/hash mới) làm đánh giá cũ hết hiệu lực: phải đánh giá lại. Bản ghi đánh giá là append-only (`regulatory_guidance_reviews`), có RLS và trigger chống sửa/xóa.

Không có đường tắt: không tự động tạo đánh giá, không tự động duyệt, không seed nội dung hay chữ ký.

## Retrieval / RAG contract

`POST /api/v1/regulatory/knowledge/retrieve` là full-text PostgreSQL (English), không gọi LLM/government. Filters: topic, US_FEDERAL, dry_packaged_tea/tea_bag, review as-of, eCFR/FDA authority allowlist. Chỉ matching **ACTIVE snapshot + current registered section version/hash + APPROVED chunk**, effective/as-of hợp lệ, citation không unresolved. No lexical match trả `[]`, không giả hit hay missing-data pass. Tối đa 4×6.000 ký tự; `truncated` được ghi rõ.

Trả citation repository-owned gồm chunk/source/snapshot ids, registered version + source edition, citation/anchor/API URL, raw and chunk hashes, issue/retrieved time, parser, effective-date-unknown flag. Regulatory text và customer/OCR đều là **untrusted evidence, never instructions**. Không dùng frontend/LLM tự ghép một citation chưa registered.

`vexim_retrieve_regulatory_vector(vector(768), topic, scope, as_of, authorities, count)` có cùng version/filter/provenance contract. Embeddings **không tự sinh**, không có provider/data export mới. Legacy vector adapter đã loại API-stale/unresolved chunks; nên dùng contract mới khi triển khai provider đã duyệt.

Historical/superseded versions được xem qua snapshot detail/raw và frozen reports. Production retrieval theo as-of cũ **không tự hồi sinh** superseded editions: nếu current ACTIVE edition xuất hiện sau as-of, trả no hit/pending human review. Manual FDA legacy CURRENT sources vẫn phục vụ deterministic rules đã duyệt; full-text snapshot endpoint mới hiện lấy eCFR API-backed chunks, không quảng bá FDA guidance đã tự ingestion.

## Monitoring / UI

Dashboard aggregates không cap 2.000 requests: 24h requests/errors/429/latency/retrieval hits, parse failures, pending approvals, tuổi active theo **last verified observation**. Danh sách snapshot/jobs/alerts hiển thị 100 gần nhất; chunks phân trang 50 và count exact. Poll Supabase 15s; demo không HTTP government hoặc cập nhật production registry.

Alerts: failed/dead-letter/expired leases, 429/backoff, new issue, same-issue hash mismatch, parser/coverage/zero chunks, >20% chunk drop, active unverified >30 ngày, new FDA documents/final rule Part101. Review classification và affected rules là quyết định con người, không là diff/interpretation do LLM tự tạo.

## Staging acceptance còn phải chạy

1. Chạy migrations trên **Supabase thật**; RLS/Storage/signed URL/audit với 2 Regulatory Admin, reviewer, system admin và customer. Không chỉ dựa vào PGlite shims.
2. Outbound-capable worker + contact hợp lệ: fetch titles/current issue/structure/full Part101/sections/search; hash body exact, compression, cache/force behavior, header/status/time metadata.
3. Capture **raw upstream golden XML** §§101.3/101.7/101.9, compare hierarchy, every nested label incl. italic levels, tables, notes, source notes, duplicate/empty/coverage. Không dùng synthetic prose hoặc rendered HTML làm raw fixture. Run parser regression before any production activation.
4. Verify independent checklist/activation/withdrawal, active overlap/older downgrade race, parser revision, same-issue hash change, old report provenance, actual affected-rule QA failure/staleness and fresh rerun.
5. FR FDA/type/CFR/date/term/detail, >100 results, >2.000 rejection, official govinfo PDF verification, new task/alert nhưng **0 active rule edits**.
6. Two workers: lease/heartbeat/process kill, rate limit, max3 attempts, 429 Retry-After, network/storage failures, daily schedule/backfill and stale alert.
7. Retrieval lexical/vector scopes, inactive/future/superseded/unresolved exclusions; small bounded output, unknown effective-date human flag, no invented citations or regulatory instruction-following.

Không có live Supabase, live upstream ingestion, golden XML hoặc production law activation trong phiên sandbox này. Preview là demo riêng, không phải chứng nhận pháp lý.
