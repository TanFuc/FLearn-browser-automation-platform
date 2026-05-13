# AI Research Date Filter Checklist

## Mục tiêu

Đảm bảo MMO, AI Market, Gợi Ý, Trends V4, AFF VID và UP POST luôn lấy dữ liệu thật theo ngày/window, không hardcode và không bị rỗng im lặng.

## Rules

- Khi user chưa chọn ngày, frontend không gửi `date`; backend resolve ngày mới nhất có data cho từng page.
- Khi user đã chọn ngày, frontend gửi `date=YYYY-MM-DD`; backend chỉ trả dữ liệu đúng ngày đó.
- Mỗi API trả `meta.date_mode`, `meta.requested_date`, `meta.resolved_date`, `meta.available_dates`, `meta.row_count`, `meta.empty_reason`.
- Empty state phải hiển thị lý do thiếu data và ngày gần nhất có thể chuyển sang.
- Trends V4 hỗ trợ `window=today|last_3_days|last_7_days` và `categories=all`.
- AFF VID chỉ lấy source từ Trends V4; không tự tạo sản phẩm nếu Trends V4 rỗng.
- UP POST lấy source từ AFF VID hoặc research theo đúng `source_type` và ngày.

## Daily refresh job

- BullMQ queue: `research-queue`.
- Repeatable job name: `manual-research`.
- Schedule: `0 8 * * *` with timezone `Asia/Ho_Chi_Minh`.
- Manual trigger: `POST /api/research/admin/run-daily-job`.
- Worker entry: `runDailyTrendResearch()` in `src/research-service.js`.
- The daily job refreshes all AI Research pages:
  - Trends V4: `today`, `last_3_days`, `last_7_days`.
  - Legacy MMO: `/api/research/page-1`, stored in `research_results` with `page_type='mmo'`.
  - Legacy AI Market: `/api/research/page-2`, stored in `research_results` with `page_type='ai_tools'`.
  - Suggestions: `/api/research/page-3`, stored in `ai_suggestions`.
- `GET /api/research/date-availability` should show the daily refresh date for all refreshed pages after the job finishes.
- On startup, `addResearchJob()` removes stale duplicate daily repeat jobs, including older jobs without the configured timezone.

## Smoke test

```http
GET /api/research/date-availability
GET /api/research/page-1
GET /api/research/page-1?date=YYYY-MM-DD
GET /api/research/page-2?date=YYYY-MM-DD
GET /api/research/page-3?date=YYYY-MM-DD
GET /api/product-trends?market=vn&categories=all&window=today
GET /api/research/aff-vid/source-products?market=vn&window=today&categories=all
GET /api/research/up-post/sources?source_type=aff_vid
POST /api/research/admin/run-daily-job
```
