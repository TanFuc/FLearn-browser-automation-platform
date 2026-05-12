# 📘 FAuto — Tài Liệu Hệ Thống (Tiếng Việt)

> Cập nhật lần cuối: 05/05/2026

---

## 1. Tổng Quan Dự Án

**FAuto** là nền tảng tự động hóa thao tác Facebook đa tài khoản, được xây dựng trên Node.js + Playwright. Hệ thống vận hành hoàn toàn thông qua **Web Dashboard** hiện đại, hỗ trợ hai loại tác vụ chính:

| Tác vụ | Mô tả |
|--------|-------|
| **Kết Bạn Tự Động** | Duyệt danh sách thành viên một Group Facebook và gửi lời mời kết bạn hàng loạt |
| **Hủy Theo Dõi** | Vào trang bạn bè cá nhân, lần lượt bỏ theo dõi từng người |

---

    ## 2. Công Nghệ Sử Dụng

    | Thành phần | Công nghệ | Vai trò |
    |---|---|---|
    | Runtime | **Node.js** | Nền tảng chạy server |
    | Web Framework | **Express v5** | HTTP API + serve frontend |
    | Trình duyệt | **Playwright (Chromium)** | Tự động hóa thao tác trên Facebook |
    | Hàng đợi | **BullMQ** | Quản lý job queue đa tài khoản |
    | Message broker | **Redis (ioredis)** | Backend cho BullMQ |
    | Cơ sở dữ liệu | **PostgreSQL (pg)** | Lưu tài khoản, logs, thống kê |
    | Real-time | **Socket.io** | Đẩy log & stats lên Dashboard ngay lập tức |
    | Frontend | HTML + Vanilla CSS + JS | Giao diện Web Dashboard |

    ---

    ## 3. Cấu Trúc Thư Mục

    ```
    nodejs-playwright/
    ├── src/                        # Mã nguồn backend
    │   ├── index.js                # Điểm khởi chạy duy nhất
    │   ├── server.js               # Express server + Socket.io + API
    │   ├── worker.js               # BullMQ Worker xử lý job
    │   ├── tasks.js                # Logic tự động hóa (Invite + Unfollow)
    │   ├── browser.js              # Khởi tạo Playwright + Fingerprint từ DB
    │   ├── queue.js                # Định nghĩa BullMQ queue
    │   ├── db.js                   # Kết nối PostgreSQL (pool)
    │   ├── config.js               # Đọc/ghi settings.json
    │   ├── state.js                # Biến trạng thái dừng/chạy
    │   ├── utils.js                # Hàm tiện ích (randomDelay...)
    │   └── init-db.js              # Script tạo bảng lần đầu
    │
    ├── public/                     # Frontend Web Dashboard
    │   ├── index.html              # Giao diện chính
    │   ├── app.js                  # Logic frontend (Socket.io client, API calls)
    │   └── style.css               # CSS toàn bộ giao diện
    │
    ├── profiles/                   # Profile Chromium của từng tài khoản (cookie/session)
    ├── logs/                       # Log file (nếu có)
    │
    ├── settings.json               # Cấu hình bot (delay, limit...) — tự động ghi
    ├── .env                        # Biến môi trường (DB, Redis, Port)
    ├── .env.example                # Mẫu file .env
    ├── package.json                # Dependencies
    │
    ├── migrate_fingerprint.js      # Migration: tạo ua_pool, viewport_pool, cột fingerprint
    ├── migrate_delete_cols.js      # Migration: tạo cột name, deleted_at, hard_deleted_at
    ├── init_logs.js                # Migration: tạo bảng logs
    └── check_schema.js             # Kiểm tra schema DB hiện tại
    ```

    ---

## 4. Cơ Sở Dữ Liệu (PostgreSQL)

### Bảng `accounts` — Quản lý tài khoản Facebook

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | TEXT (PK) | ID định danh tài khoản (vd: `fa_260501_ab12`) |
| `name` | VARCHAR(255) | Tên hiển thị tùy chọn |
| `status` | TEXT | Trạng thái: `active`, `error`, `checkpoint` |
| `proxy` | TEXT | Proxy của tài khoản (http://user:pass@ip:port) |
| `fb_email` | TEXT | Email/UID để tự động đăng nhập |
| `fb_password` | TEXT | Mật khẩu Facebook |
| `group_url` | TEXT | URL Group mặc định |
| `daily_limit` | INTEGER | Giới hạn lời mời/ngày (mặc định 50) |
| `invites_sent_today` | INTEGER | Số lời mời đã gửi hôm nay |
| `unfollows_today` | INTEGER | Số lần hủy theo dõi hôm nay |
| `fingerprint` | JSONB | Fingerprint trình duyệt (UA, viewport...) đã gán cố định |
| `last_run_at` | TIMESTAMPTZ | Lần chạy cuối |
| `error_count` | INTEGER | Số lần lỗi tích lũy |
| `deleted_at` | TIMESTAMPTZ | Thời điểm xóa mềm (NULL = đang hoạt động) |
| `hard_deleted_at` | TIMESTAMPTZ | Marker trước khi xóa cứng |
| `created_at` | TIMESTAMPTZ | Ngày tạo |
| `updated_at` | TIMESTAMPTZ | Ngày cập nhật |

### Bảng `tasks` — Lịch sử tác vụ

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | SERIAL (PK) | ID tự tăng |
| `account_id` | TEXT | ID tài khoản thực hiện |
| `type` | TEXT | Loại: `invite` hoặc `unfollow` |
| `payload` | JSONB | Dữ liệu đầu vào (URL, limit...) |
| `status` | TEXT | `pending` / `running` / `completed` / `failed` |
| `attempts` | INTEGER | Số lần thử |
| `started_at` | TIMESTAMP | Bắt đầu chạy |
| `finished_at` | TIMESTAMP | Kết thúc |
| `error` | TEXT | Thông báo lỗi nếu thất bại |

### Bảng `logs` — Nhật ký hoạt động (Persistent)

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | SERIAL (PK) | ID tự tăng |
| `account_id` | TEXT | ID tài khoản phát sinh log (`system` = hệ thống) |
| `type` | TEXT | `info` / `success` / `error` / `warning` / `system` |
| `message` | TEXT | Nội dung log |
| `created_at` | TIMESTAMPTZ | Thời điểm ghi log |

### Bảng `ua_pool` — Danh sách User-Agent (Fingerprint)

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | SERIAL (PK) | ID |
| `user_agent` | TEXT | Chuỗi User-Agent |
| `platform` | VARCHAR(20) | `Win32` hoặc `MacIntel` |
| `is_active` | BOOLEAN | Bật/tắt UA này |

### Bảng `viewport_pool` — Danh sách độ phân giải

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | SERIAL (PK) | ID |
| `width` | INTEGER | Chiều rộng màn hình |
| `height` | INTEGER | Chiều cao màn hình |
| `is_active` | BOOLEAN | Bật/tắt độ phân giải này |

### Bảng `deleted_accounts` — Audit tài khoản đã xóa cứng

Sao lưu đầy đủ thông tin tài khoản trước khi bị xóa hoàn toàn khỏi `accounts`.

---

## 5. API Endpoints

### Tài khoản

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/accounts` | Lấy danh sách tài khoản đang hoạt động |
| GET | `/api/accounts/deleted` | Lấy danh sách đã xóa mềm |
| POST | `/api/accounts` | Thêm tài khoản mới |
| PUT | `/api/accounts/:id` | Cập nhật thông tin tài khoản |
| DELETE | `/api/accounts/:id` | **Xóa mềm** (set `deleted_at`) |
| POST | `/api/accounts/:id/restore` | Khôi phục tài khoản đã xóa mềm |
| DELETE | `/api/accounts/:id/hard` | **Xóa cứng** (archive + xóa row) |
| POST | `/api/accounts/:id/browser` | Mở trình duyệt thủ công cho tài khoản |

### Điều khiển tác vụ

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/run` | Khởi chạy chiến dịch (thêm job vào queue) |
| POST | `/api/pause` | Tạm dừng hàng đợi |
| POST | `/api/resume` | Tiếp tục hàng đợi |
| POST | `/api/stop` | Dừng hẳn và xóa toàn bộ job đang chờ |

### Cấu hình & Log

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/config` | Lấy cấu hình hiện tại |
| POST | `/api/config` | Lưu cấu hình mới |
| GET | `/api/logs` | Lấy 200 dòng log gần nhất từ DB |

---

## 6. Socket.io Events (Real-time)

| Sự kiện | Chiều | Dữ liệu | Mô tả |
|---------|-------|---------|-------|
| `log` | Server → Client | `{ accountId, message, type }` | Một dòng log mới |
| `stats` | Server → Client | `{ queued, active, accounts[], unfollows, sent }` | Cập nhật thống kê mỗi 3 giây |

---

## 7. Hệ Thống Fingerprint (Chống Checkpoint)

Mỗi tài khoản được gán **một bộ fingerprint duy nhất và cố định** ngay lần đầu chạy, lưu vào cột `accounts.fingerprint` (JSONB). Các lần chạy sau đều dùng lại fingerprint này — đảm bảo tính nhất quán.

### Dữ liệu fingerprint gồm:
- `userAgent` — Lấy từ bảng `ua_pool`
- `platform` — `Win32` hoặc `MacIntel` (khớp với UA)
- `viewport` — Lấy từ bảng `viewport_pool`
- `screenWidth / screenHeight` — Màn hình thật (viewport + taskbar)
- `colorDepth`, `deviceScaleFactor`
- `timezoneId` — `Asia/Ho_Chi_Minh`
- `locale` — `vi-VN`

### Lớp chống phát hiện:
1. `--disable-blink-features=AutomationControlled`
2. `ignoreDefaultArgs: ['--enable-automation']`
3. `navigator.webdriver` → `undefined`
4. `navigator.plugins` → 3 plugin PDF/NaCl giả
5. `navigator.languages` → `['vi-VN', 'vi', 'en-US', 'en']`
6. `navigator.platform` → khớp UA
7. `screen.*` → khớp viewport
8. `navigator.hardwareConcurrency` → 8
9. `navigator.deviceMemory` → 8
10. Xóa artifact `cdc_adoQpoasnfa76pfcZLmcfl_*`
11. HTTP Headers: `Sec-Ch-Ua`, `Accept-Language`, `Sec-Ch-Ua-Platform`

> ⚠️ **Quan trọng:** Không thay đổi fingerprint giữa các lần chạy cho cùng một tài khoản. Sự nhất quán là yếu tố then chốt tránh bị Facebook checkpoint.

---

## 8. Luồng Hoạt Động

```
Dashboard (Browser)
    │  POST /api/run
    ▼
server.js  →  addInviteJob()  →  BullMQ Queue (Redis)
                                        │
                                        ▼
                                   worker.js (BullMQ Worker)
                                        │
                                        ├── getAccountProfile() ← PostgreSQL (accounts.fingerprint)
                                        ├── createOrLoadContext() ← Playwright (profiles/{id}/)
                                        │
                                        ├── [Nếu invite] → autoInviteTask()
                                        │       ├── Kiểm tra checkpoint/đăng nhập
                                        │       ├── Cuộn trang thành viên Group
                                        │       ├── Lọc Admin/Mod/Tích xanh
                                        │       └── Click nút "Thêm bạn bè"
                                        │
                                        └── [Nếu unfollow] → autoUnfollowTask()
                                                ├── Vào /me/friends/
                                                ├── Cuộn + mở menu 3 chấm
                                                └── Click "Bỏ theo dõi"
                                        │
                                        ▼
                              emitLog() → workerEvents → server.js
                                                │
                                                ├── io.emit('log')  → Dashboard (Socket.io)
                                                └── INSERT INTO logs (PostgreSQL)
```

---

## 9. Giao Diện Web Dashboard

### Các Tab chính:

| Tab | Mô tả |
|-----|-------|
| **Bảng Điều Khiển** | Khởi chạy chiến dịch, chọn tài khoản, xem thống kê & log live |
| **Nhật Ký Hoạt Động** | Terminal full-screen hiển thị toàn bộ logs lưu trong DB |
| **Cài Đặt Hệ Thống** | Chỉnh delay, số lần cuộn, bộ lọc thông minh |
| **Quản Lý Tài Khoản** | Thêm/sửa/xóa tài khoản, xem thống kê từng account |

### Thống kê Dashboard:
- **Hàng Đợi** — Số job đang chờ trong BullMQ
- **Đang Chạy** — Số job đang chạy song song
- **Lời Mời Đã Gửi** — Đếm trong phiên hiện tại
- **Đã Hủy Theo Dõi** — Đếm riêng biệt trong phiên

### Tính năng Quản Lý Tài Khoản:
- **Thêm mới** tài khoản với ID tự sinh, tên hiển thị, proxy, email/pass
- **Sửa** thông tin — form chuyển sang chế độ "Cập Nhật" (nút đổi màu cam, ID bị khóa readonly)
- **Mở trình duyệt** thủ công cho từng tài khoản
- **Xóa mềm** (🗑️ vàng) — ẩn khỏi danh sách, có thể khôi phục
- **Khu Đã Xóa** — Hiện danh sách xóa mềm, cho phép Khôi Phục hoặc Xóa Cứng
- **Xóa cứng** — archive sang bảng `deleted_accounts` rồi xóa hẳn khỏi DB

---

## 10. Cấu Hình Bot (`settings.json`)

| Tham số | Mặc định | Mô tả |
|---------|----------|-------|
| `maxScrolls` | 99 | Số lần cuộn trang tối đa mỗi tác vụ |
| `maxClicks` | 50 | Số lời mời tối đa mỗi lần chạy |
| `delayMin` | 1015ms | Delay tối thiểu giữa các lần click |
| `delayMax` | 3222ms | Delay tối đa giữa các lần click |
| `scrollPauseMin` | 2285ms | Thời gian chờ tối thiểu sau mỗi lần cuộn |
| `scrollPauseMax` | 4928ms | Thời gian chờ tối đa sau mỗi lần cuộn |
| `skipAdmins` | true | Bỏ qua Quản trị viên & Người kiểm duyệt |
| `skipVerified` | true | Bỏ qua tài khoản tích xanh xác minh |

---

## 11. Biến Môi Trường (`.env`)

```env
DB_USER=postgres
DB_HOST=localhost
DB_NAME=automation
DB_PASSWORD=123456
DB_PORT=5432

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=          # Để trống nếu Redis không có mật khẩu

PORT=3000
MAX_CONCURRENCY=5        # Số job chạy song song tối đa
```

---

## 12. Hướng Dẫn Cài Đặt & Khởi Chạy

### Yêu cầu hệ thống:
- Node.js ≥ 18
- PostgreSQL đang chạy
- Redis đang chạy

### Bước 1 — Cài dependencies
```bash
cd nodejs-playwright
npm install
npx playwright install chromium
```

### Bước 2 — Cấu hình môi trường
```bash
cp .env.example .env
# Chỉnh sửa .env với thông tin DB và Redis của bạn
```

### Bước 3 — Khởi tạo Database
```bash
npm run init-db
node migrate_fingerprint.js
node migrate_delete_cols.js
node init_logs.js
```

### Bước 4 — Khởi động hệ thống
```bash
npm run start
```

### Bước 5 — Truy cập Dashboard
```
http://localhost:3000
```

---

## 13. Luồng Xóa Tài Khoản

```
Xóa Mềm  →  deleted_at = NOW()  →  Tài khoản bị ẩn khỏi danh sách active
                │
                ├── Có thể: Khôi Phục → deleted_at = NULL
                │
                └── Có thể: Xóa Cứng
                            │
                            ├── Copy toàn bộ dữ liệu → bảng deleted_accounts
                            ├── hard_deleted_at = NOW()
                            └── DELETE FROM accounts WHERE id = ...
```

---

## 14. Các File Migration & Script Phụ Trợ

| File | Chạy khi nào |
|------|-------------|
| `src/init-db.js` | Lần đầu cài đặt — tạo bảng `accounts` và `tasks` |
| `init_logs.js` | Tạo bảng `logs` nếu chưa có |
| `migrate_fingerprint.js` | Tạo bảng `ua_pool`, `viewport_pool`, cột `accounts.fingerprint` |
| `migrate_delete_cols.js` | Thêm cột `name`, `deleted_at`, `hard_deleted_at`; tạo bảng `deleted_accounts` |
| `check_schema.js` | Kiểm tra cấu trúc bảng `accounts` và danh sách bảng hiện có |

---

## 15. Lưu Ý Quan Trọng

1. **Profile trình duyệt** được lưu trong `profiles/{accountId}/` — **không xóa** thư mục này vì chứa cookie đăng nhập.
2. **Fingerprint cố định per-account** — sau khi được gán lần đầu, không bao giờ thay đổi để tránh Facebook phát hiện.
3. **Bảng `logs` không tự dọn** — sau thời gian dài chạy nên chạy: `DELETE FROM logs WHERE created_at < NOW() - INTERVAL '30 days'`.
4. **2FA** — Tài khoản bật 2FA không thể dùng tính năng tự động đăng nhập, cần đăng nhập thủ công qua nút "Mở Trình Duyệt".
5. **Concurrency** — Mặc định 5 job song song (`MAX_CONCURRENCY=5`). Tăng lên nếu server mạnh, giảm xuống nếu muốn an toàn hơn.
6. **Redis + PostgreSQL** phải chạy trước khi `npm run start`.
## AFF VID

AFF VID chuyển dữ liệu AI Research/Product Trends thành video plan affiliate ngắn cho TikTok, Facebook Reels và Instagram Reels.

- Docs: [docs/AFF_VID.md](docs/AFF_VID.md)
- Plan triển khai: [docs/AFF_VID_IMPLEMENTATION_PLAN.md](docs/AFF_VID_IMPLEMENTATION_PLAN.md)
## AFF VID / UP POST

- AFF VID docs: [docs/AFF_VID.md](docs/AFF_VID.md)
- AFF VID plan: [docs/AFF_VID_IMPLEMENTATION_PLAN.md](docs/AFF_VID_IMPLEMENTATION_PLAN.md)
- UP POST docs: [docs/UP_POST.md](docs/UP_POST.md)
- UP POST plan: [docs/UP_POST_IMPLEMENTATION_PLAN.md](docs/UP_POST_IMPLEMENTATION_PLAN.md)
