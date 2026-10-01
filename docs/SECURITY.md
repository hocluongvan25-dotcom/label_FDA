# Chốt an toàn và giới hạn

- Supabase `getUser` xác minh bearer; actor lấy từ active profile/membership trong DB, không lấy role do client gửi. Mỗi request qua JWT/RLS; các writes dùng SECURITY DEFINER RPC có kiểm tra tenant/role và search_path cố định.
- Business tables không cấp INSERT/UPDATE/DELETE cho authenticated. Staff provisioning chỉ từ trusted service/DB owner. System Admin không có regulatory/reviewer privileges.
- Original byte manifest, version identity, submitted dossier, source archives, report snapshot và audit đều bất biến bằng triggers. File bytes không overwrite; thay đổi nhãn là version mới.
- Buckets private; signed URLs 5 phút, chỉ clean scan cho originals/normalized. Lượt cấp/mở/tải được ghi audit. URL đã phát hành có thể còn dùng được đến khi hết hạn, kể cả khi membership vừa bị khóa.
- ClamAV chạy trước native parsing/OCR/model ở worker. Dev bypass không cấp quyền đọc/duyệt. Magic, size, SHA, pages/pixels/budget được kiểm tra; invalid/unsafe inputs không trả pass.
- Lease/owner checks trước worker writes; 3 attempts, persisted intermediate outputs và dead-letter. Queue kết thúc bằng trạng thái cần human, không phải approval.
- OCR/dossier là untrusted evidence. Local OCR mặc định; approved facades cần consent + HTTPS, không follow redirects, timeout 60s, JSON response ≤2 MB. Extraction kiểm tra file/page/region, observed wording, schema, bbox và confidence; deterministic language/claim gates không bị model thay thế. Không dựa vào model để bịa luật/citation.
- Only registered/current citations, matching rule/source snapshots; expired/changed law không dùng để phát hành kết luận mới. Source excerpts được human đối chiếu; không tự tuyên bố metadata seed là nội dung luật.
- Dismiss/edit cần lý do; report duyệt bằng reviewer JWT riêng. PDF/JSON chỉ ghi ba scoped outcomes; luôn disclaimer không phải FDA approval/certification.
- React escape text; không render HTML từ OCR. Uploaded SVG/HTML không được chấp nhận. CSV bảo vệ các ô bắt đầu formula. Provider errors không log response chứa nhãn hoặc keys.

## Trước production

Chưa kiểm chứng live Supabase Auth/Storage/SMTP/Realtime hoặc ClamAV thật trong phiên này. Local SQL tests dùng auth/storage shim và protocol tests dùng scanner giả lập; xem checklist staging.

Bổ sung WAF/API & auth rate limits, quota per organization, monitoring worker/definitions, least-privilege deployment network, backups/PITR, retention/deletion policy có kiểm soát, incident response, dependency updates và đánh giá penetration/security review. Service key/DB owner nằm ngoài application RBAC và phải được quản lý như quyền cao nhất.

LocalStorage/IndexedDB của **demo** và intake drafts trên thiết bị không được mã hóa. Không dùng máy chia sẻ cho dữ liệu nhạy cảm; dọn site storage nếu cần. Demo không phải sandbox an toàn cho file không tin cậy.

PDF text layer/OCR có thể khác nội dung nhìn thấy; confidence là khả năng trích xuất, **không phải xác nhận tuân thủ**. Phải đối chiếu bản gốc bằng người; checks hiện tại không chứng nhận kích thước chữ, Nutrition Facts layout, dữ liệu dinh dưỡng, botanical classification hay chứng nhận ngoài MVP. Không bảo đảm hệ thống dò hết mọi medical claim.

## Government API knowledge ingestion

- Fixed legal queries + HTTPS eCFR/FR hosts + contact User-Agent; no customer label, formula, OCR or PII transmitted to government APIs. No redirect following. Timeout/body bounds and DB-shared rate limiter.
- `regulatory-raw` private; raw body/metadata admin/service only. Auth Storage policy grants no raw write/delete/overwrite; service upload always `upsert:false`. Raw/cache access audited, signed URLs 5min. SHA/size rechecked on cache download.
- Immutable raw/parsed identities, snapshot observations and QA histories. Parser rejects DTD/XXE; unresolved numbering cannot become paragraph citation or retrieval evidence. Full upstream fixtures must still be qualified in staging.
- Staff can inspect draft/history; production retrieval uses only active/approved current matching versions and dates. Regulatory text is untrusted evidence, never executable prompt instructions. Customer questions for DB retrieval are not forwarded upstream.
- Independent source activation checks hash, source overlap, classification/effective acknowledgment and fresh affected-rule QA. No automatic rule editing/approval from API/search/FR document. Published reports retain frozen provenance.
- FDA guidance remains separate manual workflow; openFDA does not substitute CFR. See [Regulatory Knowledge](REGULATORY_KNOWLEDGE.md) for live acceptance requirements.
