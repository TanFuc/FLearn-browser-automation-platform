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

async function autoUnfollowTask(page, context, account, jobData, emitLog, incrementStats) {
    const accountId = account.id;
    const config = getSettings();
    let unfollowsDone = 0;
    let scrollsDone = 0;
    const limit = jobData.maxUnfollow || 0;
    
    emitLog(accountId, `Điều hướng tới danh sách bạn bè để bắt đầu hủy theo dõi...`);
    await page.goto('https://www.facebook.com/me/friends');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    // Kiểm tra đăng nhập
    let pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const isLoggedOut = pageText.includes('incorrect password') || page.url().includes('/login');
    if (isLoggedOut) {
        await autoLogin(page, account, emitLog);
        await page.goto('https://www.facebook.com/me/friends');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
    }

    emitLog(accountId, "Kiểm tra an toàn: Tốt. Bắt đầu kịch bản Bỏ Theo Dõi...", 'system');

    const { getBotState } = require('./state');
    const processedLabels = new Set(); // Dùng Set để lưu những bạn đã kiểm tra/bỏ theo dõi

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

        // Tìm tất cả các nút 3 chấm
        const moreOptionsButtons = page.locator('div[aria-label^="Lựa chọn khác cho "], div[aria-label^="More options for "]');
        const count = await moreOptionsButtons.count();
        emitLog(accountId, `[Scroll ${scrollNum + 1}] Tìm thấy ${count} bạn bè trên màn hình`);
        
        let processedThisScroll = 0;
        
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
            
            // Tránh xử lý lại những người đã duyệt qua (kể cả những người đã "Theo dõi" sẵn)
            const label = await btn.getAttribute('aria-label').catch(() => null);
            if (!label || processedLabels.has(label)) continue;
            processedLabels.add(label);

            // Scroll tới nút
            await btn.evaluate(node => node.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
            await randomDelay(400, 800);
            
            try {
                // Nhấn nút 3 chấm
                await btn.evaluate(node => node.click());
                await randomDelay(500, 1000);
                
                const unfollowItem = page.locator('div[role="menuitem"]:has-text("Bỏ theo dõi"), div[role="menuitem"]:has-text("Unfollow")').first();
                const followItem = page.locator('div[role="menuitem"]:has-text("Theo dõi"), div[role="menuitem"]:has-text("Follow")').first();
                
                await page.waitForTimeout(500);

                if (await unfollowItem.isVisible().catch(() => false)) {
                    // Nhấn Bỏ theo dõi
                    await unfollowItem.evaluate(node => node.click());
                    unfollowsDone++;
                    processedThisScroll++;
                    emitLog(accountId, `✓ Đã BỎ THEO DÕI: ${label.replace('Lựa chọn khác cho ', '')} (#${unfollowsDone})`, 'success');
                    incrementStats('unfollow');
                    
                    await randomDelay(config.delayMin, config.delayMax);
                } else if (await followItem.isVisible().catch(() => false)) {
                    // Đã bỏ theo dõi từ trước
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
    
    emitLog(accountId, `Hoàn thành. Số lượt bỏ theo dõi: ${unfollowsDone}, Số lần cuộn: ${scrollsDone}`);
    return { successCount: unfollowsDone, scrollsDone: scrollsDone };
}

module.exports = {
    autoInviteTask,
    autoUnfollowTask
};
