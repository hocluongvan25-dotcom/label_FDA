# Bộ Hồ Sơ Phê Duyệt Mẫu — Review Sign-off Dossier

## Trà sen túi lọc · AN NHIÊN

> **KIỂM SOÁT TÀI LIỆU — DRAFT / DỮ LIỆU DEMO TỔNG HỢP**
> Bộ hồ sơ này được dựng từ fixture demo trong repository để chuẩn bị cho **Independent Expert Review**. Đây **không phải** hồ sơ khách hàng đã xác minh, ý kiến pháp lý, kết luận tuân thủ, chứng nhận FDA, hay báo cáo cuối cùng. Không dùng để xuất khẩu, tiếp thị, thông quan hoặc thay thế hồ sơ thật.

| Trường | Giá trị |
|---|---|
| Mã hồ sơ mẫu | `SRD-ANHIEN-LOTUS-DEMO-001` |
| Mã review trong fixture | `30000000-0000-4000-8000-000000000001` |
| Mã sản phẩm trong fixture | `d0000000-0000-4000-8000-000000000001` |
| Nhãn được xem xét | v2 — hai file SVG minh họa, front/back |
| Tổ chức trong fixture | An Nhiên Tea |
| Ngày tổng hợp | 2026-10-03 |
| Trạng thái hồ sơ này | **DRAFT — CHỜ CHUYÊN GIA ĐỘC LẬP** |
| Quyết định reviewer | **Chưa có** |
| Báo cáo cuối | **Chưa phát hành** |

---

## 1. Tóm tắt quyết định đề xuất

**Đề xuất quản trị hồ sơ: HOLD — chưa phê duyệt; cần rà soát chuyên gia và bổ sung bằng chứng.** Đây là trạng thái chuẩn bị sign-off, không phải kết luận pháp lý.

Các mục cần xử lý trước khi có thể cân nhắc ký duyệt:

1. Cụm từ trên nhãn **“Naturally helps prevent diabetes”** cần chuyên gia phân loại trong đúng ngữ cảnh và xem xét hồ sơ chứng minh. Tín hiệu từ khóa không tự nó chứng minh vi phạm và không được tự động chuyển thành yêu cầu sửa.
2. Fixture không phát hiện Nutrition Facts; hồ sơ có đánh dấu yêu cầu đánh giá exemption nhưng chưa có tài liệu chứng minh điều kiện áp dụng. Không được tự động kết luận sản phẩm được miễn.
3. Trên nhãn mẫu đọc được “Distributed by AN NHIEN” nhưng chưa thấy địa chỉ của đơn vị này.
4. Độ tin cậy đọc hướng dẫn bảo quản chỉ **69%**; phải đối chiếu artwork/file gốc.
5. Nguồn và bộ quy tắc thật chưa đủ điều kiện sign-off: các snapshot/rule liên quan vẫn phải được truy xuất, kiểm tra hash/ngày hiệu lực/parser/citation và phê duyệt độc lập trong quy trình được kiểm soát.

Trong fixture, review đang ở trạng thái `HUMAN_REVIEW`; không có người phê duyệt (`approved_by` trống), không có quyết định triage được ghi nhận và không có final report cho case này. Không suy diễn trạng thái `AUTO_SCREENED` từ kết quả qualification nền tảng ở Bước 5.

---

## 2. Phạm vi và hồ sơ sản phẩm

Các giá trị dưới đây là **dữ liệu fixture/customer-input minh họa**; chuyên gia phải xác minh với hồ sơ thật.

| Hạng mục | Giá trị fixture | Ghi chú xác minh |
|---|---|---|
| Tên sản phẩm | Trà sen túi lọc | Tên hồ sơ demo |
| Thương hiệu | AN NHIÊN | Chưa đối chiếu nhãn pháp lý thật |
| Nhóm / dạng | `tea_bag` / túi lọc | Phân loại demo là `conventional_food`; cần xác nhận độc lập |
| Thị trường / kênh | Hoa Kỳ; retail và Amazon | Phạm vi đánh giá mẫu chỉ là US federal labeling MVP |
| Quy cách | 20 túi × 2 g | Khai báo trong fixture |
| Khối lượng tịnh | 1.41 oz (40 g) | Trích xuất mẫu: “NET WT 1.41 OZ (40 g)” |
| Công thức | Green tea leaves 96%; lotus flower 4% | Customer-input trong fixture; chưa có công thức ký xác nhận |
| Dị nguyên khai báo trong công thức | Không có trong fixture | Không thay thế rà soát supplier/cross-contact thực tế |
| Claim | “Naturally helps prevent diabetes” | Cần chuyên gia phân loại; không coi là kết luận vi phạm |
| Exemption | `exemption_requested=true` | Fixture ghi 20 FTE và 10.000 đơn vị US/12 tháng; chưa có chứng từ xác minh |
| Đơn vị/địa chỉ hồ sơ | An Nhiên Tea; Hà Nội, Việt Nam (dữ liệu mẫu) | Xác nhận pháp nhân và vai trò trên nhãn |
| Packer / distributor / importer trong dossier | Chưa điền đầy đủ | Làm rõ đơn vị chịu trách nhiệm và địa chỉ cần thể hiện |

### File nhãn và nguồn dữ liệu

- Review gắn với nhãn v2 và hai file SVG demo. Tên trong fixture gồm `lotus-front-v2.svg` và `tea-back-v2.svg`; preview dùng artwork mẫu trong `public/samples/`.
- File được đánh dấu `dev_unscanned`, SHA-256 là placeholder `DEMO_FIXTURE`; đây không phải bản gốc đã quét malware hay bản nộp của khách hàng.
- Các trường OCR/extraction bên dưới do `sampleFields()` tạo bằng nhãn dữ liệu demo (`demo-fixture · không phải kết quả OCR thực`). Không coi confidence là xác suất tuân thủ hoặc thay cho kiểm tra artwork.

### Trường trích xuất mẫu

| Trường | Giá trị mẫu | Confidence | Tình trạng bằng chứng |
|---|---|---:|---|
| Statement of identity | `LOTUS GREEN TEA` | 99% | Fixture; cần xem vị trí/mặt chính và artwork gốc |
| Net quantity | `NET WT 1.41 OZ (40 g)` | 98% | Fixture; chuyên gia xác minh cách thể hiện và artwork |
| Ingredient list | `Ingredients: Green tea leaves, lotus flower` | 97% | Fixture; đối chiếu công thức ký xác nhận và thứ tự |
| Nutrition Facts | Không phát hiện | 0% | Fixture ghi evidence dạng absence; không tự suy ra điều kiện miễn |
| Responsible party | `Distributed by AN NHIEN` | 96% | Không đọc thấy địa chỉ đi kèm trong fixture |
| Claim | `Naturally helps prevent diabetes` | 98% | Nội dung mẫu; cần review chuyên môn |
| Storage instruction | `Store in a cool, dry place. Keep away from sunlight.` | 69% | Cần đối chiếu file gốc độ phân giải cao |
| Country of origin | `Product of Vietnam` | 97% | Fixture; chưa kiểm chứng chứng từ xuất xứ |
| English required information | `detected` | 98% | Heuristic fixture; không phải kết luận đủ nhãn tiếng Anh |

---

## 3. Sổ vấn đề cần chuyên gia quyết định

Các finding dưới đây là finding của fixture mẫu; trạng thái ban đầu trong fixture là `open`. Chuyên gia ghi quyết định, căn cứ và bằng chứng thật vào cột cuối.

| ID / mức độ | Finding mẫu | Bằng chứng đang có | Việc chuyên gia cần làm | Trạng thái / ghi chú sign-off |
|---|---|---|---|---|
| `CLAIM-001` · Information | Claim bệnh lý cần chuyên gia phân loại | “Naturally helps prevent diabetes” | Đánh giá ngữ cảnh, ý nghĩa claim và tài liệu hỗ trợ; xác định route xử lý phù hợp. Không biến tín hiệu tự động thành kết luận vi phạm. | **PENDING** — ____________________ |
| `NUTRITION-001` · Major | Chưa phát hiện Nutrition Facts | Fixture có trường Nutrition Facts dạng absence; exemption được yêu cầu nhưng chưa có hồ sơ | Xác minh quy định/phạm vi hiện hành và điều kiện exemption có liên quan; yêu cầu tài liệu khách hàng cần thiết. Không tự động xác nhận exemption. | **PENDING** — ____________________ |
| `PARTY-001` · Major | Thiếu địa chỉ đơn vị phân phối | Đọc được `Distributed by AN NHIEN`, không có địa chỉ trong fixture | Xác định đúng pháp nhân/vai trò và đối chiếu tên, địa chỉ trên artwork thật. | **PENDING** — ____________________ |
| `LABEL-001` · Minor | Hướng dẫn bảo quản cần xác minh | Confidence 69% cho storage instruction | Mở artwork gốc, xác nhận nguyên văn, khả năng đọc và vị trí; sửa extraction nếu cần, không suy diễn từ confidence. | **PENDING** — ____________________ |

### Các điểm rà soát diện rộng

- Xác nhận identity, khối lượng tịnh, ingredient statement, ngôn ngữ, panel và mức độ dễ đọc trên **bản nhãn cuối cùng**.
- So sánh công thức ký xác nhận với ingredient list; xác minh nguyên liệu, tỷ lệ và kiểm soát dị nguyên/cross-contact theo hồ sơ thật.
- Xác định sản phẩm thuộc scope trà khô/túi lọc conventional food hay cần chuyên gia chuyển sang scope khác.
- Kiểm tra claim substantiation, intended use và các tài liệu kỹ thuật liên quan; không đưa ra kết luận chỉ từ OCR/keyword.
- Ghi rõ phần nào ngoài phạm vi review MVP hoặc cần tư vấn chuyên môn riêng.

---

## 4. Source/rule baseline — chưa đủ điều kiện phê duyệt

### Trạng thái cần giữ

- Snapshot `197c2171-c4e8-46c8-8456-4e70b1ccde14` vẫn là **DRAFT**, ngoài RAG/ACTIVE.
- Toàn bộ **15-rule tea Rule Pack thật** vẫn **DRAFT**, chờ independent expert review.
- `auto_issuance` và `pre_screening_enabled` trên staging/production phải tiếp tục **disabled** cho tới khi có phê duyệt rõ ràng và quy trình change control riêng.
- Bộ hồ sơ này không phê duyệt, kích hoạt, sửa hoặc thay thế bất kỳ source snapshot/rule/version/flag nào.

> **Cảnh báo demo:** `createSeedData()` trong local UI có thể giả lập nguồn `CURRENT`, rule `ACTIVE`, hash lặp và trạng thái regression đạt để minh họa giao diện. Các giá trị đó không phải registry pháp lý. Migrations/production seed cố ý để nguồn và rule ở `DRAFT`; không dùng trạng thái demo làm bằng chứng sign-off.

### Danh mục nguồn dự kiến để chuyên gia kiểm tra

Đây là mapping trong source/rule catalog, **không xác nhận nội dung, phiên bản, ngày hiệu lực, parser coverage, citation precision hoặc approval hiện hành**. Cần lấy snapshot thật, lưu raw hash, kiểm tra effective date/citation và phê duyệt độc lập trước khi dùng.

| Source key | Nguồn dự kiến trong catalog | Liên kết đích để đối chiếu |
|---|---|---|
| `ecfr-101-3` | 21 CFR 101.3 — statement of identity | [eCFR §101.3](https://www.ecfr.gov/current/title-21/section-101.3) |
| `ecfr-101-7` | 21 CFR 101.7 — net quantity | [eCFR §101.7](https://www.ecfr.gov/current/title-21/section-101.7) |
| `ecfr-101-4` | 21 CFR 101.4 — ingredient designation | [eCFR §101.4](https://www.ecfr.gov/current/title-21/section-101.4) |
| `ecfr-101-9` | 21 CFR 101.9 — nutrition labeling | [eCFR §101.9](https://www.ecfr.gov/current/title-21/section-101.9) |
| `fda-allergens` | FDA food allergen labeling Q&A | [FDA guidance page](https://www.fda.gov/food/food-allergensgluten-free-guidance-documents-regulatory-information/frequently-asked-questions-food-allergen-labeling-guidance-industry) |
| `fda-label-claims` | FDA label claims guidance | [FDA claims page](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements) |
| `ecfr-101-13` | 21 CFR 101.13 — nutrient content claims | [eCFR §101.13](https://www.ecfr.gov/current/title-21/section-101.13) |
| `ecfr-101-5` | 21 CFR 101.5 — name/place of business | [eCFR §101.5](https://www.ecfr.gov/current/title-21/section-101.5) |
| `ecfr-101-15` | 21 CFR 101.15 — prominence/readability | [eCFR §101.15](https://www.ecfr.gov/current/title-21/section-101.15) |
| `fda-small-business` | FDA small-business nutrition labeling exemption materials | [FDA exemption page](https://www.fda.gov/food/labeling-nutrition-guidance-documents-regulatory-information/small-business-nutrition-labeling-exemption) |
| `usda-organic` | 7 CFR Part 205 — National Organic Program | [eCFR Part 205](https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205) |
| `fda-food-label-guide` | FDA Food Labeling Guide (guidance) | [FDA guide PDF](https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf) |

### Rule-to-source map trong catalog

| Rule key | Chủ đề | Source key dự kiến |
|---|---|---|
| `IDENTITY-001` | Tên gọi thực phẩm | `ecfr-101-3` |
| `NETQTY-001` | Khối lượng tịnh | `ecfr-101-7` |
| `INGREDIENT-001` | Danh sách nguyên liệu | `ecfr-101-4` |
| `NUTRITION-001` | Nutrition Facts / exemption | `ecfr-101-9`, `fda-small-business` |
| `NUTRITION-002` | Nutrition claim khi đề nghị exemption | `ecfr-101-9`, `ecfr-101-13`, `fda-small-business` |
| `ALLERGEN-001`, `ALLERGEN-002` | Dị nguyên / sesame | `fda-allergens` |
| `CLAIM-001` | Disease claim signal | `fda-label-claims` |
| `CLAIM-002` | Nutrient content claim | `ecfr-101-13` |
| `CLAIM-003` | Natural/organic/non-GMO claim | `fda-label-claims`, `usda-organic` |
| `FORMULA-001` | Đối chiếu công thức và ingredient list | `ecfr-101-4` |
| `LABEL-001`, `LABEL-002` | Độ đọc / thông tin tiếng Anh | `ecfr-101-15` |
| `PARTY-001` | Tên/địa chỉ/đơn vị chịu trách nhiệm | `ecfr-101-5` |
| `CLASS-001` | Phân loại và scope | `fda-label-claims`, `fda-food-label-guide` |

---

## 5. Quy trình Independent Expert Review

### A. Kiểm tra độc lập và phạm vi

- [ ] Reviewer không phải người soạn/đề xuất rule/source đang được duyệt; không có xung đột lợi ích đã biết.
- [ ] Ghi rõ năng lực/chuyên môn, tổ chức, phạm vi thẩm quyền và ngày review.
- [ ] Xác nhận review chỉ bao gồm nhãn v2 và hồ sơ thực nhận; liệt kê mọi nội dung ngoài phạm vi.
- [ ] Xác nhận các file bằng chứng là bản gốc/phiên bản cuối, có mã/hash và lịch sử tiếp nhận xác minh được.

### B. Kiểm tra sản phẩm và findings

- [ ] Đối chiếu claim với ngữ cảnh, substantiation và hướng dẫn áp dụng; ghi riêng phân loại claim và căn cứ.
- [ ] Xác minh Nutrition Facts/exemption theo tài liệu thật; ghi chính xác các giả định và thiếu sót.
- [ ] Xác minh tên, địa chỉ, vai trò của manufacturer/packer/distributor/importer cần thể hiện.
- [ ] Đọc lại storage statement trên artwork gốc và cập nhật extraction/evidence nếu khác fixture.
- [ ] Xác minh identity, net quantity, ingredient list, formula, ngôn ngữ, thị trường và phân loại sản phẩm.
- [ ] Mỗi finding có disposition, căn cứ/source version, evidence reference và người chịu trách nhiệm.

### C. Kiểm tra source/rule provenance

- [ ] Tải raw source đúng endpoint và đúng phiên bản; lưu retrieval timestamp, HTTP metadata và SHA-256.
- [ ] Kiểm tra issue/effective date; không lấy ngày xuất bản thay cho effective date.
- [ ] Kiểm tra parser version, coverage, citation syntax **và** paragraph-path resolution; unresolved paths phải có badge cảnh báo và không được dùng cho automated issuance.
- [ ] Xác minh regression test gắn đúng source snapshot/content hash và rule definition hash.
- [ ] Đảm bảo người approve độc lập với người tạo; lưu audit trail.
- [ ] Chỉ sau các bước trên mới xem xét phê duyệt rule/source revision mới. Không sửa hoặc promote snapshot/rule hiện có bằng cách ghi đè.

### D. Kiểm tra phát hành và change control

- [ ] Final report chỉ được tạo sau reviewer action theo workflow được phê duyệt.
- [ ] Mọi pre-screen artifact (nếu đủ điều kiện được bật riêng ở staging) phải giữ `PRE_SCREENING_ONLY` và không được biến thành final report.
- [ ] Tenant isolation, audit history, unresolved-citation warning và phiên bản source/rule được kiểm tra trên đúng môi trường.
- [ ] Ghi rõ staging qualification không đồng nghĩa production activation; production flags vẫn disabled.

---

## 6. Phiếu quyết định của chuyên gia độc lập

**Không điền sẵn quyết định thay chuyên gia.**

| Trường sign-off | Nội dung do chuyên gia điền |
|---|---|
| Họ tên / chức danh / chuyên môn | ______________________________ |
| Tổ chức / thông tin chứng chỉ liên quan | ______________________________ |
| Tuyên bố độc lập / xung đột lợi ích | ______________________________ |
| Ngày review / múi giờ | ______________________________ |
| Artwork và hồ sơ đã đối chiếu (tên, version, hash) | ______________________________ |
| Source snapshots/version/hash đã kiểm tra | ______________________________ |
| Rule pack revision/hash đã kiểm tra | ______________________________ |
| Finding dispositions và căn cứ | ______________________________ |
| Phần ngoài scope / giả định / giới hạn | ______________________________ |
| Quyết định | ☐ Chấp thuận trong scope ghi rõ ☐ Chấp thuận có điều kiện ☐ Yêu cầu sửa/bổ sung ☐ Không thể kết luận ☐ Không chấp thuận |
| Điều kiện/việc cần làm trước phát hành | ______________________________ |
| Chữ ký / ngày | ______________________________ |

**Tách biệt phê duyệt:** Product review sign-off không tự động phê duyệt source snapshot, parser, rule definition, regression test, staging allowlist hay production configuration. Mỗi phần cần đúng reviewer độc lập và audit trail riêng.

---

## 7. Bằng chứng qualification Bước 5 — chỉ ở mức nền tảng

Bước 5 **Local Synthetic Qualification** được xác nhận đạt các chốt an toàn kỹ thuật trong môi trường cô lập: artifact kiểm tra mang `PRE_SCREENING_ONLY`, không tự tạo/phê duyệt final report, tenant/audit checks chạy trên fixture, và UI hiển thị badge đỏ `Paragraph paths · EXPERT REVIEW REQUIRED` cho citation path unresolved.

**Giới hạn quan trọng:** các run này dùng label/registry synthetic riêng, in-memory PGlite/test adapter, local OCR và ClamAV responder mô phỏng. Chúng **không phải** kết quả phân tích sản phẩm Trà sen túi lọc, không phải xác nhận nguồn luật thật, và không phải live Supabase/Storage/ClamAV staging qualification.

Tóm tắt kiểm tra local ngày 2026-10-03:

- Vitest: 10 file, **165/165** test pass.
- Browser bundled E2E local: **6/6** workflow pass.
- Typecheck và lint: pass.
- Các kiểm tra bổ sung dùng fixture tạm: positive synthetic pipeline, unresolved-citation warning UI và paragraph-path warning badge pass; fixture tạm đã được dọn sau khi chạy.
- Live authenticated staging qualification: **chưa thực hiện**.
- `npm ci` báo **5 high-severity dependency advisories**; cần security triage riêng trước khi cân nhắc deployment. Qualification này không tự sửa hoặc miễn trừ các cảnh báo đó.

---

## 8. Tài liệu cần thu thập trước khi ký

1. Artwork gốc cuối cùng cho mặt trước/sau, định dạng đủ độ phân giải và hash/version xác minh được.
2. Công thức do doanh nghiệp/người có thẩm quyền ký xác nhận; tài liệu nguyên liệu và thông tin dị nguyên liên quan.
3. Claim substantiation và bối cảnh sử dụng cho cụm từ claim đang review.
4. Tài liệu thực tế để chuyên gia đánh giá yêu cầu exemption; dữ liệu bán hàng/quy mô doanh nghiệp theo tiêu chí hiện hành nếu được yêu cầu.
5. Tên pháp lý, địa chỉ và vai trò của bên chịu trách nhiệm trên nhãn.
6. Raw source snapshots chính thức, effective-date record, parser/citation QA, regression evidence và approvals độc lập cho mọi source/rule được dùng.
7. Biên bản quyết định từng finding, người quyết định, lý do và bằng chứng đính kèm.

---

## 9. Tham chiếu nội bộ và lưu ý kiểm soát

- Dữ liệu pilot mẫu: `src/lib/seed.ts` (`Trà sen túi lọc`, review fixture và findings).
- Catalog nguồn/quy tắc: `src/lib/regulatory.ts`.
- Quy tắc triage/phát hành: `src/lib/triage.ts` và `docs/RISK_TRIAGE.md`.
- Kiểm thử: `tests/worker.test.ts`, `tests/triage.test.ts`, `tests/database.test.ts`, `tests/e2e/workflows.spec.ts`, `tests/e2e/knowledge.spec.ts`.
- Tình trạng thực tế cần bảo toàn: snapshot `197c2171-c4e8-46c8-8456-4e70b1ccde14` là DRAFT/out of RAG/ACTIVE; 15-rule tea pack là DRAFT; `auto_issuance` và `pre_screening_enabled` trên staging/production tiếp tục disabled.

**Kết luận của bản mẫu:** `PENDING INDEPENDENT EXPERT REVIEW — NOT APPROVED — NO FINAL REPORT ISSUED`.
