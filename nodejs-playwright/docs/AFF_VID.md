# AFF VID

AFF VID biến dữ liệu từ AI Research Intelligence thành kế hoạch video affiliate ngắn có cấu trúc, sẵn sàng cho n8n, backend render video, hoặc luồng auto posting.

## Mục Tiêu

- Chọn sản phẩm/ngách từ dữ liệu research thật trong `product_trend_results`.
- Sinh video plan cho TikTok, Facebook Reels, Instagram Reels.
- Output JSON sạch, dễ debug, dễ đưa vào n8n.
- Tối ưu video ngắn: hook nhanh, script rõ, shot list quay được, CTA an toàn, caption/hashtag có mục tiêu chuyển đổi.

## Input

AFF VID không tự bịa sản phẩm. Luồng bắt đầu từ:

- `product_trend_results.raw_data`
- `product_trend_results.product_id`
- `product_trend_results.category`
- `product_trend_results.source_window`
- Bộ lọc UI/API: `date`, `market`, `window`, `platform_targets`

API lấy candidate:

```http
GET /api/research/aff-vid/source-products?date=2026-05-11&market=vn&window=today&limit=12
```

API sinh plan:

```http
POST /api/research/aff-vid/generate
Content-Type: application/json

{
  "product_id": "skincare_retinol_serum__today",
  "platform_targets": ["TikTok"],
  "video_duration": "30-45s",
  "tone": "review thực tế",
  "cta_type": "affiliate_click",
  "creator_persona": "reviewer tiếng Việt",
  "affiliate_url": null,
  "language": "vi"
}
```

## Flow cập nhật theo stage

1. Stage 1 - Chọn nguồn: UI lấy sản phẩm từ `product_trend_results` qua `date`, `market`, `window`, `category`. Nếu user chưa chọn ngày, API dùng ngày mới nhất có data cho Trends V4.
2. Stage 2 - Setup video: user chọn platform, độ dài, tone, CTA type, creator persona và affiliate URL.
3. Stage 3 - Generate: backend gọi prompt `aff_vid`, ép JSON sạch và normalize fallback nếu Gemini thiếu field.
4. Stage 4 - Export: JSON plan có thể copy, đưa sang UP POST hoặc n8n render/up post.

## Date / Empty handling

- Không truyền `date`: API tự resolve `latest_available` theo dữ liệu thật.
- Có truyền `date`: API chỉ trả dữ liệu đúng ngày đó.
- Không có dữ liệu: response `meta.empty_reason` giải thích thiếu ngày/window nào và UI hiển thị ngày gần nhất có data.
- AFF VID không tự bịa sản phẩm khi Trends V4 rỗng.

## Output

Mỗi video plan bắt buộc có:

```json
{
  "product_id": "string",
  "product_name": "string",
  "niche": "string",
  "angle": "string",
  "hook": "string",
  "script": ["string"],
  "shot_list": [
    {
      "shot": 1,
      "visual": "string",
      "on_screen_text": "string",
      "duration_seconds": 3,
      "note": "string"
    }
  ],
  "CTA": "string",
  "caption": "string",
  "hashtags": ["#string"],
  "platform_targets": ["TikTok"],
  "confidence_score": 0,
  "priority_score": 0,
  "viral_fit_score": 0,
  "source_research": {
    "trend_score": 0,
    "confidence_score": 0,
    "growth_signal": "string",
    "source_window": "today"
  },
  "missing_fields": [],
  "fallback_notes": []
}
```

Plans được lưu ở bảng `aff_video_plans` để n8n/backend có thể lấy lại:

```http
GET /api/research/aff-vid/plans?limit=20
GET /api/research/aff-vid/plans?product_id=skincare_retinol_serum__today
```

## Flow Xử Lý

1. User mở AFF VID.
2. UI gọi `/source-products` theo ngày/window hiện tại.
3. Backend chỉ đọc từ `product_trend_results`, sort theo `trend_score`, `confidence_score`, `created_at`.
4. User chọn product.
5. UI gọi `/generate` với `product_id` và platform.
6. Backend fetch product gốc, render prompt `aff_vid`, gọi Gemini.
7. Backend normalize output, kiểm tra field bắt buộc, tính lại score nếu thiếu.
8. Backend lưu JSON vào `aff_video_plans`.
9. UI hiển thị JSON để copy hoặc để n8n lấy qua API.

## Schema Dữ Liệu

Bảng `aff_video_plans`:

- `id`: UUID
- `product_id`: FK tới `product_trend_results.product_id`
- `plan_data`: JSONB chứa video plan
- `status`: `draft` mặc định
- `platform_targets`: mảng text
- `source_window`: `today`, `last_3_days`, `last_7_days`
- `schema_version`: `AFF_VID_V1`
- `created_at`, `updated_at`

## Rules Chất Lượng

- Không dùng sản phẩm ngoài `product_trend_results`.
- Không claim giá, giảm giá, review, nguồn bán nếu input không có.
- Hook dưới 18 từ, phải có pain/result/curiosity gap.
- Script 4-7 câu thoại, quay được trong 20-45 giây.
- Shot list 4-7 cảnh, mỗi cảnh có visual, text màn hình, thời lượng, note.
- Hashtag 6-12 tag, bắt đầu bằng `#`, không có khoảng trắng.
- CTA an toàn, không dùng fake urgency.
- `priority_score` theo công thức:

```text
trend_score * 0.45 + confidence_score * 0.35 + viral_fit_score * 0.20
```

## Error Handling

- Không có `product_id`: trả `400`.
- `product_id` không tồn tại trong research: trả `404`.
- Gemini lỗi: backend tạo fallback plan từ dữ liệu research gốc, thêm lý do vào `fallback_notes`.
- Input thiếu field: ghi rõ trong `missing_fields`.
- Output Gemini thiếu score: backend tự tính lại bằng rule cố định.

## Tracking

- API usage được ghi qua `callGemini` endpoint `aff_vid`.
- Plan sinh ra được lưu DB để audit.
- `source_research` giữ trend/confidence/source_window gốc.
- `missing_fields` và `fallback_notes` giúp debug vì sao plan yếu.

## n8n Contract

n8n nên gọi:

1. `GET /api/research/aff-vid/plans?limit=20`
2. Lọc `status = draft`
3. Lấy `plan_data.shot_list`, `script`, `caption`, `hashtags`, `CTA`
4. Render video bằng template riêng
5. Khi có API update status, đổi plan sang `rendered` hoặc `posted`

Hiện tại repo mới có read/generate. Bước sau nên thêm `PATCH /api/research/aff-vid/plans/:id/status`.
