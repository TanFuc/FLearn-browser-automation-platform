# Tài Liệu Dự Án (Project Documentation)

## 1. Giới Thiệu Chung
Dự án này là một hệ thống tự động hóa thao tác trên Facebook, tập trung vào tính năng tự động gửi lời mời kết bạn (Auto Invite) từ danh sách thành viên của một Nhóm (Group) bất kỳ.
Hiện tại mã nguồn bao gồm 2 nhánh chính:
1. **`python-legacy/`**: Mã nguồn cũ sử dụng Python và Selenium. (Được lưu trữ lại để tham khảo).
2. **`nodejs-playwright/`**: **Dự án chính thức hiện tại**. Sử dụng Node.js kết hợp Playwright và Express. Được trang bị giao diện Web Dashboard hiện đại, chạy ngầm ổn định và tối ưu hoá giả lập người dùng thật (không can thiệp fingerprint nhằm tránh checkpoint).

---

## 2. Quy Tắc Cập Nhật (Rules for Updates)
- **Cập nhật Tài liệu bắt buộc:** Bất kỳ lúc nào có mã nguồn được thêm mới, thay đổi hay tối ưu trong dự án này, tệp `DOCUMENTATION.md` này BẮT BUỘC phải được cập nhật tương ứng.
- **Tính Nhất Quán Của Trình Duyệt (Persistent Contexts):** Mỗi tài khoản Facebook được gắn với một thư mục lưu trữ profile độc lập (`profiles/{accountId}`). **Không được** cố ý dùng mã nguồn để giả mạo, đổi thay đổi fingerprint (Device, Canvas, WebGL) động giữa các lần chạy cho cùng một tài khoản. Sự nhất quán là chìa khoá để tránh bị Facebook khoá tài khoản.

---

## 3. Kiến Trúc Hệ Thống Node.js (Node.js Playwright Architecture)
Hệ thống mới được xây dựng bằng Node.js và Playwright, được điều khiển hoàn toàn thông qua Giao diện Web (Web Dashboard) thay vì cửa sổ Terminal.

### Cấu trúc thư mục `nodejs-playwright/`:
- **`public/`**: Chứa toàn bộ giao diện Frontend của Web Dashboard (gồm `index.html`, `style.css`, `app.js`).
- **`src/server.js`**: Máy chủ Express Server. Chịu trách nhiệm host giao diện Web, xử lý API từ Frontend gửi xuống và mở kết nối Socket.io để truyền log thời gian thực.
- **`src/config.js`**: Trình quản lý cấu hình. Nạp và lưu trữ cấu hình linh hoạt (độ trễ, giới hạn lượt kết bạn...) vào file `settings.json` (thay đổi trực tiếp từ Web, không phải sửa code).
- **`src/browser.js`**: Trình quản lý Playwright. Xử lý việc khởi chạy và load profile lưu trữ cookie/session từ thư mục `profiles/`.
- **`src/queue.js`**: Bộ máy xử lý hàng đợi (Task Runner). Đảm bảo các tác vụ của cùng một tài khoản được chạy tuần tự, ngăn chặn việc thao tác quá nhanh dẫn đến spam.
- **`src/tasks.js`**: Chứa logic tự động hóa cốt lõi (tìm thành viên nhóm, lọc Admin/Mod, bỏ qua tài khoản tích xanh, click nút gửi lời mời kết bạn).
- **`src/index.js`**: File khởi chạy duy nhất để bật hệ thống Server.

---

## 4. Hướng Dẫn Sử Dụng
1. **Khởi động hệ thống:**
   Mở terminal tại thư mục `nodejs-playwright`, chạy lệnh:
   ```bash
   npm run start
   ```
   *(Hoặc `npm run dev`)*
2. **Truy cập Dashboard:**
   Mở trình duyệt Web của bạn, truy cập vào `http://localhost:3000`.
3. **Cài đặt cấu hình:**
   Vào tab **Cài Đặt Hệ Thống**, điều chỉnh số lượt cuộn, số lời mời, thời gian chờ (delay) và bộ lọc cho phù hợp rồi nhấn **Lưu Cấu Hình**.
4. **Chạy kịch bản:**
   Vào tab **Bảng Điều Khiển**, nhập ID Tài Khoản (ví dụ: `acc_001`), dán đường link danh sách thành viên của Group Facebook và nhấn **Bắt Đầu Chạy**. Bạn có thể theo dõi mọi diễn biến ở mục Nhật Ký Hoạt Động ngay trên Web.

---

## 5. Logic Tự Động Kết Bạn (Adding Friends Logic)
Logic mời kết bạn được kế thừa từ nguyên lý của bản Python cũ nhưng được tối ưu hóa mạnh mẽ nhờ bộ định vị (Locators) của Playwright:
1. **Quét thành viên:** Hệ thống xác định các thẻ thành viên nhóm (Member cards) thông qua selector `div.x1yztbdb`.
2. **Bộ Lọc Thông Minh (Smart Filters):** 
   - Đọc nội dung văn bản trong từng thẻ thành viên.
   - Bỏ qua nếu có chứa các từ khóa như: "Quản trị viên", "Admin", "Người kiểm duyệt", "Chuyên gia nhóm" hoặc các dấu hiệu nhận biết tài khoản "Đã xác minh" (Verified/Tích xanh).
3. **Phân biệt Nút Bấm An Toàn:** 
   - Tìm kiếm chính xác nút bấm mang chữ "Thêm bạn bè" (Add friend) bên trong thẻ của thành viên đó.
   - **ĐẶC BIỆT:** Hệ thống có cơ chế `hasNot` để lọc bỏ và **TUYỆT ĐỐI KHÔNG CLICK** vào các nút mang nhãn "Hủy lời mời" (Cancel invite / Thu hồi), giúp tránh tình trạng tự động hủy các lời mời đang chờ xử lý.
4. **Giả lập con người:** Chờ ngẫu nhiên (Random Delay) từ vài trăm đến vài ngàn mili-giây giữa mỗi lượt cuộn chuột và click. Trang web được cuộn bằng con lăn ảo (`mouse.wheel`) để giống với thao tác của tay.
