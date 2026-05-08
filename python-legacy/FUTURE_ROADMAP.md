# Đề Xuất Nâng Cấp & Lộ Trình Phát Triển Ứng Dụng (Roadmap)

Dưới đây là danh sách các tính năng và cấu hình chi tiết để biến **FB Auto Invite** thành một công cụ chuyên nghiệp, an toàn và "hoàn hảo" nhất có thể.

## 1. Nâng Cao An Toàn & Chống Checkpoint (Anti-Ban)

Đây là yếu tố quan trọng nhất để tool chạy ổn định lâu dài.

*   **1.1. User-Agent Rotation (Xoay vòng User-Agent):**
    *   **Tính năng:** Mỗi lần khởi động trình duyệt hoặc mỗi tài khoản sẽ sử dụng một "dấu vân tay" trình duyệt (Browser Fingerprint) và User-Agent khác nhau (Windows, Mac, Linux...).
    *   **Tác dụng:** Tránh việc Facebook phát hiện hàng loạt tài khoản chạy từ cùng một phiên bản Chrome giả lập.
*   **1.2. Giới Hạn Theo Ngày (Daily Limits):**
    *   **Cấu hình:** Thêm cài đặt `Daily Max Invites` (Ví dụ: 100 invite/ngày).
    *   **Logic:** Tool sẽ lưu lịch sử invite vào database local (SQLite/JSON). Khi chạy, tool kiểm tra hôm nay đã invite bao nhiêu, nếu đủ quota thì dừng tài khoản đó, chuyển sang acc khác.
*   **1.3. Lịch Trình Hoạt Động (Scheduler):**
    *   **Cấu hình:** Chỉ chạy trong khung giờ hành chính (ví dụ: 8h sáng - 10h tối).
    *   **Tác dụng:** Giả lập hành vi con người, tránh chạy thâu đêm suốt sáng gây nghi ngờ.
*   **1.4. Cơ Chế "Warm-up" (Làm nóng tài khoản):**
    *   **Tính năng:** Với tài khoản mới thêm vào, chỉ invite số lượng nhỏ (5-10 người) rồi tăng dần theo thời gian.

## 2. Tinh Chỉnh Cấu Hình & Bộ Lọc (Filtering & Config)

Giúp người dùng kiểm soát chính xác tool làm gì.

*   **2.1. Bộ Lọc Thành Viên (Smart Targeting):**
    *   **Skip Admins/Moderators:** Tự động bỏ qua Quản trị viên nhóm (vì họ dễ ban tài khoản spam).
    *   **Giới tính/Tên:** Chỉ invite Nữ hoặc Nam (dựa trên phân tích tên hoặc ảnh đại diện sơ bộ - *nâng cao*).
    *   **Bỏ qua người đã có nút "Nhắn tin":** (Thường là đã kết bạn hoặc có tương tác).
*   **2.2. Điều Chỉnh Tốc Độ Chi Tiết:**
    *   **UI Config:** Thay vì fix cứng trong code, cho phép chỉnh `Min Scroll Delay`, `Max Scroll Delay`, `Min Click Delay`, `Max Click Delay` ngay trên giao diện.
*   **2.3. Cấu Hình Proxy Nâng Cao:**
    *   **Fallback Strategy:** Nếu Proxy chết, thử kết nối lại 3 lần. Nếu vẫn chết -> Tự động chuyển sang mạng Direct (mạng máy) hoặc dừng hẳn (tuỳ chọn).

## 3. Quản Lý Tài Khoản Chuyên Nghiệp (Account Management)

*   **3.1. Import/Export Đa Dạng:**
    *   Hỗ trợ Import tài khoản từ file Excel (`.xlsx`) hoặc CSV với nhiều cột (UID, Pass, 2FA, Cookies).
    *   Export báo cáo kết quả ra Excel (Acc nào chạy, được bao nhiêu invite, lỗi gì).
*   **3.2. Login Tự Động bằng Cookies/UID|Pass:**
    *   Hiện tại tool dựa vào Profile Chrome đã login sẵn.
    *   **Nâng cấp:** Tích hợp tính năng tự động login nếu cookie hết hạn hoặc profile trắng.
*   **3.3. Trình Quản Lý Profile:**
    *   Nút **"Tạo Profile Mới"**: Tự động tạo thư mục profile Chrome sạch.
    *   Nút **"Mở Trình Duyệt"**: Mở Chrome thủ công để người dùng vào check noti hoặc gỡ checkpoint.

## 4. Giao Diện & Trải Nghiệm Người Dùng (UI/UX)

*   **4.1. Dashboard Thống Kê (Charts):**
    *   Hiển thị biểu đồ số lượng invite gửi được trong 7 ngày qua.
    *   Hiển thị trạng thái Proxy (Bao nhiêu sống/chết).
*   **4.2. Khay Hệ Thống (System Tray):**
    *   Khi bấm nút X, tool thu nhỏ xuống khay hệ thống (góc dưới màn hình) thay vì tắt hẳn, tiếp tục chạy ngầm.
*   **4.3. Thông Báo (Notifications):**
    *   Gửi thông báo Telegram/Discord khi chạy xong Batch hoặc khi có tài khoản bị Checkpoint.

## 5. Kỹ Thuật & DevOps (Dành cho bản Enterprise)

*   **5.1. Docker Support:**
    *   Đóng gói tool thành Docker Image để dễ dàng deploy lên hàng trăm VPS.
*   **5.2. API Server:**
    *   Dựng một API server nhỏ tích hợp trong tool, cho phép điều khiển Start/Stop từ xa qua web.

---

## Bảng Cấu Hình Đề Xuất (Trong file `settings.json` hoặc UI)

Dưới đây là file mẫu cấu hình lý tưởng cho phiên bản hoàn hảo:

```json
{
  "browser": {
    "headless": false,
    "user_agent_rotate": true,
    "disable_images": true,   // Tắt ảnh để load nhanh & tiết kiệm băng thông
    "window_size": "1280,720"
  },
  "limits": {
    "daily_max_invites": 100,
    "batch_size": 5,
    "max_retries": 3
  },
  "filters": {
    "skip_admins": true,
    "skip_foreign_names": false,
    "keywords_blacklist": ["shop", "bán hàng", "tuyển dụng"] // Bỏ qua nick bán hàng
  },
  "proxy": {
    "mode": "rotate_per_account", // rotate_per_request, static
    "fallback_to_direct": false
  },
  "scheduler": {
    "enabled": true,
    "start_time": "08:00",
    "end_time": "22:00",
    "pause_days": ["Sunday"] // Nghỉ chủ nhật
  }
}
```
