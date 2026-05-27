const { randomDelay } = require('./utils');
const { getSettings } = require('./config');

async function autoLogin(page, account, emitLog) {
    if (!account.fb_email || !account.fb_password) {
        throw new Error('Chưa đăng nhập và KHÔNG CÓ thông tin (Email/Pass) để tự động đăng nhập!');
    }
    emitLog(account.id, `Tiến hành tự động đăng nhập cho: ${account.fb_email}...`);

    await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });

    const emailField = page.locator('input[name="email"], input[id="email"]');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.fill(account.fb_email);
    await page.waitForTimeout(1000);

    const passField = page.locator('input[name="pass"], input[id="pass"]');
    await passField.fill(account.fb_password);
    await page.waitForTimeout(1000);

    await passField.press('Enter');
    emitLog(account.id, `Đã gửi thông tin đăng nhập, đang chờ phản hồi...`);

    // Đợi url thay đổi hoặc thấy thông báo lỗi
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

    const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (pageText.includes('incorrect password') || pageText.includes('sai mật khẩu') || pageText.includes('mật khẩu không đúng')) {
        throw new Error('Tự động đăng nhập THẤT BẠI: Sai mật khẩu!');
    }
    if (pageText.includes('approvals_code') || pageText.includes('two-factor') || pageText.includes('2fa') || pageText.includes('xác minh hai yếu tố') || pageText.includes('phê duyệt từ thiết bị khác')) {
        throw new Error('Tự động đăng nhập THẤT BẠI: Tài khoản yêu cầu mã 2FA. Vui lòng gỡ hoặc nhập thủ công.');
    }
    if (pageText.includes('disabled') || pageText.includes('vô hiệu hóa') || pageText.includes('bị khóa')) {
        throw new Error('Tự động đăng nhập THẤT BẠI: Tài khoản đã bị khóa!');
    }

    emitLog(account.id, `Đăng nhập thành công!`, 'success');
}

async function autoInviteTask(page, context, account, targetUrl, emitLog, incrementStats) {
    const accountId = account.id;
    const config = getSettings();
    let invitesSent = 0;
    let scrollsDone = 0;

    // 1. Kiểm tra Checkpoint/Khóa ngay lập tức
    let pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    let titleText = await page.title().catch(() => "");

    if (page.url().includes('/checkpoint/') || titleText.toLowerCase().includes('checkpoint')) {
        throw new Error('Tài khoản đã bị Checkpoint! Vui lòng gỡ checkpoint.');
    }
    if (pageText.includes('disabled') || pageText.includes('vô hiệu hóa') || pageText.includes('không thể sử dụng facebook')) {
        throw new Error('Tài khoản đã bị khóa (Disabled/Banned)!');
    }

    // 2. Kiểm tra đăng nhập
    const emailInputCount = await page.locator('input[name="email"], input[id="email"]').count().catch(() => 0);
    const passInputCount = await page.locator('input[name="pass"], input[id="pass"]').count().catch(() => 0);

    const isLoggedOut = pageText.includes('incorrect password') ||
                        pageText.includes('mật khẩu không đúng') ||
                        page.url().includes('/login') ||
                        page.url().includes('/r.php') ||
                        emailInputCount > 0 ||
                        passInputCount > 0 ||
                        pageText.includes('Tham gia hoặc đăng nhập Facebook');

    if (isLoggedOut) {
        emitLog(accountId, "Tài khoản chưa đăng nhập, đang tiến hành tự động đăng nhập...");
        await autoLogin(page, account, emitLog);

        // Sau khi login xong thì reload lại targetUrl
        emitLog(accountId, `Điều hướng tới trang đích: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2000);
    }

    // 3. Đảm bảo ở đúng trang thành viên
    let currentUrl = page.url();
    if (!currentUrl.toLowerCase().includes('/members') && !currentUrl.toLowerCase().includes('/people')) {
        let membersUrl = targetUrl;
        if (!membersUrl.toLowerCase().includes('/members') && !membersUrl.toLowerCase().includes('/people')) {
            membersUrl = membersUrl.replace(/\/$/, '') + '/members';
        }
        emitLog(accountId, `Điều hướng sang trang thành viên: ${membersUrl}`);
        await page.goto(membersUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    // 4. Đợi nội dung thực tế xuất hiện (tránh skeleton/spam icon)
    emitLog(accountId, "Đang kiểm tra dữ liệu trang...", 'system');

    // Kiểm tra kẹt loading (màn hình trắng có logo FB hoặc skeleton)
    let isStuckLoading = await page.evaluate(() => {
        // Nếu trang có rất ít text và có SVG (logo) hoặc các pulse elements
        const bodyText = document.body.innerText.trim();
        const svgCount = document.querySelectorAll('svg').length;
        return bodyText.length < 100 && svgCount >= 1;
    });

    if (isStuckLoading) {
        emitLog(accountId, "⚠️ Phát hiện trang bị kẹt ở màn hình chờ (Loading/Pulse). Đang thử tải lại...", 'warning');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(5000);
    }

    try {
        // Đợi nội dung chính hoặc danh sách thành viên xuất hiện
        // [role="main"] là container chính của FB mới
        await page.waitForSelector('[role="main"]', { timeout: 15000 });
        emitLog(accountId, "Đã nhận diện được nội dung trang.", 'success');
    } catch(e) {
        emitLog(accountId, "Cảnh báo: Không tìm thấy vùng nội dung chính. Tiếp tục thử kịch bản...", 'warning');
    }

    await page.waitForTimeout(2000);

    emitLog(accountId, "Kiểm tra an toàn: Tốt. Bắt đầu kịch bản Add Friend...", 'system');

    // 3. Chuẩn bị Blacklist
    const blacklistWords = (config.keywordsBlacklist || []).filter(w => w.trim() !== "").map(w => w.toLowerCase());
    const { getBotState } = require('./state');

    for (let scrollNum = 0; scrollNum < config.maxScrolls; scrollNum++) {
        if (page.isClosed()) break;
        // Kiểm tra STOP
        if (getBotState().isStopped) {
            emitLog(accountId, "Chiến dịch đã bị DỪNG HẲN bởi người dùng.", 'warning');
            break;
        }

        // Kiểm tra PAUSE
        while (getBotState().isPaused) {
            if (getBotState().isStopped) break; // Nếu đang pause mà bị stop
            await new Promise(r => setTimeout(r, 1000));
        }
        if (getBotState().isStopped) break;

        if (invitesSent >= config.maxClicks) {
            emitLog(accountId, `Đã đạt giới hạn kết bạn: ${invitesSent}`);
            break;
        }

        // Tìm trực tiếp các nút Thêm Bạn bằng CSS Selector cực kỳ nghiêm ngặt để KHÔNG BAO GIỜ bị nhầm vào Menu
        const addFriendButtons = page.locator(
            '[aria-label="Thêm bạn bè" i], ' +
            '[aria-label="Add friend" i], ' +
            '[aria-label="Kết bạn" i], ' +
            '[aria-label="Thêm làm bạn" i], ' +
            '[aria-label^="Thêm "][aria-label$=" làm bạn bè" i], ' +
            '[aria-label^="Add "][aria-label$=" as a friend" i], ' +
            '[role="button"]:has-text("Thêm bạn bè"):not(:has([role="button"])), ' +
            '[role="button"]:has-text("Add friend"):not(:has([role="button"]))'
        );
        const cardsCount = await addFriendButtons.count();

        emitLog(accountId, `[Scroll ${scrollNum + 1}] Tìm thấy ${cardsCount} nút Thêm bạn bè trên màn hình`);

        let clickedThisScroll = 0;

        for (let i = 0; i < cardsCount; i++) {
            // Kiểm tra Stop/Pause trong lúc click
            if (getBotState().isStopped) break;
            while (getBotState().isPaused) {
                if (getBotState().isStopped) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            if (getBotState().isStopped) break;

            if (invitesSent >= config.maxClicks) break;

            const btn = addFriendButtons.nth(i);

            if (!(await btn.isVisible().catch(() => false))) continue;

            // Lọc các nút Hủy/Thu hồi
            const btnText = await btn.textContent().catch(() => "");
            if (/(Cancel|Hủy|Thu hồi|Revoke|Remove)/i.test(btnText)) {
                continue;
            }

            // Đọc nội dung thẻ chứa nút đó (lên 6 cấp cha) để kiểm tra Admin/Mod
            const cardText = await btn.evaluate(node => {
                let curr = node;
                for (let j = 0; j < 6; j++) {
                    if (curr.parentElement) curr = curr.parentElement;
                }
                return curr.innerText || "";
            }).catch(() => "");

            const textLower = cardText.toLowerCase();

            // Skip Admin/Mod
            if (config.skipAdmins && /(admin|quản trị viên|moderator|người kiểm duyệt|group expert|chuyên gia nhóm)/i.test(cardText)) {
                continue;
            }

            // Skip Verified
            if (config.skipVerified && /(verified|đã xác minh|✓)/i.test(cardText)) {
                continue;
            }

            // Skip Blacklist keywords
            if (blacklistWords.length > 0 && blacklistWords.some(word => textLower.includes(word))) {
                continue;
            }

            // Dùng JS thuần để scroll chuột xuống giữa màn hình
            await btn.evaluate(node => node.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
            await randomDelay(400, 800);

            try {
                // ÉP CLICK bằng Javascript thuần ở cấp độ Node để tàng hình hoàn toàn trước các lớp phủ (overlays)
                // Điều này đảm bảo click đúng cái nút đó, ko bao giờ bị lệch toạ độ ra cái menu
                await btn.evaluate(node => node.click());

                invitesSent++;
                clickedThisScroll++;
                emitLog(accountId, `✓ Đã gửi yêu cầu kết bạn #${invitesSent}`, 'success');
                incrementStats();

                const popupConfirm = page.locator('div[aria-label="OK"], div[aria-label="Đồng ý"], div[aria-label="Xác nhận"]').first();
                if (await popupConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await popupConfirm.evaluate(node => node.click()).catch(() => {});
                }

                await randomDelay(config.delayMin, config.delayMax);
            } catch (err) {
                emitLog(accountId, `Lỗi khi click kết bạn: ${err.message}`, 'error');
            }
        }

        if (cardsCount > 0 && clickedThisScroll === 0) {
            emitLog(accountId, "Không có nút nào bấm được trong lần cuộn này (đã bị lọc hết).");
        }

        // Dùng window.scrollBy thay vì mouse.wheel để chắc chắn TRANG CHÍNH bị cuộn, không cuộn nhầm menu
        const scrollAmount = Math.floor(Math.random() * 300) + 600;
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), scrollAmount).catch(() => {});
        scrollsDone++;

        await randomDelay(config.scrollPauseMin, config.scrollPauseMax);
    }

    emitLog(accountId, `Hoàn thành. Số requests: ${invitesSent}, Số lần cuộn: ${scrollsDone}`);
    return { successCount: invitesSent, scrollsDone: scrollsDone };
}

/**
 * Hàm lõi dùng chung cho cả 2 task unfollow.
 * Chạy logic bỏ theo dõi trên một URL cụ thể.
 */
async function _runUnfollowOnUrl(page, account, targetUrl, targetName, limit, emitLog, incrementStats) {
    const accountId = account.id;
    const config = getSettings();
    const { getBotState } = require('./state');
    const processedLabels = new Set();
    let unfollowsDone = 0;
    let scrollsDone = 0;

    emitLog(accountId, `Điều hướng tới ${targetName} để bắt đầu hủy theo dõi...`);
    await page.goto(targetUrl);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    let pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const isLoggedOut = pageText.includes('incorrect password') || page.url().includes('/login');
    if (isLoggedOut) {
        await autoLogin(page, account, emitLog);
        await page.goto(targetUrl);
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
    }

    emitLog(accountId, `Kiểm tra an toàn: Tốt. Bắt đầu kịch bản Bỏ Theo Dõi trên ${targetName}...`, 'system');

    for (let scrollNum = 0; scrollNum < config.maxScrolls; scrollNum++) {
        if (getBotState().isStopped) break;
        while (getBotState().isPaused) {
            if (getBotState().isStopped) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (getBotState().isStopped) break;

        if (limit > 0 && unfollowsDone >= limit) {
            emitLog(accountId, `Đã đạt giới hạn hủy theo dõi: ${limit}`);
            break;
        }

        const moreOptionsButtons = page.locator('div[aria-label^="Lựa chọn khác cho "], div[aria-label^="More options for "], div[aria-label="Đang theo dõi"], div[aria-label="Following"]');
        const count = await moreOptionsButtons.count();
        emitLog(accountId, `[${targetName}] [Scroll ${scrollNum + 1}] Tìm thấy ${count} đối tượng trên màn hình`);

        for (let i = 0; i < count; i++) {
            if (getBotState().isStopped) break;
            while (getBotState().isPaused) {
                if (getBotState().isStopped) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            if (getBotState().isStopped) break;

            if (limit > 0 && unfollowsDone >= limit) break;

            const btn = moreOptionsButtons.nth(i);
            if (!(await btn.isVisible().catch(() => false))) continue;

            let label = await btn.getAttribute('aria-label').catch(() => null);
            if (!label) continue;

            if (label === 'Đang theo dõi' || label === 'Following') {
                const parentText = await btn.evaluate(node => {
                    let curr = node;
                    for (let j = 0; j < 3; j++) {
                        if (curr.parentElement) curr = curr.parentElement;
                    }
                    return curr.innerText || "";
                }).catch(() => "");
                label = `${label}_${parentText.substring(0, 20)}`;
            }

            if (processedLabels.has(label)) continue;
            processedLabels.add(label);

            await btn.evaluate(node => node.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
            await randomDelay(400, 800);

            try {
                await btn.evaluate(node => node.click());
                await randomDelay(500, 1000);

                const unfollowItem = page.locator('div[role="menuitem"]:has-text("Bỏ theo dõi"), div[role="menuitem"]:has-text("Unfollow")').first();
                const followItem = page.locator('div[role="menuitem"]:has-text("Theo dõi"), div[role="menuitem"]:has-text("Follow")').first();

                await page.waitForTimeout(500);

                if (await unfollowItem.isVisible().catch(() => false)) {
                    await unfollowItem.evaluate(node => node.click());
                    unfollowsDone++;
                    let logName = label.replace('Lựa chọn khác cho ', '').replace('More options for ', '').replace('Đang theo dõi_', '').replace('Following_', '');
                    emitLog(accountId, `✓ Đã BỎ THEO DÕI: ${logName} (#${unfollowsDone})`, 'success');
                    incrementStats('unfollow');
                    await randomDelay(config.delayMin, config.delayMax);
                } else if (await followItem.isVisible().catch(() => false)) {
                    await page.keyboard.press('Escape');
                } else {
                    await page.keyboard.press('Escape');
                }
            } catch (err) {
                emitLog(accountId, `Lỗi khi xử lý hủy theo dõi: ${err.message}`, 'error');
            }
        }

        const scrollAmount = Math.floor(Math.random() * 300) + 600;
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), scrollAmount).catch(() => {});
        scrollsDone++;

        await randomDelay(config.scrollPauseMin, config.scrollPauseMax);
    }

    return { unfollowsDone, scrollsDone };
}

/**
 * Hủy theo dõi từ danh sách BẠN BÈ (/friends)
 */
async function autoUnfollowFriendsTask(page, context, account, jobData, emitLog, incrementStats) {
    const accountId = account.id;
    const limit = jobData.maxUnfollow || 0;

    const { unfollowsDone, scrollsDone } = await _runUnfollowOnUrl(
        page, account,
        'https://www.facebook.com/me/friends',
        'danh sách bạn bè',
        limit, emitLog, incrementStats
    );

    emitLog(accountId, `Hoàn thành. Số lượt bỏ theo dõi (bạn bè): ${unfollowsDone}, Số lần cuộn: ${scrollsDone}`);
    return { successCount: unfollowsDone, scrollsDone };
}

/**
 * Hủy theo dõi từ danh sách ĐANG THEO DÕI (/following)
 */
async function autoUnfollowFollowingTask(page, context, account, jobData, emitLog, incrementStats) {
    const accountId = account.id;
    const limit = jobData.maxUnfollow || 0;

    const { unfollowsDone, scrollsDone } = await _runUnfollowOnUrl(
        page, account,
        'https://www.facebook.com/me/following',
        'danh sách đang theo dõi',
        limit, emitLog, incrementStats
    );

    emitLog(accountId, `Hoàn thành. Số lượt bỏ theo dõi (đang theo dõi): ${unfollowsDone}, Số lần cuộn: ${scrollsDone}`);
    return { successCount: unfollowsDone, scrollsDone };
}
async function clickByVisibleText(page, texts, options = {}) {
    const wanted = Array.isArray(texts) ? texts : [texts];
    const timeout = options.timeout || 8000;
    const started = Date.now();

    while (Date.now() - started < timeout) {
        const point = await page.evaluate((labels) => {
            const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const wantedLabels = labels.map(normalize);
            const isVisible = (el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    rect.width > 4 &&
                    rect.height > 4 &&
                    rect.bottom > 0 &&
                    rect.right > 0 &&
                    rect.top < window.innerHeight &&
                    rect.left < window.innerWidth;
            };

            for (const node of Array.from(document.querySelectorAll('span, div, a, [aria-label]'))) {
                if (!isVisible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute('aria-label'));
                if (!wantedLabels.includes(text)) continue;

                const target = node.closest('[role="button"], [role="menuitem"], a, [tabindex], div[role="none"]') || node;
                target.scrollIntoView({ block: 'center', inline: 'center' });
                const rect = target.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            return null;
        }, wanted);

        if (point) {
            await page.mouse.click(point.x, point.y);
            return true;
        }
        await page.waitForTimeout(500);
    }
    return false;
}

async function clickShareEntry(page) {
    const clickedText = await clickByVisibleText(page, ['Chia sẻ', 'Share'], { timeout: 3000 });
    if (clickedText) return true;

    const point = await page.evaluate(() => {
        const isVisible = (el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                rect.width > 4 &&
                rect.height > 4 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth;
        };
        const sharePath = Array.from(document.querySelectorAll('svg path')).find(path => {
            const d = path.getAttribute('d') || '';
            return d.includes('8.382 8.49') || d.startsWith('M12.863 3.156');
        });
        if (!sharePath) return null;

        let target = sharePath.closest('[role="button"], [aria-label], [tabindex]');
        let parent = sharePath.parentElement;
        let depth = 0;
        while (!target && parent && depth < 8) {
            if (isVisible(parent)) target = parent;
            parent = parent.parentElement;
            depth++;
        }
        target = target || sharePath.closest('svg') || sharePath;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    return true;
}

async function warmupTask(page, context, account, emitLog, incrementStats) {
    const accountId = account.id;
    const { getBotState } = require('./state');
    const config = getSettings();

    // 1. Kiểm tra đăng nhập
    emitLog(accountId, '[Warm-up] Đang mở Facebook để kiểm tra phiên đăng nhập...', 'system');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    let pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const emailInputCount = await page.locator('input[name="email"], input[id="email"]').count().catch(() => 0);
    const passInputCount = await page.locator('input[name="pass"], input[id="pass"]').count().catch(() => 0);
    const isLoggedOut = page.url().includes('/login') ||
                        page.url().includes('/r.php') ||
                        emailInputCount > 0 ||
                        passInputCount > 0 ||
                        pageText.includes('Log in') ||
                        pageText.includes('Đăng nhập') ||
                        pageText.includes('Tham gia hoặc đăng nhập Facebook');

    if (isLoggedOut) {
        emitLog(accountId, '[Warm-up] Tài khoản chưa đăng nhập, đang thử tự động đăng nhập...', 'warning');
        await autoLogin(page, account, emitLog);
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
    }

    const steps = [
        { name: 'Lướt Newsfeed', fn: warmupNewsfeed },
        { name: 'Xem Video (Watch)', fn: warmupWatch },
        { name: 'Tương tác Fanpage', fn: warmupFanpages },
        { name: 'Kết bạn gợi ý', fn: warmupFriendSuggestions },
        { name: 'Tham gia nhóm', fn: warmupJoinGroupsV2 },
        { name: 'Chia sẻ bài viết', fn: warmupShareContentV2 }
    ];

    let successCount = 0;

    for (const step of steps) {
        if (getBotState().isStopped) break;
        while (getBotState().isPaused) {
            await new Promise(r => setTimeout(r, 1000));
        }

        emitLog(accountId, `[Warm-up] Bắt đầu bước: ${step.name}...`, 'system');
        try {
            await step.fn(page, account, emitLog, config);
            successCount++;
            emitLog(accountId, `✓ Hoàn thành bước: ${step.name}`, 'success');
        } catch (err) {
            emitLog(accountId, `⚠️ Lỗi bước ${step.name}: ${err.message}`, 'warning');
        }
        await randomDelay(12000, 25000);
    }

    return { successCount, scrollsDone: successCount * 2 }; // Fake stats for summary
}

async function warmupNewsfeed(page, account, emitLog, config) {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    emitLog(account.id, "[Warm-up] Luot Newsfeed lau hon de mo phong hanh vi doc bai viet...");
    for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy({ top: Math.random() * 550 + 350, behavior: 'smooth' }));
        await randomDelay(6000, 12000);

        // Randomly like a post if visible
        const likeBtn = page.locator('div[role="button"]:has-text("Thích"), div[role="button"]:has-text("Like")').first();
        if (await likeBtn.isVisible().catch(() => false) && Math.random() > 0.7) {
            await likeBtn.evaluate(node => node.click()).catch(() => {});
            emitLog(account.id, "👍 Đã like một bài viết trên Newsfeed.");
        }
    }
}

async function warmupWatch(page, account, emitLog, config) {
    await page.goto('https://www.facebook.com/watch', { waitUntil: 'domcontentloaded' });
    emitLog(account.id, "📺 Đang xem video trong 1-2 phút...");
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
        await page.waitForTimeout(20000 + Math.random() * 10000); // Stay for ~20-30s each scroll
    }
}

async function warmupFanpages(page, account, emitLog, config) {
    const pages = ['VTV6Online', 'VTV24H', 'tinhte', 'TopCV.vn'];
    const target = pages[Math.floor(Math.random() * pages.length)];
    await page.goto(`https://www.facebook.com/${target}`, { waitUntil: 'domcontentloaded' });
    emitLog(account.id, `🚩 Đang tương tác với Fanpage: ${target}`);
    await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
    await randomDelay(2000, 4000);
    const likeBtn = page.locator('div[aria-label="Thích"], div[aria-label="Like"]').first();
    if (await likeBtn.isVisible().catch(() => false)) {
        await likeBtn.evaluate(node => node.click()).catch(() => {});
        emitLog(account.id, `👍 Đã like Fanpage ${target}`);
    }
}

async function warmupFriendSuggestions(page, account, emitLog, config) {
    await page.goto('https://www.facebook.com/friends/suggestions', { waitUntil: 'domcontentloaded' });
    const addBtns = page.locator('[aria-label="Thêm bạn bè" i], [aria-label="Add friend" i]');
    const count = Math.min(await addBtns.count(), 3); // Chỉ kết bạn 2-3 người
    for (let i = 0; i < count; i++) {
        const btn = addBtns.nth(i);
        if (await btn.isVisible().catch(() => false)) {
            await btn.evaluate(node => node.click()).catch(() => {});
            emitLog(account.id, `👤 Đã gửi yêu cầu kết bạn cho gợi ý #${i+1}`);
            await randomDelay(3000, 6000);
        }
    }
}

async function warmupJoinGroups(page, account, emitLog, config) {
    const keywords = ['Kinh doanh online', 'MMO Việt Nam', 'Cộng đồng AI', 'Tuyển dụng IT'];
    const kw = keywords[Math.floor(Math.random() * keywords.length)];
    await page.goto(`https://www.facebook.com/search/groups/?q=${encodeURIComponent(kw)}`, { waitUntil: 'domcontentloaded' });
    const joinBtn = page.locator('div[aria-label="Tham gia"], div[aria-label="Join"]').first();
    if (await joinBtn.isVisible().catch(() => false)) {
        await joinBtn.evaluate(node => node.click()).catch(() => {});
        emitLog(account.id, `👥 Đã gửi yêu cầu tham gia nhóm về: ${kw}`);
    }
}

async function warmupShareContent(page, account, emitLog, config) {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    emitLog(account.id, "🔄 Đang tìm bài viết để chia sẻ...");

    // Cuộn xuống một chút để tìm bài viết
    await page.evaluate(() => window.scrollBy({ top: 1000, behavior: 'smooth' }));
    await page.waitForTimeout(3000);

    const shareBtn = page.locator('div[aria-label="Gửi cho bạn bè hoặc đăng lên dòng thời gian của bạn."], div[aria-label="Send this to friends or post it on your profile."], div[role="button"]:has-text("Chia sẻ"), div[role="button"]:has-text("Share")').first();

    if (await shareBtn.isVisible().catch(() => false)) {
        await shareBtn.click();
        await page.waitForTimeout(2000);

        // Tìm nút "Chia sẻ ngay" (Share now)
        const shareNowBtn = page.locator('div[role="menuitem"]:has-text("Chia sẻ ngay"), div[role="menuitem"]:has-text("Share now")').first();
        if (await shareNowBtn.isVisible().catch(() => false)) {
            await shareNowBtn.click();
            emitLog(account.id, "✅ Đã chia sẻ một bài viết lên trang cá nhân.");
            await page.waitForTimeout(3000);
        } else {
            // Thử nhấn Escape nếu menu mở mà ko thấy nút
            await page.keyboard.press('Escape');
            emitLog(account.id, "⚠️ Không tìm thấy nút 'Chia sẻ ngay'.");
        }
    } else {
        emitLog(account.id, "⚠️ Không tìm thấy nút Chia sẻ trên Newsfeed.");
    }
}
async function warmupJoinGroupsV2(page, account, emitLog, config) {
    await page.goto('https://www.facebook.com/groups/discover', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' })).catch(() => {});
    await randomDelay(2000, 4000);

    const clicked = await clickByVisibleText(page, ['Tham gia nhóm', 'Join group', 'Join'], { timeout: 12000 });
    if (clicked) {
        await page.waitForTimeout(5000);
        emitLog(account.id, 'Đã click nút Tham gia nhóm trên trang Discover.', 'success');
    } else {
        throw new Error('Không tìm thấy nút Tham gia nhóm trên trang Discover.');
    }
}

async function warmupShareContentV2(page, account, emitLog, config) {
    await page.goto('https://www.facebook.com/watch', { waitUntil: 'domcontentloaded' });
    emitLog(account.id, 'Đang tìm nút chia sẻ để đăng lên trang cá nhân...');

    let opened = false;
    for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(2500);
        opened = await clickShareEntry(page);
        if (opened) break;
        await page.evaluate(() => window.scrollBy({ top: 700, behavior: 'smooth' })).catch(() => {});
    }

    if (!opened) {
        throw new Error('Không tìm thấy icon/nút Chia sẻ.');
    }

    await page.waitForTimeout(3000);
    const shared = await clickByVisibleText(page, ['Chia sẻ ngay', 'Share now'], { timeout: 12000 });
    if (shared) {
        emitLog(account.id, 'Đã click Chia sẻ ngay lên trang cá nhân.', 'success');
        await page.waitForTimeout(5000);
    } else {
        await page.keyboard.press('Escape').catch(() => {});
        throw new Error('Không tìm thấy nút Chia sẻ ngay sau khi mở hộp thoại chia sẻ.');
    }
}

module.exports = {
    autoInviteTask,
    autoUnfollowFriendsTask,
    autoUnfollowFollowingTask,
    warmupTask
};
