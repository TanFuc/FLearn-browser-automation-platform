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
```
