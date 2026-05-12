# UP POST

UP POST biến content đã chuẩn bị từ AFF VID hoặc AI Research thành bài đăng hoàn chỉnh theo từng nền tảng, sẵn sàng đưa vào publishing queue hoặc n8n.

## Mục Tiêu

- Nhận input từ `aff_video_plans` hoặc `product_trend_results`.
- Sinh post variant riêng cho Threads, Facebook, TikTok caption, Facebook video post.
- Chuẩn hóa output thành JSON để queue publishing xử lý.
- Lưu draft để tracking, A/B test, và auto scheduling về sau.

## Input

Nguồn ưu tiên:

1. `aff_video_plans.plan_data`: source tốt nhất vì đã có hook, script, CTA, caption, hashtag.
2. `product_trend_results.raw_data`: fallback khi chưa có AFF VID.

API lấy source:

```http
GET /api/research/up-post/sources?source_type=aff_vid&limit=20
GET /api/research/up-post/sources?source_type=research&limit=20
```

API sinh post variants:

```http
POST /api/research/up-post/generate
Content-Type: application/json

{
  "source_content_id": "aff_video_plan_uuid_or_product_id",
  "source_type": "aff_vid",
  "platforms": ["threads", "facebook", "tiktok_caption", "facebook_video"],
  "scheduled_time": null,
  "campaign_tag": "may-viral-test",
  "post_type": null,
  "tone": "rõ ràng, có CTA",
  "cta_type": "engagement_or_click"
}
```

## Flow cập nhật theo stage

1. Stage 1 - Chọn source: ưu tiên `aff_video_plans`; có thể đổi sang `product_trend_results`.
2. Stage 2 - Chọn platform: Threads, Facebook, TikTok caption, Facebook video post. Mỗi platform phải có body riêng.
3. Stage 3 - Setup lịch: user nhập scheduled time, campaign tag, post type, tone và CTA type.
4. Stage 4 - Queue handoff: draft được lưu ở `up_post_variants`, sau đó `enqueue` đổi status sang `queued`.

## Date / Empty handling

- Không truyền `date`: API tự lấy ngày mới nhất có source theo `source_type`.
- Có truyền `date`: API chỉ lấy source/draft đúng ngày đó.
- Không có source: UI hiển thị lý do, ngày gần nhất có data và hướng dẫn tạo AFF VID hoặc đổi source.
- Không dùng một bài chung cho tất cả nền tảng; backend có bước kiểm tra trùng body và tự áp framing theo platform nếu Gemini trả lời yếu.

## Output

Mỗi post phải có:

```json
{
  "post_id": "string",
  "source_content_id": "string",
  "platform": "threads",
  "title": "string",
  "body": "string",
  "hook": "string",
  "CTA": "string",
  "hashtags": ["#tag"],
  "post_type": "text",
  "scheduled_time": null,
  "confidence_score": 0,
  "platform_fit_score": 0,
  "validation_warnings": []
}
```

Response tổng:

```json
{
  "source_content_id": "string",
  "source_type": "aff_vid",
  "warnings": [],
  "posts": []
}
```

## Flow Xử Lý

1. User mở UP POST.
2. UI gọi `/up-post/sources`.
3. User chọn source content và các nền tảng.
4. Backend lấy source từ `aff_video_plans` hoặc `product_trend_results`.
5. Backend gọi prompt `up_post`, ép JSON sạch.
6. Backend normalize từng post theo platform, thêm warning nếu thiếu hook/CTA/summary.
7. Backend lưu từng variant vào `up_post_variants`.
8. UI hiển thị JSON.
9. User bấm `Đưa vào queue`, backend đổi status sang `queued`.
10. n8n/backend lấy `queue_payload` để render/post.

## Platform Rules

- Threads:
  - Ngắn, gọn, tò mò.
  - 1-3 đoạn ngắn.
  - Ít hashtag, giọng trò chuyện.

- Facebook:
  - Rõ ý, có ngữ cảnh.
  - Có lợi ích, lý do, CTA.
  - Body có thể dài hơn Threads.

- TikTok caption:
  - Hook mạnh ở đầu.
  - Nhịp nhanh, ít lan man.
  - Có hành động rõ: xem link, comment, lưu lại.

- Facebook video post:
  - Body gắn với video.
  - Nói rõ người xem sẽ thấy gì trong video.
  - CTA rõ, tránh claim quá đà.

## Schema Dữ Liệu

Bảng `up_post_variants`:

- `id`: UUID
- `post_id`: unique deterministic id
- `source_content_id`: id của AFF VID plan hoặc product id
- `source_type`: `aff_vid` hoặc `research`
- `platform`: `threads`, `facebook`, `tiktok_caption`, `facebook_video`
- `post_data`: JSONB post đầy đủ
- `status`: `draft`, `queued`, sau này mở rộng `posting`, `posted`, `failed`
- `queue_payload`: JSONB tối giản cho n8n/publisher
- `scheduled_time`: timestamp hoặc null
- `schema_version`: `UP_POST_V1`

## Validation

Backend luôn normalize:

- Thiếu `hook`: lấy dòng đầu từ body/source.
- Thiếu `CTA`: dùng CTA an toàn mặc định.
- Thiếu hashtag: dùng fallback tag an toàn.
- Platform không hợp lệ: loại bỏ.
- Không có platform hợp lệ: trả `400`.
- Source không tồn tại: trả `404`.

Nếu source content chưa đủ tốt:

- Vẫn tạo draft bảo thủ.
- Ghi cảnh báo vào `warnings` và `validation_warnings`.
- Giảm `confidence_score` khi thiếu hook/CTA/product context.

## Queue / Publish Handoff

Đưa variants vào queue:

```http
POST /api/research/up-post/enqueue
Content-Type: application/json

{
  "post_ids": ["source_threads", "source_facebook"]
}
```

n8n/backend đọc:

```http
GET /api/research/up-post/variants?status=queued&limit=30
```

Mỗi row có `queue_payload`:

```json
{
  "post_id": "string",
  "source_content_id": "string",
  "platform": "facebook",
  "post_type": "text",
  "body": "string",
  "title": "string",
  "hook": "string",
  "CTA": "string",
  "hashtags": [],
  "scheduled_time": null
}
```

## Tracking

Tracking về sau nên nối theo `post_id`:

- impressions
- views
- comments
- shares
- saves
- clicks
- affiliate_orders
- posted_at
- platform_status
