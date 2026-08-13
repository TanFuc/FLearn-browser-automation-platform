# Tài Liệu Ôn Phỏng Vấn - FAuto / FLearn Auto Invite

Ngày ôn tập: 2026-08-13

Mục tiêu của tài liệu này:

- Giúp bạn trả lời phỏng vấn về project `FLearn-auto-invite` một cách đúng, rõ, và trung thực.
- Bám vào code thật trong repo: Node.js, Express, BullMQ, Redis, PostgreSQL, CloakBrowser/Playwright-compatible, Socket.IO, Gemini.
- Chuẩn bị cho JD yêu cầu Python + Selenium/Playwright + crawl web động + đọc/sửa code có sẵn.
- Không nhận mình tự code 100% nếu project có AI hỗ trợ. Cách trả lời nên thể hiện: bạn biết dùng AI, biết đọc code, biết chạy/debug/sửa, và đang nắm lại architecture.

## 1. Câu Trả Lời Mở Đầu Về Project

### Câu hỏi: Em hãy giới thiệu project này trong 1-2 phút.

Câu trả lời mẫu:

Project của em là một automation dashboard dùng để quản lý nhiều Facebook account và chạy các task tự động như invite thành viên, unfollow, và warmup account.

Hệ thống được xây bằng Node.js. Backend dùng Express để cung cấp API, BullMQ và Redis để quản lý hàng đợi task, PostgreSQL để lưu accounts, tasks, schedules và logs. Phần browser automation dùng CloakBrowser, có API tương thích với Playwright, để mở persistent browser context riêng cho từng account.

Flow chính là: người dùng thao tác trên UI, frontend gọi API `/api/run`, server validate input và tạo schedule/job, BullMQ đẩy job vào Redis, worker lấy job ra, đọc account từ PostgreSQL, mở browser profile riêng, sau đó gọi logic trong `tasks.js` để thực hiện invite/unfollow/warmup. Log và thống kê được đẩy về UI realtime bằng Socket.IO và cũng được lưu vào database.

Ngoài automation, project còn có module AI Research dùng Gemini để nghiên cứu xu hướng sản phẩm, tạo kế hoạch AFF VID và UP POST. Phần này dùng queue riêng và có quota/cache để tránh gọi AI quá nhiều.

### Câu hỏi: Project này có phải Python project không?

Câu trả lời mẫu:

Project hiện tại của em không phải Python project, mà là Node.js project dùng CloakBrowser/Playwright-compatible. Tuy nhiên nó liên quan trực tiếp đến web automation vì các concept như browser context, persistent profile, selector, wait, proxy, retry, queue, logging và session management đều tương tự khi làm với Python Playwright hoặc Selenium.

Nếu vào công việc yêu cầu Python, em có thể chuyển các concept này sang Python. Ví dụ: Playwright Python cũng có `browser`, `context`, `page`, locator, storage state, proxy config và wait mechanism. Selenium thì dùng WebDriver, explicit wait và browser profile.

### Câu hỏi: Project này có AI hỗ trợ viết code không? Vai trò thật của em là gì?

Câu trả lời mẫu an toàn:

Có, project này em có dùng AI hỗ trợ generate và gợi ý code khá nhiều, nhất là khi xây nhanh các module. Em không muốn nhận là mình tự viết 100% từ đầu đến cuối.

Nhưng vai trò của em không chỉ là copy code. Em đưa requirement, chạy thử project, đọc lại flow, debug lỗi, chỉnh config, sửa các phần gặp lỗi và học cách hệ thống vận hành. Hiện tại em nắm được flow chính từ UI -> Express API -> BullMQ/Redis -> worker -> browser context -> task automation -> PostgreSQL/logs.

Em xem project này là một cách học thực chiến: dùng AI để tăng tốc, nhưng vẫn phải đọc hiểu code, biết debug, biết sửa code có sẵn. Em nghĩ điều này phù hợp với vị trí intern vì công việc yêu cầu đọc hiểu và chỉnh sửa code có sẵn.

Nếu bị hỏi xoáy tiếp:

- Em không nên nói "em làm hết".
- Em nên nói "phần em đang nắm rõ nhất là automation flow, queue/worker, browser profile và task logic".
- Em có thể thừa nhận "một số module AI Research em mới nắm ở mức architecture, chưa nắm sâu từng function".

## 2. Architecture Tổng Thể

### Câu hỏi: Architecture của project gồm những thành phần nào?

Câu trả lời:

Project chia thành các layer:

1. Frontend static: `public/index.html`, `public/app.js`, `public/style.css`, `public/research.html`, `public/research.js`.
2. API server: `src/server.js`, dùng Express để nhận request, validate input, tạo schedule/job, đọc/ghi database.
3. Queue layer: `src/queue.js`, dùng BullMQ + Redis để quản lý job bất đồng bộ.
4. Worker layer: `src/worker.js`, lấy job từ queue và thực thi logic automation hoặc AI/publishing job.
5. Browser automation layer: `src/browser.js` tạo persistent context riêng theo account.
6. Task layer: `src/tasks.js` gồm logic auto login, invite, unfollow, warmup.
7. Database layer: `src/db.js`, PostgreSQL pool.
8. Config/state/logging: `src/config.js`, `src/state.js`, `src/logger.js`, `src/utils.js`.
9. AI Research: `src/research-service.js`, `src/research-routes.js`, `src/gemini.js`, `src/market-data.js`, `src/up-post-service.js`.

### Câu hỏi: Flow từ lúc user bấm Run đến lúc browser chạy task?

Câu trả lời:

Flow chính:

1. User chọn account, task type, group URL hoặc schedule trên UI.
2. Frontend gọi `POST /api/run`.
3. `server.js` gọi `normalizeSchedulePayload` để validate input.
4. Server insert một row vào bảng `automation_schedules`.
5. Server gọi `enqueueScheduleJobs`, sau đó `addInviteJob` trong `queue.js`.
6. BullMQ đưa job vào `invite-queue`, Redis lưu trạng thái job.
7. `worker.js` lấy job từ queue.
8. Worker đọc account từ PostgreSQL.
9. Worker gọi `createOrLoadContext(accountId, proxy, false)` trong `browser.js`.
10. `browser.js` mở persistent profile `profiles/{accountId}`, cấu hình fingerprint, proxy, timezone, locale.
11. Worker route theo `taskType`: `invite`, `unfollow_friends`, `unfollow_following`, hoặc `warmup`.
12. Logic trong `tasks.js` thao tác trên Facebook bằng locator, scroll, click, delay.
13. Khi thành công, worker update `tasks`, `accounts`, `automation_schedules`.
14. Khi lỗi, worker update task failed, tăng error count nếu cần, log lỗi.
15. Cuối cùng worker đóng browser context trong `finally`.

### Câu hỏi: Vì sao không chạy automation trực tiếp trong API request?

Câu trả lời:

Automation browser có thể chạy lâu, tốn CPU/RAM và dễ gặp lỗi network, checkpoint, timeout. Nếu chạy trực tiếp trong API request thì request sẽ bị treo, user khó theo dõi trạng thái, và server dễ bị block khi nhiều task cùng lúc.

Dùng queue/worker có lợi ích:

- API trả về nhanh sau khi enqueue.
- Worker xử lý bất đồng bộ.
- Có thể giới hạn concurrency.
- Có retry/backoff cho một số job.
- Dễ theo dõi status, logs, history.
- Nếu job fail, có thể lưu lỗi và tiếp tục job khác.

## 3. Vai Trò Các File Chính

### `src/server.js`

Trả lời:

`server.js` là entry backend chính của Express. File này:

- Khởi tạo Express, HTTP server và Socket.IO.
- Serve frontend static trong `public/`.
- Mount research routes ở `/api/research` và `/api/product-trends`.
- Định nghĩa API quản lý config, accounts, logs, run task, pause/resume/stop.
- Validate schedule payload.
- Insert schedule vào PostgreSQL.
- Enqueue job vào BullMQ.
- Broadcast stats và logs về UI qua Socket.IO.
- Khi startup, đảm bảo schema automation, cleanup queue cũ, khôi phục schedule active, start worker.

### `src/queue.js`

Trả lời:

`queue.js` tạo các BullMQ queue:

- `invite-queue`: chạy automation account.
- `research-queue`: chạy daily AI Research.
- `aff-vid-queue`: render/post AFF video plan.
- `up-post-queue`: publish social post variants.

File này cũng định nghĩa function add job như `addInviteJob`, `addResearchJob`, `addAffVidJob`, `addUpPostJob`. Một số job có backoff exponential, repeat schedule và jobId để tránh duplicate.

### `src/worker.js`

Trả lời:

`worker.js` là nơi consume job từ BullMQ. Worker chính consume `invite-queue`. Mỗi job sẽ:

- Lấy `accountId` và `payload`.
- Insert account nếu chưa có.
- Đọc account từ DB.
- Kiểm tra schedule còn active không.
- Tạo row `tasks` với status `running`.
- Mở browser context theo account.
- Gọi task tương ứng trong `tasks.js`.
- Update task completed/failed.
- Update schedule success_count/failed_count/run_count.
- Emit log/stat realtime.
- Đóng browser trong `finally`.

Ngoài ra file này có worker cho `research-queue`, `aff-vid-queue`, `up-post-queue`.

### `src/browser.js`

Trả lời:

`browser.js` quản lý việc tạo browser context. Nó dùng CloakBrowser `launchPersistentContext` để mở profile riêng cho từng account trong folder `profiles/{accountId}`.

Nó cũng:

- Tạo folder profiles/logs nếu chưa có.
- Lấy hoặc tạo fingerprint cho account.
- Chọn user-agent và viewport từ DB bằng stable hash.
- Lưu fingerprint vào `accounts.fingerprint`.
- Parse proxy format URL hoặc `host:port:user:pass`.
- Cấu hình timezone `Asia/Ho_Chi_Minh`, locale `vi-VN`, viewport, user agent, stealth args.
- Return `{ context, page }` cho worker.

### `src/tasks.js`

Trả lời:

`tasks.js` chứa logic automation thật:

- `autoLogin`: tự động login nếu account bị logout và có email/password.
- `autoInviteTask`: vào group members, tìm nút Add Friend, lọc admin/mod/verified/blacklist, click và scroll.
- `autoUnfollowFriendsTask`: unfollow từ danh sách friends.
- `autoUnfollowFollowingTask`: unfollow từ danh sách following.
- `warmupTask`: thực hiện hành vi như lướt newsfeed, xem watch, like fanpage, gợi ý bạn bè, join group, share bài.

File này phụ thuộc vào Playwright-style locator và các helper như `randomDelay`, `getSettings`, `getBotState`.

## 4. BullMQ, Redis, Queue

### BullMQ là gì?

BullMQ là thư viện queue cho Node.js, dùng Redis làm backend. Nó giúp đưa công việc vào hàng đợi và cho worker xử lý bất đồng bộ.

Trong project này BullMQ giúp:

- Chạy automation task không block API.
- Giới hạn số task chạy đồng thời.
- Hỗ trợ repeat job cho schedule.
- Lưu trạng thái job trong Redis.
- Hỗ trợ attempts/backoff/removeOnComplete/removeOnFail.

### Redis dùng để làm gì?

Redis trong project dùng làm storage cho BullMQ queue. Redis giữ thông tin job waiting, delayed, active, repeatable jobs và trạng thái liên quan của queue.

Redis không thay thế PostgreSQL. PostgreSQL lưu dữ liệu nghiệp vụ lâu dài như accounts, tasks, logs, schedules. Redis lưu job queue runtime.

### `attempts`, `backoff`, `removeOnComplete`, `removeOnFail` là gì?

- `attempts`: số lần thử lại khi job fail.
- `backoff`: khoảng cách giữa các lần retry. Exponential backoff nghĩa là mỗi lần retry thì delay tăng dần.
- `removeOnComplete`: job thành công thì xóa khỏi queue storage.
- `removeOnFail`: job fail có bị xóa không. Trong project để `false` để còn xem lỗi.

### Vì sao invite job để `attempts: 1`?

Automation Facebook dễ tạo tác dụng phụ nếu retry tự động: có thể click lặp, gửi invite lặp, hoặc account bị checkpoint. Vì vậy invite job để `attempts: 1` để tránh retry không kiểm soát. Lỗi được ghi vào DB/log để người dùng xem và chạy lại thủ công nếu cần.

### Concurrency là gì?

Concurrency là số job worker có thể xử lý đồng thời. Trong project, invite worker dùng:

```js
concurrency: parseInt(process.env.MAX_CONCURRENCY || 3)
```

Nếu concurrency quá cao, nhiều browser mở cùng lúc sẽ tốn RAM/CPU, dễ lock profile hoặc làm network/proxy bị quá tải. Nếu quá thấp thì throughput thấp. Nên chọn dựa trên tài nguyên máy và mức rủi ro của website.

## 5. Browser Automation Lý Thuyết

### Browser, Context, Page là gì?

Trong Playwright:

- Browser: tiến trình trình duyệt.
- Browser Context: môi trường độc lập, có cookies/localStorage/session riêng.
- Page: một tab trong context.

Trong project, mỗi account có persistent context riêng để tách session và profile.

### Persistent context là gì?

Persistent context là context có `userDataDir`, nghĩa là browser lưu lại dữ liệu profile trên disk: cookies, localStorage, cache và một số state đăng nhập.

Trong project, `userDataDir = profiles/{accountId}`. Nhờ vậy account A và account B không dùng chung session.

### Vì sao mỗi account cần profile riêng?

Vì mỗi account có:

- Cookie/session riêng.
- Proxy riêng.
- Fingerprint riêng.
- Trạng thái login riêng.
- Lịch sử automation riêng.

Nếu dùng chung profile, account có thể bị lẫn session, sai cookie, hoặc bị rủi ro bảo mật.

### Fingerprint trong project gồm gì?

Fingerprint trong `browser.js` gồm:

- userAgent
- platform
- viewport
- screenWidth/screenHeight
- colorDepth
- deviceScaleFactor
- timezoneId
- locale

Project lấy UA và viewport từ bảng `ua_pool` và `viewport_pool`, sau đó chọn deterministic theo `accountId` bằng `stableHash`. Fingerprint được lưu vào `accounts.fingerprint` để account đó lần sau vẫn dùng cùng fingerprint.

### Proxy là gì?

Proxy là máy trung gian giữa client và server.

Flow:

```text
Client -> Proxy -> Target website
```

Server đích nhìn thấy IP của proxy thay vì IP thật của client.

Trong project, proxy được lưu trong account và parse trong `browser.js`. Project hỗ trợ:

- URL style: `http://user:pass@host:port`
- Shorthand: `host:port:user:pass`

### Headless và headed khác nhau?

- Headless: browser chạy không hiển thị UI, phù hợp server/CI.
- Headed: browser hiển thị UI, phù hợp debug và các website có behavior phức tạp.

Project mở browser với `headless = false` trong worker, để dễ quan sát và phù hợp automation Facebook khi debug.

## 6. Selenium / Playwright / Crawl Web Động

### Selenium và Playwright khác nhau?

Selenium:

- Dựa trên WebDriver protocol.
- Ecosystem lâu đời.
- Hỗ trợ nhiều browser và ngôn ngữ.
- Phổ biến trong automation testing.
- Thường cần explicit wait nhiều hơn.

Playwright:

- API hiện đại.
- Auto-wait tốt.
- Browser context mạnh.
- Network interception tiện lợi.
- Locator ổn định hơn.
- Dễ test multi-tab/multi-context.

Câu trả lời ngắn:

Nếu cần compatibility với WebDriver ecosystem thì Selenium phù hợp. Nếu làm automation/crawling hiện đại, cần auto-wait, context isolation và network control thì em ưu tiên Playwright.

### Auto-wait là gì?

Auto-wait là khả năng Playwright tự chờ element đạt trạng thái phù hợp trước khi thao tác, ví dụ:

- Element tồn tại.
- Visible.
- Stable.
- Enabled.
- Có thể nhận event.

Ví dụ:

```js
await page.locator('button').click();
```

Playwright sẽ tự chờ một số điều kiện thay vì bắt mình dùng fixed sleep quá nhiều.

### Có nên dùng `time.sleep` hoặc `waitForTimeout` nhiều không?

Không nên làm mặc định. Fixed sleep làm script chậm và không ổn định vì network/page load lúc nhanh lúc chậm.

Nên ưu tiên:

- Wait theo selector.
- Wait theo state visible/attached.
- Wait theo response/API.
- Wait theo count item tăng lên khi infinite scroll.

Trong project vẫn có `waitForTimeout` ở một số chỗ, nhưng nếu refactor, em sẽ thay bằng condition-based wait nhiều hơn.

### Crawl web động là gì?

Web động là website mà HTML ban đầu chưa có dữ liệu đầy đủ. JavaScript sẽ gọi API bằng XHR/fetch sau khi page load, rồi render DOM.

Cách xử lý:

1. Mở DevTools -> Network -> Fetch/XHR.
2. Thao tác trên website.
3. Xem endpoint, method, headers, payload, response.
4. Nếu gọi API trực tiếp được thì dùng HTTP request/requests/Scrapy cho nhanh.
5. Nếu cần login, JS execution, captcha, interaction phức tạp thì dùng Selenium/Playwright.

### Requests/Scrapy vs Selenium/Playwright?

Nếu data nằm trong HTML hoặc API có thể gọi trực tiếp, em ưu tiên requests/Scrapy vì nhanh, nhẹ tài nguyên và scale tốt.

Nếu website cần JavaScript render, login flow, interaction browser, scroll, click, session phức tạp thì dùng Selenium/Playwright.

Không nên trả lời "crawl là cứ dùng Selenium". Đó là tư duy chưa tối ưu.

### Selector tốt là gì?

Selector tốt nên ổn định và gắn với ý nghĩa UI:

- id ổn định
- data-testid/data-* nếu có
- aria-label
- role + name
- text selector khi hợp lý
- CSS selector ngắn, ít phụ thuộc DOM nested quá sâu

Facebook hay đổi class nên project ưu tiên aria-label/text/role thay vì class CSS random.

### XPath và CSS selector khác nhau?

CSS selector:

- Ngắn gọn, dễ đọc.
- Phù hợp chọn theo id/class/attribute.
- Thường nhanh và dễ maintain.

XPath:

- Mạnh khi cần chọn theo relationship phức tạp trong DOM.
- Có thể chọn theo text, parent/ancestor/sibling.
- Nhưng XPath dài phụ thuộc structure dễ bị break.

## 7. Logic `autoInviteTask`

### Câu hỏi: `autoInviteTask` chạy như thế nào?

Câu trả lời:

`autoInviteTask` trong `tasks.js` chạy theo flow:

1. Lấy accountId và settings.
2. Đọc text/title hiện tại để detect checkpoint hoặc disabled account.
3. Kiểm tra logged out bằng URL `/login`, input email/pass, text đăng nhập.
4. Nếu logged out thì gọi `autoLogin`.
5. Sau login, quay lại target URL.
6. Đảm bảo URL là trang members/people của group.
7. Wait `[role="main"]` để đảm bảo nội dung chính đã load.
8. Lặp qua số lần scroll tối đa `maxScrolls`.
9. Mỗi vòng tìm Add Friend buttons bằng aria-label/text/role.
10. Lọc bỏ nút cancel/revoke/remove.
11. Đọc text card cha để skip admin/moderator, verified, blacklist keywords.
12. Scroll button vào giữa màn hình.
13. Click bằng `node.click()`.
14. Tăng counters, emit log, update stats.
15. Random delay giữa các thao tác.
16. Scroll tiếp và dừng khi đạt `maxClicks` hoặc stop.

### Câu hỏi: Vì sao project skip admin/mod/verified?

Câu trả lời:

Đây là rule an toàn nghiệp vụ. Admin/mod/verified thường là đối tượng nhạy cảm hơn, việc tự động gửi invite có thể tăng rủi ro bị report hoặc bị đánh dấu bất thường. Vì vậy project có config `skipAdmins` và `skipVerified` để giảm rủi ro.

### Câu hỏi: Vì sao dùng random delay?

Câu trả lời:

Random delay giúp hành vi automation bớt máy móc hơn và cũng giúp page có thời gian render. Thay vì click liên tục với interval cố định, project dùng `randomDelay(min, max)` theo settings.

Nhưng em cũng hiểu random delay không phải giải pháp thần kỳ. Trong production, cần kết hợp limit, error handling, logs, proxy/session management và tuân thủ policy của nền tảng.

### Câu hỏi: Element có tồn tại nhưng click không được vì sao?

Nguyên nhân có thể:

- Element chưa visible.
- Bị overlay che.
- Đang animation.
- Disabled.
- Nằm ngoài viewport.
- DOM re-render gây stale reference.
- Click bị intercept.

Cách xử lý:

- Wait visible/enabled.
- Scroll into view.
- Kiểm tra overlay.
- Locate lại element.
- Dùng Playwright locator.
- Chỉ dùng JS click khi cần và hiểu trade-off.

## 8. Pause / Resume / Stop

### Câu hỏi: Pause/resume/stop được implement thế nào?

Câu trả lời:

Project có `state.js` lưu in-memory state:

```js
{
  isPaused: false,
  isStopped: false
}
```

API `/api/pause` set `isPaused = true`.
API `/api/resume` set `isPaused = false`.
API `/api/stop` set `isStopped = true`, drain/pause queue.

Trong `tasks.js`, các loop automation check `getBotState()`:

- Nếu `isPaused`, task chờ trong while loop.
- Nếu `isStopped`, task break và dừng.

### Câu hỏi: Cách này có hạn chế gì?

Câu trả lời:

Vì state đang lưu in-memory trong Node process, nếu scale nhiều process/worker hoặc server restart thì state sẽ mất hoặc không đồng bộ giữa process. Nếu cần scale production, em sẽ đưa state vào Redis/PostgreSQL hoặc dùng control message qua queue/pubsub.

## 9. Database

### PostgreSQL lưu gì?

Các bảng chính:

- `accounts`: thông tin account, proxy, email, password, daily limit, counters, fingerprint.
- `tasks`: history từng job, status, payload, started/finished, error/result.
- `logs`: log hiển thị UI và audit.
- `automation_schedules`: lịch chạy automation.
- `deleted_accounts`: archive khi hard delete.
- `ua_pool`, `viewport_pool`: pool fingerprint.
- Các bảng AI: `research_results`, `product_trend_results`, `quota_state`, `api_usage_logs`, `aff_video_plans`, `up_post_variants`.

### SQL injection là gì?

SQL injection là lỗi khi input của user được ghép trực tiếp vào SQL string, kẻ tấn công có thể chèn câu lệnh SQL độc hại.

Project dùng parameterized query `$1, $2` với `pg`, ví dụ:

```js
await db.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
```

Cách này giúp tách SQL statement và data, giảm rủi ro injection.

### Password đang lưu plaintext thì sao?

Nếu interviewer hỏi, nên trả lời thẳng:

Trong code hiện tại `fb_password` đang được lưu trực tiếp trong database. Đây là điểm cần cải thiện. Nếu đưa vào production, em sẽ không lưu plaintext. Em sẽ:

- Mã hóa trước khi lưu bằng encryption key trong environment/secret manager.
- Không log password.
- Hạn chế quyền DB.
- Có cơ chế rotate secret.
- Nếu có thể, dùng token/session thay vì password.

## 10. Express API

### `/api/run` làm gì?

`POST /api/run`:

1. Đọc body: accountId, groupUrl, taskType, scheduleType, scheduleTime, scheduleInterval, maxRuns.
2. Validate bằng `normalizeSchedulePayload`.
3. Reset bot state pause/stop.
4. Resume invite queue.
5. Insert row vào `automation_schedules`.
6. Enqueue job cho từng account.
7. Broadcast stats.
8. Trả về `{ success: true, scheduleId }`.

### Vì sao lỗi input trả 400, lỗi server trả 500?

HTTP 400 là lỗi request của client, ví dụ thiếu `groupUrl`, sai `scheduleTime`, taskType không hợp lệ.

HTTP 500 là lỗi phía server, ví dụ DB down, Redis error, exception không mong đợi.

Phân biệt đúng status code giúp frontend và người vận hành debug nhanh hơn.

### Socket.IO dùng làm gì?

Socket.IO dùng để đẩy realtime events:

- `log`: log theo account/system.
- `stats`: queue/account stats.
- `quota_update` và `quota:update`: Gemini quota.
- `cron_status`: trạng thái daily research.
- `cooldown_update`: cooldown research.

Trong automation, worker emit log -> `server.js` lắng nghe -> insert DB logs -> `io.emit` về frontend.

## 11. Scheduling

### Project hỗ trợ những loại schedule nào?

Trong `normalizeSchedulePayload`, schedule type gồm:

- `none`: chạy một lần.
- `time`: chạy mỗi ngày tại giờ HH:mm.
- `interval`: chạy lặp lại mỗi N giờ.

`buildScheduleRepeatOptions` tạo BullMQ repeat option:

- Time schedule: cron pattern `${minute} ${hour} * * *`, timezone `Asia/Ho_Chi_Minh`.
- Interval schedule: `every: hours * 60 * 60 * 1000`.

### Vì sao timezone quan trọng?

Nếu không set timezone, cron có thể chạy theo timezone server/UTC, gây lệch giờ so với người dùng Việt Nam. Project dùng `Asia/Ho_Chi_Minh` để schedule 08:00 hay HH:mm đúng giờ local.

## 12. Error Handling / Logging

### Task fail thì hệ thống làm gì?

Trong worker:

- Catch error.
- Nếu lỗi không phải browser closed thì tăng `accounts.error_count`.
- Update `tasks.status = failed`, lưu `error`, `finished_at`.
- Update schedule `failed_count`.
- Emit log failed.
- Cuối cùng đóng context trong `finally`.

### Vì sao cần `finally`?

Browser automation tốn tài nguyên. Dù task thành công hay fail, vẫn cần cleanup browser context/page để tránh leak RAM, process treo, profile lock. `finally` đảm bảo cleanup dù có exception.

### Production automation cần log gì?

Nên log:

- task_id/job_id
- account_id
- task type
- URL
- start/end time
- status
- retry count
- error message/type
- schedule_id
- proxy server nếu cần, nhưng không log username/password

Không log:

- password
- cookies
- session token
- API key
- raw secret

## 13. AI Research / Gemini

### AI Research module làm gì?

Module AI Research dùng Gemini để tạo dữ liệu nghiên cứu xu hướng sản phẩm, MMO opportunities, AI tools, suggestions, AFF VID plans và UP POST variants.

Nó có:

- API routes trong `research-routes.js`.
- Business logic trong `research-service.js`.
- Gemini client trong `gemini.js`.
- Cache, quota, usage logs.
- Daily research job qua `research-queue`.

### Vì sao cần cache Gemini response?

Cache giúp:

- Giảm chi phí API.
- Giảm latency.
- Tránh gọi lặp cùng prompt.
- Giảm nguy cơ chạm quota.

Trong `gemini.js`, prompt được hash SHA-256 làm cache key, kết quả lưu vào `cached_research` với TTL 24h.

### Quota guard hoạt động thế nào?

Trước khi gọi Gemini, `reserveQuota` tăng request_count nếu chưa vượt hard cap. Nếu call thành công, `finalizeUsage` cộng token usage. Nếu call fail, `rollbackQuotaReservation` giảm request_count lại.

Điều này tránh tình trạng call fail nhưng quota local vẫn bị đếm sai.

### `parseGeminiResponse` để làm gì?

AI có thể trả:

- JSON đúng.
- JSON nằm trong markdown fence.
- Text có chèn giải thích.
- Object/array không nằm đầu chuỗi.

`parseGeminiResponse` cố gắng trích JSON hợp lệ từ response. Nếu không parse được thì trả `{ raw: source }`.

### Nếu AI hallucinate thì sao?

Project có một số cơ chế giảm rủi ro:

- Prompt yêu cầu source_url/source_date/evidence_summary.
- Validate required fields.
- Filter low quality source URL.
- Verify source URL khi có thể.
- Fallback DB/cache khi AI fail.
- Confidence score thấp nếu evidence yếu.

Nhưng em nên thừa nhận: AI hallucination vẫn là rủi ro, nên nếu production cần có verification mạnh hơn và human review cho dữ liệu quan trọng.

## 14. Testing

### Project có test nào?

Hiện có:

- `tests/config.test.js`: test `getSettings`, `saveSettings`, mock `fs`.
- `tests/queue.test.js`: test `addInviteJob`, `addResearchJob`, mock `bullmq` và `ioredis`.

### Vì sao mock trong test?

Vì unit test nên tập trung vào logic function, không cần kết nối Redis hoặc đọc file thật. Mock giúp test nhanh, ổn định, không phụ thuộc external service.

### Test còn thiếu gì?

Còn thiếu:

- API tests cho `/api/run`, accounts, schedules.
- Integration test với PostgreSQL test DB.
- Worker test cho task success/failure.
- Browser automation E2E test ở mức nhỏ.
- Security test cho input validation.
- Test cho proxy parsing/fingerprint assignment.

### Nếu viết test `/api/run` thì làm sao?

Em sẽ dùng Supertest:

- Mock `addInviteJob`.
- Mock DB query hoặc dùng test DB.
- Test missing accountId/groupUrl -> 400.
- Test invalid schedule time -> 400.
- Test valid payload -> insert schedule và enqueue job -> 200.
- Test multi-account -> enqueue nhiều job.

## 15. Câu Hỏi Code Review / Sửa Code Có Sẵn

### Nếu nhận project là code có sẵn, em đọc từ đâu?

Em sẽ đọc theo thứ tự:

1. `package.json` để biết stack, scripts, dependencies.
2. `DOCUMENTATION.md` nếu có.
3. Entry point `src/index.js`, `src/server.js`.
4. API chính `/api/run`.
5. Queue `src/queue.js`.
6. Worker `src/worker.js`.
7. Browser setup `src/browser.js`.
8. Task logic `src/tasks.js`.
9. DB schema/migrations.
10. Tests.

Sau đó em chạy test và chạy app local nếu có Redis/PostgreSQL.

### Nếu AI generate code bị lỗi, em debug thế nào?

Em sẽ:

1. Đọc error message và stack trace.
2. Xác định lỗi ở layer nào: API, queue, worker, browser, DB, frontend.
3. Reproduce lỗi với input nhỏ.
4. Thêm log tạm thời nếu cần.
5. Kiểm tra env: Redis/PostgreSQL/API key/browser.
6. Kiểm tra data trong DB/queue.
7. Sửa nhỏ, chạy lại test.
8. Nếu là automation UI, chụp screenshot/log DOM để xem selector có còn đúng không.

### Nếu thêm task `like_post`, cần sửa file nào?

Cần sửa:

- Frontend: thêm option task type nếu UI chưa có.
- `server.js`: validate `taskType` trong `normalizeSchedulePayload`.
- `queue.js`: có thể không cần sửa nếu vẫn dùng `invite-queue`.
- `worker.js`: thêm branch route `taskType === 'like_post'`.
- `tasks.js`: export function `likePostTask`.
- Database/task history: có thể lưu type mới trong `tasks.type`.
- Tests: thêm test validate payload và worker route.

## 16. Python Cần Ôn Cho JD

### Python mutable vs immutable?

Mutable là object có thể thay đổi sau khi tạo:

- list
- dict
- set

Immutable:

- int
- float
- str
- tuple

### `==` và `is` khác nhau?

- `==` so sánh giá trị.
- `is` so sánh identity, tức hai biến có trỏ tới cùng một object trong memory không.

### `*args` và `**kwargs`?

- `*args`: nhận nhiều positional arguments.
- `**kwargs`: nhận nhiều keyword arguments.

### Generator là gì?

Generator là function dùng `yield`, trả dữ liệu từng phần thay vì load tất cả vào memory. Rất hữu ích khi crawl/process dữ liệu lớn.

### GIL là gì?

GIL là Global Interpreter Lock trong CPython, làm cho tại một thời điểm chỉ một thread thực thi Python bytecode. Tuy nhiên threading vẫn hữu ích với I/O-bound workload như network, DB, browser automation vì nhiều thời gian là chờ I/O.

### Threading, multiprocessing, asyncio?

- Threading: phù hợp I/O-bound, share memory trong process.
- Multiprocessing: phù hợp CPU-bound, mỗi process có memory riêng.
- Asyncio: phù hợp nhiều I/O operations với async APIs.

Trong browser automation, tùy thư viện và workload. Playwright Python có async API nên có thể dùng asyncio. Nếu chạy nhiều browser nặng, cần giới hạn concurrency.

## 17. Scrapy Cần Nắm

### Scrapy là gì?

Scrapy là framework crawl web bằng Python, phù hợp crawl data quy mô lớn khi có thể lấy HTML/API trực tiếp mà không cần browser render quá nhiều.

### Thành phần Scrapy:

- Spider: định nghĩa URL bắt đầu và cách parse response.
- Request: request được scheduler xử lý.
- Response: kết quả trả về từ website.
- Item: cấu trúc dữ liệu crawl được.
- Pipeline: xử lý item, ví dụ clean/save DB.
- Middleware: can thiệp request/response, ví dụ proxy, user-agent, retry.
- Scheduler: quản lý hàng đợi request.

### Scrapy vs Selenium?

Scrapy nhanh và scale tốt cho crawling HTTP. Selenium/Playwright phù hợp website cần JS interaction. Trong production có thể kết hợp: dùng browser để lấy token/session/API endpoint, sau đó dùng HTTP/Scrapy để crawl data quy mô lớn.

## 18. Proxy Pool / Rate Limit / Retry

### Proxy pool là gì?

Proxy pool là tập hợp nhiều proxy được hệ thống quản lý. Mỗi proxy có trạng thái:

- healthy
- failed
- cooldown
- banned
- latency
- failure count
- last used time

Crawler/automation lấy proxy từ pool theo strategy, và khi proxy fail thì đổi proxy, backoff, hoặc cooldown.

### Gặp HTTP 429 thì làm gì?

429 là Too Many Requests. Nên:

- Giảm request rate.
- Giảm concurrency.
- Tôn trọng `Retry-After` nếu có.
- Backoff.
- Xoay proxy nếu hợp lệ.
- Kiểm tra có vi phạm rule website không.

### Retry tốt nên như thế nào?

Không retry vô hạn. Nên:

- Giới hạn số lần retry.
- Chỉ retry lỗi retryable: timeout, 429, 500, 502, 503, 504.
- Exponential backoff.
- Log rõ reason.
- Tránh retry thao tác có side effect như click gửi invite nếu không idempotent.

## 19. React Cần Ôn Cho JD

JD ghi HTML/CSS/JS và có kinh nghiệm Vue hoặc React là một lợi thế. Vì vậy bạn không cần trả lời như senior frontend, nhưng phải nắm chắc nền tảng React và biết liên hệ với project dashboard hiện tại.

### Câu hỏi: React là gì?

Câu trả lời:

React là thư viện JavaScript dùng để xây dựng giao diện người dùng theo hướng component-based. Thay vì viết một trang HTML lớn, mình chia UI thành nhiều component nhỏ, mỗi component nhận dữ liệu qua props, quản lý state riêng nếu cần, và render ra UI.

Ví dụ dashboard automation có thể tách thành:

- `AccountList`
- `RunTaskForm`
- `ScheduleTable`
- `LogPanel`
- `StatsCard`

Điểm mạnh của React là giúp UI dễ tái sử dụng, dễ quản lý state và dễ cập nhật khi dữ liệu thay đổi.

### Câu hỏi: Component là gì?

Component là một khối UI độc lập, có thể nhận input và render ra giao diện.

Ví dụ:

```jsx
function AccountCard({ account }) {
  return (
    <div>
      <h3>{account.name}</h3>
      <p>Status: {account.status}</p>
    </div>
  );
}
```

Trong phỏng vấn có thể nói:

> Component giúp chia UI thành các phần nhỏ, dễ đọc, dễ test và dễ reuse. Ví dụ trong project dashboard, danh sách account có thể là một component, log panel là một component, form chạy task là một component.

### Câu hỏi: Props là gì?

Props là dữ liệu được truyền từ component cha xuống component con.

Ví dụ:

```jsx
function Parent() {
  const account = { name: "Account A", status: "active" };
  return <AccountCard account={account} />;
}
```

`AccountCard` nhận `account` qua props.

Điểm cần nhớ:

- Props truyền một chiều từ parent xuống child.
- Child không nên sửa trực tiếp props.
- Nếu muốn thay đổi dữ liệu, child gọi callback do parent truyền xuống.

### Câu hỏi: State là gì?

State là dữ liệu nội bộ của component, khi state thay đổi thì React render lại UI.

Ví dụ:

```jsx
import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
```

Trong dashboard automation, state có thể là:

- danh sách accounts
- selected account
- task type đang chọn
- logs realtime
- loading/error state
- form input

### Câu hỏi: Props và state khác nhau thế nào?

Câu trả lời:

Props là dữ liệu component nhận từ bên ngoài, thường từ parent truyền xuống. State là dữ liệu component tự quản lý bên trong. Props thường read-only với component con, còn state có thể thay đổi bằng setter như `setState` hoặc `setCount`.

Ví dụ:

- Account row nhận `account` qua props.
- Form component tự quản lý `selectedTaskType` bằng state.

### Câu hỏi: One-way data binding trong React là gì?

React dùng data flow một chiều: dữ liệu đi từ parent xuống child qua props. Nếu child muốn thay đổi dữ liệu, child gọi function callback được parent truyền xuống.

Ví dụ:

```jsx
function Parent() {
  const [taskType, setTaskType] = useState("invite");
  return <TaskSelector value={taskType} onChange={setTaskType} />;
}
```

`TaskSelector` không tự sửa state của parent, mà gọi `onChange`.

### Câu hỏi: Hook là gì?

Hook là function đặc biệt trong React cho phép function component dùng state, lifecycle và các tính năng khác.

Các hook quan trọng:

- `useState`: quản lý state.
- `useEffect`: xử lý side effect như gọi API, subscribe socket, timer.
- `useMemo`: memoize giá trị tính toán.
- `useCallback`: memoize function.
- `useRef`: lưu giá trị không gây re-render hoặc tham chiếu DOM.

### Câu hỏi: `useState` dùng để làm gì?

`useState` dùng để tạo state trong function component.

Ví dụ:

```jsx
const [accounts, setAccounts] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
```

Khi gọi `setAccounts(newAccounts)`, React sẽ render lại component với dữ liệu mới.

### Câu hỏi: `useEffect` dùng để làm gì?

`useEffect` dùng để xử lý side effect, tức là những việc nằm ngoài render thuần túy:

- gọi API
- subscribe Socket.IO
- set interval
- đọc/ghi localStorage
- cleanup event listener

Ví dụ gọi API khi component mount:

```jsx
useEffect(() => {
  async function fetchAccounts() {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data);
  }

  fetchAccounts();
}, []);
```

`[]` nghĩa là effect chạy một lần sau lần render đầu tiên.

### Câu hỏi: Cleanup trong `useEffect` là gì?

Cleanup là function return từ `useEffect`, được chạy khi component unmount hoặc trước khi effect chạy lại.

Ví dụ subscribe Socket.IO:

```jsx
useEffect(() => {
  socket.on("log", handleLog);

  return () => {
    socket.off("log", handleLog);
  };
}, []);
```

Nếu không cleanup, mỗi lần component mount lại có thể tạo thêm listener, gây duplicate logs hoặc memory leak.

### Câu hỏi: Dependency array trong `useEffect` là gì?

Dependency array quyết định khi nào effect chạy lại.

```jsx
useEffect(() => {
  // chạy sau mỗi render
});

useEffect(() => {
  // chạy một lần khi mount
}, []);

useEffect(() => {
  // chạy khi accountId thay đổi
}, [accountId]);
```

Trong phỏng vấn nên nói:

> Nếu dependency thiếu, effect có thể dùng data cũ. Nếu dependency thừa hoặc function/object không ổn định, effect có thể chạy lại quá nhiều.

### Câu hỏi: Controlled component là gì?

Controlled component là form input mà value được quản lý bởi React state.

Ví dụ:

```jsx
function RunForm() {
  const [groupUrl, setGroupUrl] = useState("");

  return (
    <input
      value={groupUrl}
      onChange={(e) => setGroupUrl(e.target.value)}
    />
  );
}
```

Ưu điểm:

- Dễ validate.
- Dễ reset form.
- Dễ submit data.
- UI luôn đồng bộ với state.

### Câu hỏi: Khi nào dùng `useRef`?

`useRef` dùng để lưu giá trị không cần gây re-render, hoặc tham chiếu tới DOM element.

Ví dụ:

```jsx
const logEndRef = useRef(null);

function scrollToBottom() {
  logEndRef.current?.scrollIntoView();
}
```

Trong dashboard logs, `useRef` có thể dùng để auto-scroll xuống cuối log panel.

### Câu hỏi: `useMemo` và `useCallback` dùng để làm gì?

`useMemo` memoize kết quả tính toán.

```jsx
const activeAccounts = useMemo(
  () => accounts.filter(acc => acc.status === "active"),
  [accounts]
);
```

`useCallback` memoize function để tránh tạo function mới không cần thiết.

```jsx
const handleRun = useCallback(() => {
  runTask(selectedAccounts);
}, [selectedAccounts]);
```

Không nên lạm dụng. Chỉ dùng khi có tính toán nặng, component con memoized, hoặc dependency effect cần function ổn định.

### Câu hỏi: React render lại khi nào?

Component render lại khi:

- state thay đổi
- props thay đổi
- parent render lại
- context value thay đổi

Render lại không đồng nghĩa DOM thật thay đổi toàn bộ. React sẽ so sánh virtual DOM và cập nhật phần cần thiết.

### Câu hỏi: Virtual DOM là gì?

Virtual DOM là representation nhẹ của UI trong memory. Khi state/props thay đổi, React tạo virtual DOM mới, so sánh với version cũ, rồi cập nhật DOM thật ở những phần cần thay đổi.

Câu trả lời ngắn:

> Virtual DOM giúp React tính toán sự khác biệt của UI trước khi cập nhật DOM thật, vì thao tác trực tiếp với DOM thật thường tốn chi phí hơn.

### Câu hỏi: Key trong list dùng để làm gì?

Khi render list, `key` giúp React nhận diện item nào thay đổi, thêm, xóa hoặc reorder.

Ví dụ:

```jsx
{accounts.map(account => (
  <AccountRow key={account.id} account={account} />
))}
```

Không nên dùng index làm key nếu list có thể reorder/delete/insert, vì dễ gây bug UI state.

### Câu hỏi: Gọi API trong React như thế nào?

Ví dụ gọi danh sách account:

```jsx
const [accounts, setAccounts] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

useEffect(() => {
  async function loadAccounts() {
    try {
      setLoading(true);
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error("Failed to load accounts");
      const data = await res.json();
      setAccounts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  loadAccounts();
}, []);
```

Điểm cần nói:

- Có loading state.
- Có error handling.
- Check `res.ok`.
- Có thể cleanup/cancel request nếu component unmount.

### Câu hỏi: Nếu frontend React gọi `/api/run` trong project này thì flow sẽ thế nào?

Câu trả lời:

React form sẽ quản lý input như selected accounts, task type, group URL, schedule type. Khi user bấm Run, frontend gọi `POST /api/run` với payload. Nếu API trả success thì UI có thể hiển thị scheduleId/job queued. Sau đó UI không cần chờ automation xong; logs và stats được nhận realtime qua Socket.IO.

Flow:

```text
React form
-> POST /api/run
-> Express validate/enqueue job
-> Worker chạy automation background
-> Socket.IO đẩy logs/stats về React UI
```

### Câu hỏi: React xử lý realtime logs bằng Socket.IO thế nào?

Câu trả lời:

Trong React, mình subscribe socket event trong `useEffect`, update logs state khi có event mới, và cleanup listener khi component unmount.

Ví dụ:

```jsx
useEffect(() => {
  function handleLog(log) {
    setLogs(prev => [...prev, log]);
  }

  socket.on("log", handleLog);

  return () => {
    socket.off("log", handleLog);
  };
}, []);
```

Điểm quan trọng là phải cleanup listener để tránh bị nhận duplicate event sau mỗi lần component mount lại.

### Câu hỏi: Lifting state up là gì?

Lifting state up là đưa state lên component cha chung khi nhiều component con cần dùng hoặc thay đổi cùng một dữ liệu.

Ví dụ:

- `AccountList` chọn accounts.
- `RunTaskForm` cần selected accounts để submit.

Nếu cả hai cần chung `selectedAccountIds`, ta đưa state này lên parent `Dashboard`.

### Câu hỏi: Prop drilling là gì?

Prop drilling là truyền props qua nhiều tầng component trung gian chỉ để đến component con sâu hơn.

Ví dụ:

```text
App -> Dashboard -> Panel -> Toolbar -> RunButton
```

Nếu `RunButton` cần `selectedAccounts`, các component trung gian phải truyền props dù không dùng.

Cách giảm:

- Tổ chức component hợp lý.
- Dùng context cho state dùng rộng.
- Dùng state management nếu app lớn.

### Câu hỏi: React Context là gì?

Context giúp chia sẻ dữ liệu cho nhiều component mà không cần truyền props qua từng tầng.

Ví dụ dùng cho:

- auth user
- theme
- current workspace
- global settings

Không nên dùng Context cho mọi state thay đổi liên tục nếu không cần, vì có thể gây render lại nhiều component.

### Câu hỏi: SPA là gì?

SPA là Single Page Application. Ứng dụng chỉ load một HTML chính, sau đó JavaScript điều khiển routing và cập nhật UI mà không reload toàn bộ trang.

React thường dùng trong SPA. Nếu dashboard của project chuyển sang React, các tab như Accounts, Logs, Schedules, AI Research có thể là route hoặc view trong SPA.

### Câu hỏi: React Router dùng để làm gì?

React Router dùng để quản lý routing phía frontend trong SPA.

Ví dụ:

```text
/accounts
/logs
/schedules
/research
```

Mỗi route render một page/component khác nhau mà không reload toàn bộ trang.

### Câu hỏi: Conditional rendering là gì?

Conditional rendering là render UI theo điều kiện.

Ví dụ:

```jsx
{loading && <Spinner />}
{error && <ErrorMessage message={error} />}
{!loading && accounts.length === 0 && <EmptyState />}
```

Trong dashboard, có thể dùng để hiển thị loading, empty state, error state, hoặc button disabled khi task đang chạy.

### Câu hỏi: Làm form React cần chú ý gì?

Cần chú ý:

- Controlled inputs.
- Validate input trước khi submit.
- Disable button khi loading/submitting.
- Hiển thị lỗi rõ ràng.
- Không gửi payload thiếu field bắt buộc.
- Reset form sau khi thành công nếu phù hợp.

Ví dụ với `/api/run`, cần validate:

- Chọn ít nhất một account.
- Nếu task là `invite` thì phải có group URL.
- Nếu schedule time thì đúng format HH:mm.
- maxRuns/maxUnfollow phải là số hợp lệ.

### Câu hỏi: Làm sao tối ưu performance React?

Các cách phổ biến:

- Chia component hợp lý.
- Tránh state quá global.
- Dùng `React.memo` cho component render nhiều mà props ít đổi.
- Dùng `useMemo` cho tính toán nặng.
- Dùng `useCallback` khi truyền callback xuống memoized child.
- Virtualize list lớn, ví dụ logs hàng nghìn dòng.
- Debounce input search/filter.
- Tránh render list với key không ổn định.

Trong dashboard logs, nếu logs rất nhiều, nên giới hạn số dòng hoặc dùng virtualized list.

### Câu hỏi: React.memo là gì?

`React.memo` giúp component không render lại nếu props không đổi theo shallow comparison.

Ví dụ:

```jsx
const AccountRow = React.memo(function AccountRow({ account }) {
  return <div>{account.name}</div>;
});
```

Nên dùng khi component render nhiều lần, props ổn định, và render cost đáng kể. Không nên lạm dụng nếu component đơn giản.

### Câu hỏi: Error boundary là gì?

Error boundary là component bắt lỗi render ở component con để tránh toàn bộ React app bị crash.

Nó bắt lỗi trong render/lifecycle, nhưng không bắt lỗi async trong event handler hoặc promise. Với async API error, vẫn cần `try/catch` và error state.

### Câu hỏi: React khác Vue thế nào?

Câu trả lời an toàn:

React là library tập trung vào UI component, dùng JSX và JavaScript nhiều hơn. Vue là framework nhẹ hơn theo hướng template, có nhiều convention sẵn và dễ bắt đầu. Cả hai đều component-based, reactive, dùng state/props và phù hợp xây SPA.

Nếu team dùng React hoặc Vue, em có thể học theo codebase. Em đã nắm nền tảng component, state, props, lifecycle/effect và API interaction nên có thể chuyển đổi được.

### Câu hỏi: Nếu chuyển frontend project hiện tại từ vanilla JS sang React, em làm thế nào?

Câu trả lời:

Em sẽ không rewrite toàn bộ ngay. Em sẽ:

1. Xác định các màn hình chính: Accounts, Run Task, Logs, Schedules, AI Research.
2. Tách component theo chức năng: `AccountList`, `TaskForm`, `ScheduleTable`, `LogPanel`, `StatsHeader`.
3. Tạo service layer gọi API: `accountsApi`, `tasksApi`, `schedulesApi`.
4. Tạo socket hook như `useSocketLogs`.
5. Quản lý loading/error state rõ ràng.
6. Giữ behavior cũ trước, sau đó mới refactor UI.

Câu trả lời này cho thấy bạn biết migrate thực tế, không nói rewrite mơ hồ.

### Câu hỏi: Những lỗi React junior hay gặp?

Các lỗi thường gặp:

- Mutate state trực tiếp thay vì dùng setter.
- Quên `key` khi render list.
- Dùng index làm key cho list có reorder/delete.
- Quên dependency trong `useEffect`.
- Không cleanup socket/timer listener.
- Gọi API vô hạn vì dependency sai.
- Không handle loading/error.
- Để state ở component quá cao hoặc quá thấp.
- Props drilling quá nhiều.
- Không validate form trước khi submit.

### Câu trả lời 60 giây khi interviewer hỏi: Em biết React ở mức nào?

Em nắm React ở mức nền tảng để xây dashboard hoặc internal tool. Em hiểu component, props, state, one-way data flow, controlled form và các hook cơ bản như `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`. Em biết gọi API từ React, quản lý loading/error state, render list với key, và cleanup listener trong `useEffect`, ví dụ khi nhận log realtime qua Socket.IO.

Trong project hiện tại frontend đang là HTML/CSS/vanilla JS, nhưng nếu migrate sang React em sẽ tách thành các component như AccountList, TaskForm, ScheduleTable, LogPanel và tạo service layer gọi API. Em chưa nhận mình là frontend chuyên sâu, nhưng em có nền tảng đủ để đọc/sửa code React có sẵn và phát triển các màn hình dashboard cơ bản.

## 20. Câu Hỏi Bẫy Và Cách Trả Lời

### Câu hỏi: Nếu project dùng AI viết, em có thực sự biết code không?

Câu trả lời:

Em hiểu lo ngại này. Em không xem AI là cách để bỏ qua việc học code. Em dùng AI để tăng tốc scaffold và gợi ý, nhưng khi phải chạy project thì em vẫn phải đọc flow, debug lỗi, hiểu module nào làm gì. Hiện tại em có thể giải thích được flow từ API tạo job đến worker mở browser và task automation. Em cũng biết điểm nào trong code cần cải thiện, ví dụ password plaintext, state in-memory, test coverage còn ít, và việc dùng fixed timeout trong automation.

Em chưa nhận mình ở mức senior, nhưng với vị trí intern, em tin điểm mạnh của em là đọc code nhanh, biết đặt câu hỏi đúng, biết dùng tool/AI có trách nhiệm, và sẵn sàng sửa code có sẵn theo requirement.

### Câu hỏi: Em có điểm nào chưa nắm trong project?

Câu trả lời:

Em nắm rõ nhất automation flow, queue/worker, browser context và task logic. Phần AI Research có nhiều business logic và prompt validation dài, em nắm architecture và vai trò của `research-service.js`, `gemini.js`, `research-routes.js`, nhưng chưa dám nói đã nắm từng function nhỏ. Nếu được giao việc liên quan module đó, em sẽ đọc theo route/API cụ thể, chạy test và trace data từ DB.

### Câu hỏi: Nếu được refactor project, em cải thiện gì?

Câu trả lời:

Em sẽ ưu tiên:

1. Bảo mật: mã hóa `fb_password`, tránh lưu plaintext.
2. Tách migration/schema khỏi startup.
3. Đưa pause/resume/stop state vào Redis/DB nếu scale multi-process.
4. Giảm fixed timeout, tăng condition-based wait.
5. Thêm test cho API `/api/run`, worker, proxy parsing, schedule.
6. Chuẩn hóa logging, tránh log sensitive data.
7. Tách task automation thành modules nhỏ hơn theo task type.

## 21. Bộ Câu Trả Lời Ngắn Để Học Thuộc

### 1. Vì sao dùng BullMQ?

Vì automation browser chạy lâu và tốn tài nguyên. BullMQ giúp API không bị block, worker xử lý bất đồng bộ, có concurrency control, repeat schedule, retry/backoff và job history.

### 2. Vì sao dùng persistent profile?

Để mỗi account có cookies/session/fingerprint riêng và không phải login lại mỗi lần. Trong project profile nằm ở `profiles/{accountId}`.

### 3. Vì sao dùng PostgreSQL và Redis cùng lúc?

PostgreSQL lưu data nghiệp vụ lâu dài: account, task, logs, schedule. Redis dùng cho queue runtime của BullMQ: waiting, active, delayed, repeat jobs.

### 4. Vì sao selector Facebook nên dùng aria/text?

Vì class CSS của Facebook thường auto-generated và thay đổi liên tục. Aria-label, role và text gắn với ý nghĩa UI hơn nên ổn định hơn.

### 5. Task fail thì sao?

Worker catch error, update task failed trong DB, update schedule failed_count, emit log realtime, và đóng browser context trong `finally`.

### 6. Nếu Redis chết?

BullMQ queue và workers không thể enqueue/consume job. API liên quan job sẽ lỗi hoặc không chạy được. Data accounts/logs trong PostgreSQL vẫn còn, nhưng automation queue bị dừng.

### 7. Nếu PostgreSQL chết?

Server không đọc/ghi được accounts/tasks/logs/schedules. Worker không lấy được account, không update status, nên automation gần như không hoạt động đúng.

### 8. Nếu Facebook đổi selector?

Em sẽ reproduce lỗi, mở browser debug, inspect DOM, ưu tiên tìm selector ổn định hơn như aria-label/role/text/data attribute nếu có, update locator, thêm fallback selector, và log count element để dễ debug.

### 9. Nếu account bị checkpoint?

Task detect URL `/checkpoint/` hoặc title/text liên quan checkpoint và throw error. Worker ghi task failed/log để người dùng xử lý thủ công, không tiếp tục click.

### 10. Nếu phỏng vấn hỏi Python trong khi project Node.js?

Em nói project này dùng Node.js nhưng concept automation transferable sang Python. Em có thể viết Playwright/Selenium bằng Python dựa trên cùng tư duy: browser/context/page, wait, selector, session, proxy, retry, logging.

## 22. Câu Hỏi Ngược Nên Hỏi Interviewer

Cuối buổi, nên hỏi 2-3 câu:

1. Team hiện tại dùng Selenium, Playwright hay Scrapy nhiều hơn?
2. Công việc crawl chủ yếu là crawl API/HTML hay automation browser cho website động?
3. Hệ thống crawler hiện tại có queue, proxy pool và monitoring chưa?
4. Với intern trong 1-2 tháng đầu, team mong đợi em làm được những task nào?
5. Nếu được nhận, kỹ năng nào em nên cải thiện nhanh nhất để làm tốt vị trí này?

## 23. Checklist Ôn Tập Cấp Tốc

Nếu còn ít thời gian, học theo thứ tự:

1. Flow UI -> API -> Queue -> Worker -> Browser -> Task -> DB/log.
2. Vai trò 5 file: `server.js`, `queue.js`, `worker.js`, `browser.js`, `tasks.js`.
3. BullMQ/Redis/PostgreSQL khác nhau.
4. Browser context, persistent profile, proxy, fingerprint.
5. `autoInviteTask` flow.
6. Selenium vs Playwright, auto-wait, selector, web động.
7. Python basics: GIL, threading, generator, dict/list, exception.
8. Scrapy basics: Spider, Request, Response, Item, Pipeline, Middleware.
9. Câu trả lời trung thực về AI hỗ trợ code.
10. 5 cải tiến nếu refactor project.

## 24. Script Trả Lời 90 Giây Để Mở Đầu

Em là Nguyễn Tấn Phúc, background của em nghiêng về software engineering/backend, nhưng em rất quan tâm web automation và crawling. Project gần nhất em đang ôn là `FLearn-auto-invite`, một automation dashboard dùng Node.js, Express, BullMQ, Redis, PostgreSQL và CloakBrowser/Playwright-compatible.

Project cho phép quản lý nhiều Facebook account, mỗi account có browser profile riêng, proxy và fingerprint riêng. User thao tác trên UI, server nhận API, đưa task vào BullMQ queue, worker lấy job ra, mở persistent browser context theo account, rồi chạy các task như invite, unfollow hoặc warmup. Logs và stats được đẩy realtime về UI bằng Socket.IO và lưu vào PostgreSQL.

Em có dùng AI hỗ trợ trong quá trình xây project, nên em không nhận mình tự code 100%. Điều em tập trung là đọc hiểu flow, chạy/debug, nắm các module chính và học cách sửa code có sẵn. Em thấy project này liên quan trực tiếp đến vị trí automation vì nó dùng các concept như browser context, selector, wait, proxy, queue, retry, logging và session management. Nếu vào công việc dùng Python/Selenium/Playwright, em có thể chuyển các concept này sang stack Python và tiếp tục học sâu hơn.
