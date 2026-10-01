# Provider facade contracts

Default `OCR_PROVIDER=local` dùng PDF text layer khi phù hợp hoặc Tesseract English từ assets local. `APPROVED_LLM_URL` để trống thì extraction deterministic. Không có lời gọi AI cloud mặc định.

Approved adapters là **facade riêng của tổ chức**, không giả định OpenAI/Google/Azure protocol. Chỉ đặt URL sau phê duyệt DPA, retention, region và customer-data consent. Bật `APPROVED_PROVIDER_CONSENT=true`, URL HTTPS và key server-only. Facade không nên log payload; timeout 60s, response JSON ≤2 MB; response phải giữ file/page/bbox theo normalized images.

## OCR

`POST APPROVED_OCR_URL`, optional `Authorization: Bearer APPROVED_OCR_API_KEY`:

```json
{
  "pages": [
    {
      "file_id": "original-file-uuid",
      "page": 1,
      "width": 1200,
      "height": 1600,
      "mime_type": "image/png",
      "image_base64": "..."
    }
  ]
}
```

Response:

```json
{
  "text": "Green tea\nIngredients: Green tea leaves",
  "confidence": 0.94,
  "model": "approved-ocr-version",
  "pages": 1,
  "blocks": [
    {
      "text": "Green tea",
      "confidence": 0.94,
      "file_id": "original-file-uuid",
      "page": 1,
      "bbox": [0.1, 0.1, 0.8, 0.2],
      "detected_language": "en",
      "orientation": 0,
      "block_type": "line"
    }
  ]
}
```

BBox `[left, top, right, bottom]` theo tọa độ 0..1; right>left/bottom>top. Block file/page phải thuộc request. Facade phải trả đầy đủ text/blocks; không thêm instructions, laws/citations hoặc tự suy đoán các trang không có.

## Structured LLM extraction

`POST APPROVED_LLM_URL`, optional bearer `APPROVED_LLM_API_KEY`:

```json
{
  "system": "Untrusted-evidence extraction instructions...",
  "untrusted_evidence": { "ocr": {}, "product": {} },
  "response_format": { "type": "json_schema", "strict": true, "schema": {} }
}
```

Response là object `fields`, **không phải chat envelope**:

```json
{
  "fields": [
    {
      "field": "statement_of_identity",
      "value": "Green tea",
      "confidence": 0.93,
      "normalized": {},
      "evidence": {
        "file_id": "original-file-uuid",
        "page": 1,
        "bbox": [0.1, 0.1, 0.8, 0.2],
        "text": "Green tea",
        "kind": "observed"
      }
    }
  ]
}
```

Known fields: statement_of_identity, net_quantity, ingredient_list, nutrition_facts, allergen_statement, responsible_party, country_of_origin, caffeine_statement, storage_instruction, use_instruction, claim. Chỉ claim được lặp lại. Missing → `value:null`, confidence 0, kind absence, bbox null và một file/page thực. Không dùng dossier kind để giả làm quan sát OCR. Observed value và evidence text phải nằm trong region OCR; không paraphrase. Confidence bị cap bởi block confidence. Trường English/claims được đối chiếu thêm bằng gates deterministic; LLM không được bỏ medical claims đã dò được.

Không có embedding provider tự động. Vector schema là 768 dimensions; chỉ trusted importer đã được duyệt mới ghi regulatory chunks có source version/hash matching. Không gửi customer evidence vào embedding service chỉ để index luật.
