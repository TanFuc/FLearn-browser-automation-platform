# FB Auto Invite Tool v3.0

Ứng dụng tự động hóa tương tác Facebook (Kết bạn, Đăng bài, Chia sẻ, Bình luận) sử dụng Python, Selenium và Tkinter.

## 📌 Các chức năng chính

### 1. Tự động hóa Facebook (Selenium)
- **Gửi lời mời kết bạn/Mời vào nhóm**: Tự động cuộn và tìm các nút "Thêm bạn bè" hoặc "Mời" trên trang thành viên nhóm.
- **Đăng bài (Post)**: Tự động đăng nội dung lên tường cá nhân hoặc vào các nhóm.
- **Chia sẻ (Share)**: Chia sẻ bài viết bất kỳ lên trang cá nhân.
- **Bình luận (Comment)**: Tự động để lại bình luận trên các bài viết mục tiêu.
- **Bỏ theo dõi (Unfollow)**: Hỗ trợ lọc và bỏ theo dõi hàng loạt.

### 2. Quản lý tài khoản đa luồng
- Chạy đồng thời nhiều tài khoản Facebook thông qua cơ chế **Remote Debugging Port** của Chrome.
- Quản lý trạng thái tài khoản thời gian thực (Đang chạy, Nghỉ, Lỗi, Checkpoint).
- Tự động đăng nhập lại khi hết phiên làm việc (Session).

### 3. Bảo mật & Chống phát hiện (Anti-Detection)
- **Mã hóa thông tin**: Mật khẩu Facebook được mã hóa bằng thuật toán Fernet trước khi lưu vào cơ sở dữ liệu.
- **Hành vi người dùng giả lập**: Độ trễ ngẫu nhiên giữa các thao tác, cuộn trang tự nhiên.
- **Proxy**: Hỗ trợ gắn Proxy riêng cho từng tài khoản (HTTP/Socks5).

### 4. Giao diện trực quan
- Theo dõi tiến độ chạy trực tiếp qua bảng Dashboard.
- Cấu hình nhanh các thông số (Batch size, Max click, Thời gian nghỉ).

---

## 🛠 Cấu trúc dự án

```text
├── app/
│   ├── core/           # Logic tự động hóa (Selenium, Proxy, Browser)
│   ├── services/       # Điều phối đa luồng (Orchestrator, Account Manager)
│   ├── models.py       # Định nghĩa Pydantic Models
│   ├── database.py     # Quản lý SQLite
│   ├── config.py       # Cấu hình hệ thống (Settings)
│   └── log_setup.py    # Cấu hình Logging
├── ui/                 # Giao diện người dùng (Tkinter/ttkbootstrap)
├── utils/              # Các hàm tiện ích (Crypto, File I/O)
├── main.py             # File chạy chính của ứng dụng
└── requirements.txt    # Danh sách thư viện phụ thuộc
```

---

## 🚀 Hướng dẫn cài đặt & Sử dụng

### Yêu cầu hệ thống
- Python 3.10+
- Google Chrome đã được cài đặt.

### Cài đặt
1. Clone hoặc tải source code về máy.
2. Cài đặt các thư viện cần thiết:
   ```bash
   pip install -r requirements.txt
   ```

### Sử dụng
1. Chạy file `main.py` để mở giao diện:
   ```bash
   python main.py
   ```
2. Thêm tài khoản Facebook (yêu cầu điền cổng Debug của Chrome, ví dụ: `127.0.0.1:9222`).
3. Nhập link nhóm/bài viết và nhấn **BẮT ĐẦU**.
