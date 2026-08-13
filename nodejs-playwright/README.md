# FLearn Auto Invite

Dashboard automation dùng Node.js, Express, Socket.IO, BullMQ, Redis, PostgreSQL và Playwright-compatible browser context để quản lý các tác vụ Facebook như kết bạn, warm-up, hủy theo dõi và bình luận bài viết.

## Cấu trúc thư mục

```text
nodejs-playwright/
├── src/                    # Backend runtime chính
│   ├── index.js             # Entry point
│   ├── server.js            # Express API + Socket.IO
│   ├── worker.js            # BullMQ workers
│   ├── tasks.js             # Playwright automation tasks
│   ├── browser.js           # Browser/profile context
│   ├── queue.js             # Queue setup
│   ├── db.js                # PostgreSQL connection
│   └── research-*.js        # AI research feature
├── public/                 # Frontend dashboard tĩnh
├── tests/                  # Jest tests
├── scripts/
│   ├── migrations/          # Migration scripts
│   ├── seeds/               # Seed dữ liệu demo/dev
│   └── maintenance/         # Script kiểm tra schema, clear queue, init logs
├── tools/
│   ├── demo/                # Demo crawl/phân tích độc lập
│   └── experiments/         # Script thử nghiệm
├── docs/
│   ├── interview/           # Tài liệu ôn phỏng vấn
│   └── *.md                 # Tài liệu kỹ thuật/tính năng
├── profiles/               # Browser profiles, không commit
├── logs/                   # Runtime logs, không commit
└── package.json
```

## Lệnh thường dùng

```bash
npm install
npm start
npm test -- --runInBand
npm run demo:crawl
npm run db:check
```

## Luồng chính

1. Người dùng thao tác trên dashboard trong `public/`.
2. `src/server.js` validate request, lưu lịch chạy và đẩy job vào BullMQ.
3. `src/worker.js` lấy job từ Redis queue.
4. Worker mở browser context theo account qua `src/browser.js`.
5. `src/tasks.js` thực thi automation bằng Playwright selector và ghi log realtime qua Socket.IO.

## Ghi chú demo

- Cần Redis và PostgreSQL chạy trước khi start server.
- Tính năng browser automation phụ thuộc trạng thái account, checkpoint, 2FA và thay đổi giao diện Facebook.
- Nên demo bằng account phụ và nội dung tương tác an toàn.
