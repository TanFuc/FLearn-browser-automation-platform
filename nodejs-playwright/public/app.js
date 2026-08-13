const socket = io();

// UI Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const logsContainer = document.getElementById('logs-container');
const liveLogsContainer = document.getElementById('live-logs-container');
const runTaskForm = document.getElementById('run-task-form');
const settingsForm = document.getElementById('settings-form');
const addAccountForm = document.getElementById('add-account-form');
const btnClearLogs = document.getElementById('btnClearLogs');

// Stats Elements
const statQueued = document.getElementById('stat-queued');
const statActive = document.getElementById('stat-active');
const statSent = document.getElementById('stat-sent');
const statUnfollows = document.getElementById('stat-unfollows');

let autoScrollLogs = true;
let autoScrollLive = true;

function updateAutoScrollState(container, setState) {
    if (!container) return;
    const threshold = 40;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setState(distanceFromBottom <= threshold);
}

if (logsContainer) {
    logsContainer.addEventListener('scroll', () => {
        updateAutoScrollState(logsContainer, (v) => { autoScrollLogs = v; });
    });
}

if (liveLogsContainer) {
    liveLogsContainer.addEventListener('scroll', () => {
        updateAutoScrollState(liveLogsContainer, (v) => { autoScrollLive = v; });
    });
}

// Tab Navigation logic
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.getAttribute('data-tab');
        console.log('[App] Tab clicked:', targetId);

        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        tabPanes.forEach(t => {
            t.classList.remove('active');
            t.style.display = 'none';
        });

        // Update Header Title based on tab
        const headerTitle = document.getElementById('mainTitle');
        const headerSub = document.getElementById('mainSubTitle');

        const targetPane = document.getElementById(targetId + '-tab');
        if (targetPane) {
            targetPane.classList.add('active');
            targetPane.style.display = 'block';
        }

        if (headerTitle && headerSub) {
            if (targetId === 'dashboard') {
                headerTitle.textContent = 'Trung Tâm Điều Khiển';
                headerSub.textContent = 'Quản lý và theo dõi các chiến dịch tự động kết bạn.';
            } else if (targetId === 'accounts') {
                headerTitle.textContent = 'Quản Lý Tài Khoản';
                headerSub.textContent = 'Thêm mới và theo dõi trạng thái các tài khoản Facebook.';
            } else if (targetId === 'settings') {
                headerTitle.textContent = 'Cài Đặt Hệ Thống';
                headerSub.textContent = 'Cấu hình các thông số hoạt động của bot.';
            } else if (targetId === 'logs') {
                headerTitle.textContent = 'Nhật Ký Hệ Thống';
                headerSub.textContent = 'Xem toàn bộ lịch sử hoạt động của các tiến trình.';
                const container = document.getElementById('logs-container');
                if (container) {
                    autoScrollLogs = true;
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
                }
            } else if (targetId === 'schedules') {
                headerTitle.textContent = 'Quản Lý Lịch Hẹn';
                headerSub.textContent = 'Xem và quản lý các tác vụ đã lên lịch và lịch sử chạy.';
                loadSchedules();
            } else if (targetId === 'research') {
                headerTitle.textContent = 'AI Research Intelligence';
                headerSub.textContent = 'Khám phá cơ hội MMO và công cụ AI mới nhất 2025.';
                const rTab = document.getElementById('research-tab');
                if (rTab) { rTab.style.display = 'block'; rTab.style.opacity = '1'; }
                if (typeof loadMMO === 'function') loadMMO();
            }
        }

        // Handle Research Tab visibility specifically
        const rTab = document.getElementById('research-tab');
        if (rTab && targetId !== 'research') rTab.style.display = 'none';
    });
});

// ─── Schedule Management ──────────────────────────────────────────────────
function getScheduleFilters() {
    return {
        date: document.getElementById('scheduleDateFilter')?.value || '',
        type: document.getElementById('scheduleTypeFilter')?.value || 'all',
        status: document.getElementById('scheduleStatusFilter')?.value || 'all'
    };
}

window.clearScheduleFilters = () => {
    const date = document.getElementById('scheduleDateFilter');
    const type = document.getElementById('scheduleTypeFilter');
    const status = document.getElementById('scheduleStatusFilter');
    if (date) date.value = '';
    if (type) type.value = 'all';
    if (status) status.value = 'all';
    loadSchedules();
};

function renderScheduleSummary(payload) {
    const el = document.getElementById('scheduleSummaryCards');
    if (!el || !payload) return;
    const s = payload.summary || {};
    const sch = payload.schedules || {};
    const totalSchedules = Number(sch.total_schedules || 0);
    const activeSchedules = Number(sch.active_schedules || 0);
    const completedRuns = Number(s.completed || 0);
    const failedRuns = Number(s.failed || 0);
    const totalRuns = Number(s.task_runs || 0);
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
    el.innerHTML = `
        <div class="schedule-summary-tile accent">
            <span class="summary-label">Lịch đang hoạt động</span>
            <strong>${activeSchedules}</strong>
            <small>${totalSchedules} lịch trong bộ lọc</small>
        </div>
        <div class="schedule-summary-tile">
            <span class="summary-label">Lượt chạy</span>
            <strong>${totalRuns}</strong>
            <small>${s.accounts_touched || 0} tài khoản đã chạm</small>
        </div>
        <div class="schedule-summary-tile success">
            <span class="summary-label">Tỷ lệ thành công</span>
            <strong>${successRate}%</strong>
            <small>${completedRuns} lượt thành công</small>
        </div>
        <div class="schedule-summary-tile danger">
            <span class="summary-label">Cần kiểm tra</span>
            <strong>${failedRuns}</strong>
            <small>${sch.cancelled_schedules || 0} lịch đã hủy</small>
        </div>
    `;
}

function scheduleStatusLabel(status) {
    return {
        active: 'Đang hoạt động',
        completed: 'Đã hoàn thành',
        cancelled: 'Đã hủy',
        failed: 'Thất bại'
    }[status] || status || 'Không rõ';
}

function taskTypeLabel(type) {
    if (type === 'create_post') return 'Đăng bài';
    if (type === 'comment_post') return 'Bình luận bài viết';
    return {
        invite: 'Kết bạn',
        unfollow_friends: 'Hủy TD - Bạn Bè',
        unfollow_following: 'Hủy TD - Đang Theo Dõi',
        warmup: 'Nuôi nick'
    }[type] || type || 'Không rõ';
}

function taskTypeTone(type) {
    if (type === 'invite') return 'invite';
    if (type === 'warmup') return 'warmup';
    if (type === 'create_post') return 'warmup';
    if (type === 'comment_post') return 'invite';
    if (type === 'unfollow_friends' || type === 'unfollow_following') return 'unfollow';
    return 'default';
}

function scheduleTypeLabel(type, value) {
    if (type === 'none') return 'Chạy ngay';
    if (type === 'time') return `Hằng ngày ${value || '--:--'}`;
    if (type === 'interval') return `Mỗi ${value || '--'} giờ`;
    return 'Không rõ lịch';
}

function scheduleStatusMeta(status) {
    return {
        active: { label: 'Đang chạy', tone: 'active' },
        completed: { label: 'Hoàn thành', tone: 'completed' },
        cancelled: { label: 'Đã hủy', tone: 'cancelled' },
        failed: { label: 'Thất bại', tone: 'cancelled' }
    }[status] || { label: status || 'Không rõ', tone: 'cancelled' };
}

function compactUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '');
    } catch {
        return String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
}

let scheduleCache = [];
let deletedAccountsCache = [];
let historyCache = [];
let historyScheduleId = null;
const paginationState = {
    accounts: { page: 1, pageSize: 8 },
    schedules: { page: 1, pageSize: 8 },
    deletedAccounts: { page: 1, pageSize: 8 },
    history: { page: 1, pageSize: 8 }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDateTime(value, fallback = 'Chưa có') {
    return value ? new Date(value).toLocaleString('vi-VN') : fallback;
}

function paginateItems(items = [], key) {
    const state = paginationState[key] || { page: 1, pageSize: 8 };
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * state.pageSize;
    return {
        items: items.slice(start, start + state.pageSize),
        total,
        totalPages,
        start,
        end: Math.min(start + state.pageSize, total)
    };
}

function ensurePaginationContainer(anchorId, containerId) {
    let container = document.getElementById(containerId);
    if (container) return container;
    const anchor = document.getElementById(anchorId);
    if (!anchor) return null;
    const table = anchor.closest('table');
    const wrapper = table?.parentElement || anchor.parentElement;
    if (!wrapper) return null;
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'table-pagination';
    wrapper.insertAdjacentElement('afterend', container);
    return container;
}

function renderPagination(anchorId, key, total, renderFn) {
    const container = ensurePaginationContainer(anchorId, `${key}-pagination`);
    if (!container) return;
    const state = paginationState[key];
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (total <= state.pageSize) {
        container.innerHTML = total > 0 ? `<span>Hiển thị ${total}/${total} mục</span>` : '';
        return;
    }
    const start = (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, total);
    container.innerHTML = `
        <div class="pagination-info">Hiển thị ${start}-${end}/${total} mục</div>
        <div class="pagination-controls">
            <button type="button" class="btn btn-outline btn-sm" ${state.page <= 1 ? 'disabled' : ''} data-page-action="prev">Trước</button>
            <span>Trang ${state.page}/${totalPages}</span>
            <button type="button" class="btn btn-outline btn-sm" ${state.page >= totalPages ? 'disabled' : ''} data-page-action="next">Sau</button>
        </div>
    `;
    container.querySelector('[data-page-action="prev"]')?.addEventListener('click', () => {
        state.page -= 1;
        renderFn();
    });
    container.querySelector('[data-page-action="next"]')?.addEventListener('click', () => {
        state.page += 1;
        renderFn();
    });
}

function renderAccountChips(accountIds = []) {
    if (!accountIds.length) return '<span class="schedule-muted">Chưa chọn tài khoản</span>';
    const visible = accountIds.slice(0, 3);
    const hidden = accountIds.length - visible.length;
    const chips = visible.map(id => `<span class="schedule-chip">${escapeHtml(id)}</span>`).join('');
    return `${chips}${hidden > 0 ? `<span class="schedule-chip more">+${hidden}</span>` : ''}`;
}

function scheduleProgress(schedule) {
    const runCount = Number(schedule.run_count || 0);
    const maxRuns = schedule.max_runs ? Number(schedule.max_runs) : null;
    if (!maxRuns) return { label: `${runCount}/không giới hạn`, percent: 0, unlimited: true };
    return {
        label: `${runCount}/${maxRuns}`,
        percent: Math.min(100, Math.round((runCount / maxRuns) * 100)),
        unlimited: false
    };
}

function ensureScheduleEditor() {
    let modal = document.getElementById('scheduleEditorModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'scheduleEditorModal';
    modal.className = 'schedule-editor-backdrop';
    modal.innerHTML = `
        <div class="schedule-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="scheduleEditorTitle">
            <div class="schedule-editor-header">
                <h3 id="scheduleEditorTitle">Chỉnh sửa lịch</h3>
                <button type="button" class="btn btn-outline btn-sm" onclick="closeScheduleEditor()">Đóng</button>
            </div>
            <form id="scheduleEditorForm">
                <input type="hidden" id="scheduleEditId">
                <div class="form-group">
                    <label>Tài khoản</label>
                    <div id="scheduleEditAccounts" class="schedule-edit-accounts"></div>
                </div>
                <div class="form-group">
                    <label>Tác vụ</label>
                    <select id="scheduleEditTaskType" class="filter-select" style="width:100%;" onchange="toggleScheduleEditorTaskUI()">
                        <option value="invite">Kết bạn trong nhóm</option>
                        <option value="unfollow_friends">Hủy theo dõi - Bạn Bè (/friends)</option>
                        <option value="unfollow_following">Hủy theo dõi - Đang Theo Dõi (/following)</option>
                        <option value="warmup">Nuôi nick</option>
                        <option value="create_post">Đăng bài</option>
                        <option value="comment_post">Bình luận bài viết</option>
                    </select>
                </div>
                <div class="form-group" id="scheduleEditGroupWrap">
                    <label>Link nhóm</label>
                    <input type="url" id="scheduleEditGroupUrl" placeholder="https://facebook.com/groups/..." inputmode="url">
                </div>
                <div class="form-group" id="scheduleEditContentWrap">
                    <label id="scheduleEditContentLabel">Nội dung</label>
                    <textarea id="scheduleEditContentText" rows="4" maxlength="1000" style="width:100%; resize:vertical;"></textarea>
                </div>
                <div class="form-group" id="scheduleEditUnfollowWrap">
                    <label>Giới hạn hủy theo dõi</label>
                    <input type="number" id="scheduleEditMaxUnfollow" min="0" max="9999" value="50">
                </div>
                <div class="form-group">
                    <label>Lịch trình</label>
                    <div class="schedule-edit-row">
                        <select id="scheduleEditType" class="filter-select" onchange="toggleScheduleEditorUI()">
                            <option value="none">Chạy ngay</option>
                            <option value="time">Lúc (Giờ:Phút)</option>
                            <option value="interval">Lặp lại mỗi X giờ</option>
                        </select>
                        <input type="time" id="scheduleEditTime" class="filter-select">
                        <input type="number" id="scheduleEditInterval" class="filter-select" min="1" max="72" placeholder="Số giờ">
                    </div>
                </div>
                <div class="form-group">
                    <label>Giới hạn lần chạy</label>
                    <input type="number" id="scheduleEditMaxRuns" min="1" max="999" placeholder="Để trống nếu không giới hạn">
                </div>
                <div class="schedule-editor-actions">
                    <button type="button" class="btn btn-outline" onclick="closeScheduleEditor()">Hủy</button>
                    <button type="submit" class="btn btn-primary">Lưu lịch</button>
                </div>
            </form>
        </div>
    `;
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeScheduleEditor();
    });
    document.body.appendChild(modal);
    document.getElementById('scheduleEditorForm').addEventListener('submit', saveScheduleEdit);
    return modal;
}

function renderScheduleAccountChoices(selectedIds) {
    const box = document.getElementById('scheduleEditAccounts');
    if (!box) return;
    const knownIds = new Set((loadedAccounts || []).map(acc => acc.id));
    const allAccounts = [...(loadedAccounts || [])];
    (selectedIds || []).forEach(id => {
        if (!knownIds.has(id)) allAccounts.push({ id, name: '', status: 'unknown' });
    });

    box.innerHTML = allAccounts.map(acc => {
        const checked = selectedIds.includes(acc.id) ? 'checked' : '';
        const display = acc.name ? `${acc.id} - ${acc.name}` : acc.id;
        return `
            <label class="custom-checkbox multiselect-option">
                <input type="checkbox" value="${escapeHtml(acc.id)}" ${checked}>
                <span class="checkmark"></span>
                <span class="checkbox-label">${escapeHtml(display)} (${escapeHtml(acc.status || 'active')})</span>
            </label>
        `;
    }).join('');
}

window.toggleScheduleEditorTaskUI = () => {
    const type = document.getElementById('scheduleEditTaskType')?.value;
    const groupWrap = document.getElementById('scheduleEditGroupWrap');
    const unfollowWrap = document.getElementById('scheduleEditUnfollowWrap');
    const contentWrap = document.getElementById('scheduleEditContentWrap');
    const contentLabel = document.getElementById('scheduleEditContentLabel');
    const contentText = document.getElementById('scheduleEditContentText');
    if (!groupWrap || !unfollowWrap || !contentWrap) return;
    groupWrap.style.display = type === 'invite' || type === 'comment_post' || type === 'create_post' ? 'block' : 'none';
    unfollowWrap.style.display = type === 'unfollow_friends' || type === 'unfollow_following' ? 'block' : 'none';
    contentWrap.style.display = type === 'comment_post' || type === 'create_post' ? 'block' : 'none';
    if (contentLabel) contentLabel.textContent = type === 'create_post' ? 'Nội dung bài viết' : 'Nội dung bình luận';
    if (contentText) contentText.setAttribute('maxlength', type === 'create_post' ? '1000' : '500');
};

window.toggleScheduleEditorUI = () => {
    const type = document.getElementById('scheduleEditType')?.value;
    const time = document.getElementById('scheduleEditTime');
    const interval = document.getElementById('scheduleEditInterval');
    if (!time || !interval) return;
    time.style.display = type === 'time' ? 'block' : 'none';
    interval.style.display = type === 'interval' ? 'block' : 'none';
};

window.closeScheduleEditor = () => {
    const modal = document.getElementById('scheduleEditorModal');
    if (modal) modal.classList.remove('show');
};

window.editSchedule = async (id) => {
    let schedule = scheduleCache.find(item => item.id === id);
    if (!schedule) {
        const res = await fetch(`/api/automation/schedules/${id}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
            showToast(json.error || 'Không tải được lịch cần sửa', 'error');
            return;
        }
        schedule = json.data;
    }

    const modal = ensureScheduleEditor();
    document.getElementById('scheduleEditId').value = schedule.id;
    document.getElementById('scheduleEditTaskType').value = schedule.task_type || 'invite';
    document.getElementById('scheduleEditGroupUrl').value = schedule.group_url || '';
    document.getElementById('scheduleEditContentText').value = schedule.comment_text || '';
    document.getElementById('scheduleEditMaxUnfollow').value = schedule.max_unfollow || 0;
    document.getElementById('scheduleEditType').value = schedule.schedule_type || 'none';
    document.getElementById('scheduleEditTime').value = schedule.schedule_type === 'time' ? (schedule.schedule_value || '') : '';
    document.getElementById('scheduleEditInterval').value = schedule.schedule_type === 'interval' ? (schedule.schedule_value || '') : '';
    document.getElementById('scheduleEditMaxRuns').value = schedule.max_runs || '';
    renderScheduleAccountChoices(schedule.account_ids || []);
    toggleScheduleEditorTaskUI();
    toggleScheduleEditorUI();
    modal.classList.add('show');
};

async function saveScheduleEdit(event) {
    event.preventDefault();
    const id = document.getElementById('scheduleEditId').value;
    const accountId = [...document.querySelectorAll('#scheduleEditAccounts input:checked')].map(input => input.value);
    const taskType = document.getElementById('scheduleEditTaskType').value;
    const groupUrl = document.getElementById('scheduleEditGroupUrl').value.trim();
    const scheduleType = document.getElementById('scheduleEditType').value;
    const scheduleTime = document.getElementById('scheduleEditTime').value;
    const scheduleInterval = document.getElementById('scheduleEditInterval').value;
    const maxRuns = document.getElementById('scheduleEditMaxRuns').value;
    const maxUnfollow = document.getElementById('scheduleEditMaxUnfollow').value || 0;
    const commentText = document.getElementById('scheduleEditContentText')?.value.trim() || '';

    if (accountId.length === 0) return showToast('Chọn ít nhất 1 tài khoản.', 'warning');
    if (taskType === 'invite' && !groupUrl) return showToast('Vui lòng nhập link nhóm.', 'warning');
    if ((taskType === 'comment_post' || taskType === 'create_post') && !commentText) return showToast('Vui lòng nhập nội dung.', 'warning');
    if (scheduleType === 'time' && !scheduleTime) return showToast('Vui lòng chọn giờ chạy.', 'warning');
    if (scheduleType === 'interval' && (!scheduleInterval || Number(scheduleInterval) < 1)) return showToast('Vui lòng nhập khoảng cách giờ hợp lệ.', 'warning');

    try {
        const res = await fetch(`/api/automation/schedules/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, taskType, groupUrl, maxUnfollow, commentText, scheduleType, scheduleTime, scheduleInterval, maxRuns })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Không thể cập nhật lịch');
        closeScheduleEditor();
        showToast('Đã cập nhật lịch thành công.', 'success');
        loadSchedules();
    } catch (err) {
        showToast(err.message || 'Lỗi khi cập nhật lịch', 'error');
    }
}

window.duplicateSchedule = async (id) => {
    const ok = await showConfirm({
        title: 'Nhân bản lịch',
        message: 'Tạo một lịch mới với cùng cấu hình và đặt số lần chạy về 0?',
        confirmText: 'Nhân bản',
        cancelText: 'Hủy'
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/automation/schedules/${id}/duplicate`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Không thể nhân bản lịch');
        showToast('Đã nhân bản lịch thành công.', 'success');
        loadSchedules();
    } catch (err) {
        showToast(err.message || 'Lỗi khi nhân bản lịch', 'error');
    }
};

window.loadSchedules = async () => {
    try {
        const filters = getScheduleFilters();
        const qs = new URLSearchParams();
        if (filters.date) qs.set('date', filters.date);
        if (filters.type !== 'all') qs.set('type', filters.type);
        if (filters.status !== 'all') qs.set('status', filters.status);

        const [scheduleRes, summaryRes] = await Promise.all([
            fetch('/api/automation/schedules?' + qs.toString()),
            fetch('/api/automation/summary?' + qs.toString())
        ]);
        const scheduleJson = await scheduleRes.json();
        const summaryJson = await summaryRes.json().catch(() => null);
        if (!scheduleRes.ok || !scheduleJson.success) throw new Error(scheduleJson.error || 'Lỗi tải lịch hẹn');
        if (summaryRes.ok && summaryJson?.success) renderScheduleSummary(summaryJson);

        const schedules = scheduleJson.data || [];
        scheduleCache = schedules;
        const tbody = document.getElementById('schedulesTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (schedules.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; opacity:0.6; padding:20px;">Chưa có lịch hẹn nào phù hợp bộ lọc.</td></tr>';
            renderPagination('schedulesTableBody', 'schedules', 0, () => loadSchedules());
            return;
        }

        const pageData = paginateItems(schedules, 'schedules');
        renderPagination('schedulesTableBody', 'schedules', schedules.length, () => loadSchedules());

        pageData.items.forEach(s => {
            const tr = document.createElement('tr');
            tr.className = 'schedule-row';
            const accountIds = s.account_ids || [];
            const lastRun = formatDateTime(s.last_run, 'Chưa chạy');
            const createdAt = formatDateTime(s.created_at, 'Không rõ');
            const updatedAt = formatDateTime(s.updated_at || s.created_at, 'Không rõ');
            const progress = scheduleProgress(s);
            const statusMeta = scheduleStatusMeta(s.status);
            const typeBadge = `<span class="schedule-task-badge ${taskTypeTone(s.task_type)}">${taskTypeLabel(s.task_type)}</span>`;
            const scheduleLabel = scheduleTypeLabel(s.schedule_type, s.schedule_value);
            const successCount = Number(s.success_count || 0);
            const failedCount = Number(s.failed_count || 0);
            const totalTasks = Number(s.total_tasks || 0);
            const groupHtml = s.group_url
                ? `<a href="${escapeHtml(s.group_url)}" target="_blank" title="${escapeHtml(s.group_url)}">${escapeHtml(compactUrl(s.group_url))}</a>`
                : '<span class="schedule-muted">Không cần link nhóm</span>';
            const targetDetail = s.task_type === 'invite'
                ? 'Nguồn nhóm mục tiêu'
                : s.task_type === 'warmup'
                    ? 'Warm-up tài khoản'
                    : `Giới hạn ${s.max_unfollow || 0} lượt`;

            tr.innerHTML = `
                <td class="schedule-col-main">
                    <div class="schedule-row-title">
                        <span class="schedule-id">#${escapeHtml(s.id.slice(0, 8))}</span>
                        ${typeBadge}
                    </div>
                    <div class="schedule-main-text">${scheduleLabel}</div>
                    <div class="schedule-detail-line">Tạo ${createdAt}</div>
                    <div class="schedule-detail-line">Cập nhật ${updatedAt}</div>
                </td>
                <td>
                    <div class="schedule-account-count">${accountIds.length} tài khoản</div>
                    <div class="schedule-chip-row">${renderAccountChips(accountIds)}</div>
                </td>
                <td>
                    <div class="schedule-link">${groupHtml}</div>
                    <div class="schedule-detail-line">${targetDetail}</div>
                </td>
                <td>
                    <div class="schedule-progress-head"><b>${progress.label}</b><span>${progress.unlimited ? 'mở' : `${progress.percent}%`}</span></div>
                    <div class="schedule-progress-track ${progress.unlimited ? 'unlimited' : ''}"><span style="width:${progress.unlimited ? 100 : progress.percent}%"></span></div>
                    <div class="schedule-detail-line">${progress.unlimited ? 'Không giới hạn số lần chạy' : 'Theo giới hạn đã đặt'}</div>
                </td>
                <td>
                    <div class="schedule-result-grid">
                        <span><b>${totalTasks}</b><small>Task</small></span>
                        <span class="ok"><b>${successCount}</b><small>OK</small></span>
                        <span class="fail"><b>${failedCount}</b><small>Fail</small></span>
                    </div>
                    <div class="schedule-detail-line">Gần nhất ${lastRun}</div>
                </td>
                <td><span class="schedule-status ${statusMeta.tone}"><span></span>${statusMeta.label}</span></td>
                <td class="schedule-action-cell">
                    <div class="schedule-action-grid" aria-label="Thao tác lịch #${escapeHtml(s.id.slice(0, 8))}">
                        <button class="schedule-action-btn neutral" type="button" onclick="viewScheduleHistory('${s.id}')" title="Xem lịch sử chạy">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"></path><path d="M7 14l3-3 4 4 5-7"></path></svg>
                        </button>
                        <button class="schedule-action-btn primary" type="button" onclick="editSchedule('${s.id}')" title="Chỉnh sửa lịch">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="schedule-action-btn secondary" type="button" onclick="duplicateSchedule('${s.id}')" title="Nhân bản lịch">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M4 16V6a2 2 0 0 1 2-2h10"></path></svg>
                        </button>
                        <button class="schedule-action-btn danger" type="button" onclick="cancelSchedule('${s.id}')" title="Hủy lịch">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Lỗi tải lịch:', err);
        showToast(err.message || 'Lỗi tải lịch hẹn');
    }
};
window.viewScheduleHistory = async (id) => {
    const section = document.getElementById('scheduleHistorySection');
    const tbody = document.getElementById('historyTableBody');
    const title = document.getElementById('historyTitle');
    if (!section || !tbody) return;

    historyScheduleId = id;
    section.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Đang tải...</td></tr>';
    title.textContent = `Lịch Sử Chạy (#${id.slice(0,8)})`;
    section.scrollIntoView({ behavior: 'smooth' });

    try {
        const res = await fetch(`/api/automation/history?scheduleId=${id}`);
        const historyJson = await res.json();
        const history = historyJson.data || historyJson;
        historyCache = history;
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.6; padding:20px;">Lịch hẹn này chưa phát sinh lượt chạy nào.</td></tr>';
            renderPagination('historyTableBody', 'history', 0, () => historyScheduleId && viewScheduleHistory(historyScheduleId));
            return;
        }

        const pageData = paginateItems(history, 'history');
        renderPagination('historyTableBody', 'history', history.length, () => historyScheduleId && viewScheduleHistory(historyScheduleId));

        pageData.items.forEach(h => {
            const tr = document.createElement('tr');
            const start = new Date(h.started_at).toLocaleString('vi-VN');
            const duration = h.finished_at ? Math.round((new Date(h.finished_at) - new Date(h.started_at)) / 1000) + 's' : 'Đang chạy...';

            let statusCls = h.status === 'completed' ? 'success' : (h.status === 'failed' ? 'error' : 'warning');

            tr.innerHTML = `
                <td style="font-size:0.85rem;">${start}</td>
                <td><b>${h.account_id}</b> <br><small>${h.account_name || ''}</small></td>
                <td><span class="status-badge" style="background:var(--${statusCls}); color:#fff; font-size:0.7rem;">${h.status}</span></td>
                <td style="max-width:300px; font-size:0.8rem; font-family:monospace;">
                    ${h.status === 'failed' ? `<span style="color:var(--error)">${h.error || h.error_message || 'N/A'}</span>` : (h.result_summary || 'Thành công')}
                </td>
                <td style="font-size:0.85rem;">${duration}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--error);">Lỗi: ${err.message}</td></tr>`;
    }
};

window.closeHistory = () => {
    document.getElementById('scheduleHistorySection').style.display = 'none';
};

window.cancelSchedule = async (id) => {
    const ok = await showConfirm({
        title: 'Hủy lịch hẹn',
        message: 'Bạn có chắc chắn muốn hủy lịch hẹn này không? Các lượt chạy lặp lại trong tương lai sẽ dừng lại.',
        confirmText: 'Hủy lịch',
        cancelText: 'Giữ lại'
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/automation/schedules/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('Đã hủy lịch hẹn thành công.');
            loadSchedules();
        } else {
            showToast('Lỗi: ' + data.error);
        }
    } catch (err) {
        showToast('Lỗi khi kết nối server.');
    }
};


// Load configuration on mount
fetch('/api/config')
    .then(res => res.json())
    .then(data => {
        document.getElementById('maxScrolls').value = data.maxScrolls;
        document.getElementById('maxClicks').value = data.maxClicks;
        document.getElementById('delayMin').value = data.delayMin;
        document.getElementById('delayMax').value = data.delayMax;
        document.getElementById('scrollPauseMin').value = data.scrollPauseMin;
        document.getElementById('scrollPauseMax').value = data.scrollPauseMax;
        document.getElementById('skipAdmins').checked = data.skipAdmins;
        document.getElementById('skipVerified').checked = data.skipVerified;
    });

let loadedAccounts = []; // To store global account state
let selectedAccountIds = []; // To store selected accounts for the custom multiselect

window.toggleMultiselect = () => {
    document.getElementById('multiselect-options').classList.toggle('show');
};

document.addEventListener('click', (e) => {
    const ms = document.getElementById('accountMultiselect');
    if (ms && !ms.contains(e.target)) {
        document.getElementById('multiselect-options').classList.remove('show');
    }
});

function updateMultiselectText() {
    const textEl = document.getElementById('multiselect-selected-text');
    if (selectedAccountIds.length === 0) {
        textEl.textContent = '-- Chọn tài khoản --';
    } else if (selectedAccountIds.length === 1) {
        textEl.textContent = `1 tài khoản đã chọn (${selectedAccountIds[0]})`;
    } else {
        textEl.textContent = `${selectedAccountIds.length} tài khoản đã chọn`;
    }
}

window.toggleTaskTypeUI = () => {
    const type = document.getElementById('taskType').value;
    const groupUrlContainer = document.getElementById('groupUrlContainer');
    const groupUrlInput = document.getElementById('groupUrl');
    const groupUrlLabel = document.getElementById('groupUrlLabel');
    const unfollowOptionsContainer = document.getElementById('unfollowOptionsContainer');
    const commentOptionsContainer = document.getElementById('commentOptionsContainer');
    const commentTextInput = document.getElementById('commentText');
    const commentTextLabel = document.getElementById('commentTextLabel');
    const commentTextHint = document.getElementById('commentTextHint');

    if (type === 'unfollow_friends' || type === 'unfollow_following') {
        groupUrlContainer.style.display = 'none';
        groupUrlInput.removeAttribute('required');
        unfollowOptionsContainer.style.display = 'block';
        if (commentOptionsContainer) commentOptionsContainer.style.display = 'none';
        if (commentTextInput) commentTextInput.removeAttribute('required');
    } else if (type === 'warmup') {
        groupUrlContainer.style.display = 'none';
        groupUrlInput.removeAttribute('required');
        unfollowOptionsContainer.style.display = 'none';
        if (commentOptionsContainer) commentOptionsContainer.style.display = 'none';
        if (commentTextInput) commentTextInput.removeAttribute('required');
    } else if (type === 'comment_post') {
        groupUrlContainer.style.display = 'block';
        groupUrlInput.removeAttribute('required');
        groupUrlInput.placeholder = 'https://facebook.com/.../posts/... hoặc để trống để quét News Feed';
        if (groupUrlLabel) groupUrlLabel.textContent = 'Link Bài Viết (tùy chọn)';
        unfollowOptionsContainer.style.display = 'none';
        if (commentOptionsContainer) commentOptionsContainer.style.display = 'block';
        if (commentTextLabel) commentTextLabel.textContent = 'Nội dung bình luận';
        if (commentTextInput) commentTextInput.placeholder = 'Nhập nội dung bình luận để gửi vào bài viết...';
        if (commentTextHint) commentTextHint.textContent = 'Mỗi account chỉ gửi 1 bình luận/lần chạy. Nếu bỏ trống link bài viết, bot sẽ mở News Feed và thử tìm ô bình luận đầu tiên.';
        if (commentTextInput) commentTextInput.setAttribute('maxlength', '500');
        if (commentTextInput) commentTextInput.setAttribute('required', 'required');
    } else if (type === 'create_post') {
        groupUrlContainer.style.display = 'block';
        groupUrlInput.removeAttribute('required');
        groupUrlInput.placeholder = 'Để trống để đăng lên trang cá nhân, hoặc nhập link group/page';
        if (groupUrlLabel) groupUrlLabel.textContent = 'Link Đích (tùy chọn)';
        unfollowOptionsContainer.style.display = 'none';
        if (commentOptionsContainer) commentOptionsContainer.style.display = 'block';
        if (commentTextLabel) commentTextLabel.textContent = 'Nội dung bài viết';
        if (commentTextInput) commentTextInput.placeholder = 'Nhập nội dung bài viết để đăng...';
        if (commentTextHint) commentTextHint.textContent = 'Mỗi account chỉ đăng 1 bài/lần chạy. Nếu bỏ trống link đích, bot sẽ đăng trên trang cá nhân/news feed.';
        if (commentTextInput) commentTextInput.setAttribute('maxlength', '1000');
        if (commentTextInput) commentTextInput.setAttribute('required', 'required');
    } else {
        groupUrlContainer.style.display = 'block';
        groupUrlInput.setAttribute('required', 'required');
        groupUrlInput.placeholder = 'https://facebook.com/groups/...';
        if (groupUrlLabel) groupUrlLabel.textContent = 'Link Nhóm';
        unfollowOptionsContainer.style.display = 'none';
        if (commentOptionsContainer) commentOptionsContainer.style.display = 'none';
        if (commentTextInput) commentTextInput.removeAttribute('required');
    }
};

function renderAccountsTable(accounts) {
    const tbody = document.getElementById('accounts-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeAccounts = (accounts || []).filter(acc => !acc.deleted_at);

    if (!activeAccounts || activeAccounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94a3b8;">Chưa có tài khoản nào. Vui lòng thêm mới.</td></tr>';
        renderPagination('accounts-table-body', 'accounts', 0, () => renderAccountsTable(loadedAccounts));
        return;
    }

    const pageData = paginateItems(activeAccounts, 'accounts');
    renderPagination('accounts-table-body', 'accounts', activeAccounts.length, () => renderAccountsTable(loadedAccounts));

    pageData.items.forEach(acc => {
        const tr = document.createElement('tr');
        let statusColor = 'var(--text-main)';
        if (acc.status === 'active') statusColor = 'var(--success)';
        if (acc.status === 'error' || acc.status === 'checkpoint') statusColor = 'var(--error)';

        const displayGroup = acc.group_url
            ? `<a href="${acc.group_url}" target="_blank" style="color:var(--primary);text-decoration:none;">Nhóm đích ↗</a>`
            : 'Chưa có';

        const displayName = acc.name
            ? `<span style="font-weight:600;">${acc.name}</span><br><span style="font-size:0.78rem;color:var(--text-muted);">${acc.id}</span>`
            : `<span style="font-weight:600;">${acc.id}</span>`;

        tr.innerHTML = `
            <td>${displayName}</td>
            <td style="color: ${statusColor}; font-weight: 500; text-transform: capitalize;">${acc.status}</td>
            <td>${displayGroup}</td>
            <td><b style="color: var(--primary);">${acc.invites_sent_today || 0}</b> / ${acc.daily_limit}</td>
            <td><b style="color: var(--error);">${acc.unfollows_today || 0}</b></td>
            <td>
                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-secondary" onclick="editAccount('${acc.id}')" style="padding: 4px 10px; font-size: 0.8rem;">Sửa</button>
                    <button type="button" class="btn" onclick="openBrowser('${acc.id}')" style="padding: 4px 10px; font-size: 0.8rem; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--primary);">Mở</button>
                    <button type="button" class="btn" onclick="softDeleteAccount('${acc.id}')" style="padding: 4px 10px; font-size: 0.8rem; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); color: #fbbf24;" title="Xóa mềm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Open Browser Logic
window.openBrowser = (id) => {
    showToast(`Đang mở trình duyệt cho ${id}...`);
    fetch(`/api/accounts/${id}/browser`, { method: 'POST' })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Lỗi khi mở trình duyệt');
            } else {
                showToast('Trình duyệt đã được mở thành công!');
            }
        })
        .catch(err => {
            showToast('Lỗi mạng khi mở trình duyệt');
        });
};

function loadAccounts() {
    fetch('/api/accounts')
        .then(res => res.json())
        .then(accounts => {
            loadedAccounts = accounts;
            const optionsContainer = document.getElementById('multiselect-options');
            if (!optionsContainer) return;
            optionsContainer.innerHTML = '';

            accounts.forEach(acc => {
                const label = document.createElement('label');
                label.className = 'custom-checkbox multiselect-option';

                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = acc.id;
                if (selectedAccountIds.includes(acc.id)) input.checked = true;

                input.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        if (!selectedAccountIds.includes(acc.id)) selectedAccountIds.push(acc.id);
                        if (selectedAccountIds.length === 1 && acc.group_url) {
                            document.getElementById('groupUrl').value = acc.group_url;
                        }
                    } else {
                        selectedAccountIds = selectedAccountIds.filter(id => id !== acc.id);
                    }
                    updateMultiselectText();
                });

                const checkmark = document.createElement('span');
                checkmark.className = 'checkmark';

                const text = document.createElement('span');
                text.className = 'checkbox-label';
                const displayName = acc.name ? `${acc.id} - ${acc.name}` : acc.id;
                text.textContent = `${displayName} (${acc.status})`;

                label.appendChild(input);
                label.appendChild(checkmark);
                label.appendChild(text);

                optionsContainer.appendChild(label);
            });
            updateMultiselectText();
            renderAccountsTable(accounts);
        });
}

let editingId = null;

window.editAccount = (id) => {
    const acc = loadedAccounts.find(a => a.id === id);
    if (!acc) return;

    editingId = id;

    document.getElementById('newAccountId').value = acc.id;
    document.getElementById('newAccountId').setAttribute('readonly', true);
    document.getElementById('newAccountId').style.opacity = '0.6';
    document.getElementById('newAccountName').value = acc.name || '';
    document.getElementById('newAccountProxy').value = acc.proxy || '';
    document.getElementById('newAccountGroupUrl').value = acc.group_url || '';
    document.getElementById('newAccountEmail').value = acc.fb_email || '';
    document.getElementById('newAccountPassword').value = acc.fb_password || '';
    document.getElementById('newAccountLimit').value = acc.daily_limit;

    const submitBtn = document.querySelector('#add-account-form button[type="submit"]');
    submitBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline></svg> Cập Nhật Tài Khoản`;
    submitBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';

    let cancelBtn = document.getElementById('btnCancelEdit');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'btnCancelEdit';
        cancelBtn.className = 'btn btn-secondary full-width';
        cancelBtn.style.marginTop = '8px';
        cancelBtn.textContent = 'Hủy Sửa';
        cancelBtn.addEventListener('click', resetAccountForm);
        submitBtn.parentElement.appendChild(cancelBtn);
    }
    cancelBtn.style.display = 'block';

    document.querySelector('[data-tab="accounts"]').click();
    document.getElementById('add-account-form').scrollIntoView({ behavior: 'smooth' });
};

function resetAccountForm() {
    editingId = null;
    addAccountForm.reset();
    document.getElementById('newAccountLimit').value = 50;
    document.getElementById('newAccountId').removeAttribute('readonly');
    document.getElementById('newAccountId').style.opacity = '1';
    document.getElementById('generate-id-btn').click();

    const submitBtn = document.querySelector('#add-account-form button[type="submit"]');
    submitBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Lưu Tài Khoản`;
    submitBtn.style.background = '';

    const cancelBtn = document.getElementById('btnCancelEdit');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

window.softDeleteAccount = async (id) => {
    const ok = await showConfirm({
        title: 'Xóa mềm tài khoản',
        message: `Bạn có muốn xóa mềm tài khoản "${id}" không?`,
        confirmText: 'Xóa mềm',
        cancelText: 'Hủy'
    });
    if (!ok) return;
    fetch(`/api/accounts/${id}`, { method: 'DELETE' })
        .then(() => { showToast(`Đã xóa mềm: ${id}`, 'success'); loadAccounts(); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khi xóa!', 'error'));
};

window.hardDeleteAccount = async (id) => {
    const ok = await showConfirm({
        title: 'Xóa cứng tài khoản',
        message: `Thao tác này sẽ xóa vĩnh viễn tài khoản "${id}". Bạn chắc chắn muốn tiếp tục?`,
        confirmText: 'Xóa vĩnh viễn',
        cancelText: 'Hủy'
    });
    if (!ok) return;
    fetch(`/api/accounts/${id}/hard`, { method: 'DELETE' })
        .then(() => { showToast(`Đã xóa cứng: ${id}`, 'success'); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khi xóa cứng!', 'error'));
};

window.restoreAccount = (id) => {
    fetch(`/api/accounts/${id}/restore`, { method: 'POST' })
        .then(() => { showToast(`Đã khôi phục: ${id}`); loadAccounts(); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khôi phục!'));
};

window.toggleDeletedSection = () => {
    const section = document.getElementById('deleted-accounts-section');
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
    if (section.style.display === 'block') loadDeletedAccounts();
};

function loadDeletedAccounts() {
    fetch('/api/accounts/deleted')
        .then(res => res.json())
        .then(accounts => {
            deletedAccountsCache = accounts || [];
            const badge = document.getElementById('deleted-count-badge');
            if (badge) badge.textContent = deletedAccountsCache.length;
            renderDeletedAccountsTable();
        });
}

function renderDeletedAccountsTable() {
    const tbody = document.getElementById('deleted-accounts-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (deletedAccountsCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; opacity:0.5;">Không có tài khoản nào.</td></tr>';
        renderPagination('deleted-accounts-table-body', 'deletedAccounts', 0, renderDeletedAccountsTable);
        return;
    }

    const pageData = paginateItems(deletedAccountsCache, 'deletedAccounts');
    renderPagination('deleted-accounts-table-body', 'deletedAccounts', deletedAccountsCache.length, renderDeletedAccountsTable);

    pageData.items.forEach(acc => {
        const tr = document.createElement('tr');
        const deletedAt = acc.deleted_at ? new Date(acc.deleted_at).toLocaleString('vi-VN') : '-';
        const displayName = acc.name
            ? `<span style="font-weight:600;">${acc.name}</span><br><span style="font-size:0.78rem;color:var(--text-muted);">${acc.id}</span>`
            : `<span style="font-weight:600;">${acc.id}</span>`;

        tr.innerHTML = `
            <td>${displayName}</td>
            <td>${acc.fb_email || '-'}</td>
            <td style="color: #fbbf24;">${deletedAt}</td>
            <td>
                <div style="display:flex; gap:5px;">
                    <button type="button" class="btn" onclick="restoreAccount('${acc.id}')" style="padding:4px 10px; font-size:0.8rem; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); color:#34d399;">Khôi Phục</button>
                    <button type="button" class="btn" onclick="hardDeleteAccount('${acc.id}')" style="padding:4px 10px; font-size:0.8rem; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); color:#f87171;">Xóa Cứng</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

loadAccounts();
loadDeletedAccounts();

settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const config = {
        maxScrolls: parseInt(document.getElementById('maxScrolls').value),
        maxClicks: parseInt(document.getElementById('maxClicks').value),
        delayMin: parseInt(document.getElementById('delayMin').value),
        delayMax: parseInt(document.getElementById('delayMax').value),
        scrollPauseMin: parseInt(document.getElementById('scrollPauseMin').value),
        scrollPauseMax: parseInt(document.getElementById('scrollPauseMax').value),
        skipAdmins: document.getElementById('skipAdmins').checked,
        skipVerified: document.getElementById('skipVerified').checked,
    };

    fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    }).then(() => {
        showToast('Đã lưu cấu hình!');
    });
});

window.toggleScheduleUI = () => {
    const type = document.getElementById('scheduleType').value;
    const timeInput = document.getElementById('scheduleTime');
    const intervalInput = document.getElementById('scheduleInterval');
    const btnSubmit = document.getElementById('btnSubmitRun');
    const hint = document.getElementById('scheduleHint');

    if (type === 'time') {
        timeInput.style.display = 'block';
        intervalInput.style.display = 'none';
        btnSubmit.textContent = 'Hẹn Giờ Bắt Đầu';
        if (hint) hint.textContent = 'Lịch sẽ chạy hằng ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh).';
    } else if (type === 'interval') {
        timeInput.style.display = 'none';
        intervalInput.style.display = 'block';
        btnSubmit.textContent = 'Tạo Lịch Chạy Lặp Lại';
        if (hint) hint.textContent = 'Bot sẽ chạy lặp lại theo khoảng cách giờ đã nhập.';
    } else {
        timeInput.style.display = 'none';
        intervalInput.style.display = 'none';
        btnSubmit.textContent = 'Bắt Đầu';
        if (hint) hint.textContent = 'Bot sẽ chạy lập tức nếu chọn "Chạy ngay".';
    }
};

runTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const accountIds = selectedAccountIds;
    const taskType = document.getElementById('taskType').value;
    const groupUrl = document.getElementById('groupUrl').value;
    const maxUnfollow = document.getElementById('maxUnfollow').value;
    const scheduleType = document.getElementById('scheduleType').value;
    const scheduleTime = document.getElementById('scheduleTime').value;
    const scheduleInterval = document.getElementById('scheduleInterval').value;
    const maxRuns = document.getElementById('scheduleMaxRuns')?.value || '';
    const commentText = document.getElementById('commentText')?.value.trim() || '';

    if (accountIds.length === 0) {
        showToast('Chọn ít nhất 1 tài khoản!');
        return;
    }

    if (scheduleType === 'time' && !scheduleTime) {
        showToast('Vui lòng chọn giờ bắt đầu!');
        return;
    }

    if (scheduleType === 'interval' && (!scheduleInterval || scheduleInterval < 1)) {
        showToast('Vui lòng nhập khoảng cách giờ hợp lệ!');
        return;
    }

    if ((taskType === 'comment_post' || taskType === 'create_post') && !commentText) {
        showToast(taskType === 'create_post' ? 'Vui lòng nhập nội dung bài viết!' : 'Vui lòng nhập nội dung bình luận!');
        return;
    }

    fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            accountId: accountIds,
            groupUrl,
            taskType,
            maxUnfollow,
            scheduleType,
            scheduleTime,
            scheduleInterval,
            maxRuns,
            commentText
        })
    }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Không thể đưa tác vụ vào hàng đợi');
        }
        if (scheduleType === 'none') {
            showToast('Đã đưa vào hàng đợi!');
            document.getElementById('control-buttons').style.display = 'flex';
        } else {
            showToast('Đã thiết lập lịch hẹn giờ thành công!');
        }
        loadSchedules();
    }).catch((err) => {
        showToast(err.message || 'Lỗi khi khởi chạy tác vụ');
    });
});

addAccountForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('newAccountId').value.trim();
    const name = document.getElementById('newAccountName').value.trim();
    const proxy = document.getElementById('newAccountProxy').value.trim();
    const group_url = document.getElementById('newAccountGroupUrl').value.trim();
    const fb_email = document.getElementById('newAccountEmail').value.trim();
    const fb_password = document.getElementById('newAccountPassword').value.trim();
    const daily_limit = parseInt(document.getElementById('newAccountLimit').value);

    const isEditing = editingId !== null;
    const url = isEditing ? `/api/accounts/${editingId}` : '/api/accounts';
    const method = isEditing ? 'PUT' : 'POST';

    fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, proxy, daily_limit, group_url, fb_email, fb_password })
    }).then(() => {
        showToast(isEditing ? 'Cập nhật thành công!' : 'Thêm thành công!');
        resetAccountForm();
        loadAccounts();
    });
});

document.getElementById('generate-id-btn').addEventListener('click', () => {
    const date = new Date();
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const randomStr = Math.random().toString(36).substring(2, 6);
    document.getElementById('newAccountId').value = `fa_${yy}${mm}${dd}_${randomStr}`;
});

function addLog(message, type = 'info', timestamp = null, options = {}) {
    if (!liveLogsContainer || !logsContainer) return;
    const { toLive = true, toFull = true } = options;

    let timeStr = timestamp ? new Date(timestamp).toLocaleTimeString('vi-VN', { hour12: false }) : new Date().toLocaleTimeString('vi-VN', { hour12: false });

    const el = document.createElement('div');
    el.className = `log-line ${type}`;
    el.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-msg">${message}</span>`;

    if (toFull) {
        logsContainer.appendChild(el);
        if (autoScrollLogs) logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    if (toLive) {
        const liveEl = el.cloneNode(true);
        liveLogsContainer.appendChild(liveEl);
        if (autoScrollLive) liveLogsContainer.scrollTop = liveLogsContainer.scrollHeight;

        const maxLiveLines = 40;
        while (liveLogsContainer.children.length > maxLiveLines) {
            liveLogsContainer.removeChild(liveLogsContainer.firstChild);
        }
    }
}

function loadLogs() {
    fetch('/api/logs')
        .then(res => res.json())
        .then(logs => {
            if (logs && logs.length > 0) {
                logsContainer.innerHTML = '';
                logs.forEach(log => {
                    addLog(`[${log.account_id}] ${log.message}`, log.type || 'info', log.created_at, { toLive: false, toFull: true });
                });
                // Cuộn xuống cuối sau khi tải xong
                if (logsContainer) {
                    autoScrollLogs = true;
                    logsContainer.scrollTop = logsContainer.scrollHeight;
                }
            }
        });
}

loadLogs();

socket.on('connect', () => {
    const badge = document.querySelector('.status-badge');
    if (badge) { badge.innerText = 'Hệ Thống Đang Kết Nối'; badge.classList.add('online'); }
});

socket.on('log', (data) => {
    addLog(`[${data.accountId}] ${data.message}`, data.type || 'info');
});

socket.on('stats', (data) => {
    if(data.queued !== undefined) statQueued.innerText = data.queued;
    if(data.active !== undefined) statActive.innerText = data.active;
    if(data.sent !== undefined) statSent.innerText = data.sent;
    if(data.unfollows !== undefined) statUnfollows.innerText = data.unfollows;
    if(data.accounts !== undefined) renderAccountsTable(data.accounts);
});

window.stopAllTasks = () => {
    fetch('/api/stop', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast('Hệ thống đang dừng...');
                document.getElementById('control-buttons').style.display = 'none';
            }
        }).catch(err => showToast('Lỗi khi dừng hệ thống'));
};

let isPaused = false;
window.pauseAllTasks = () => {
    const btn = document.getElementById('btnPause');
    if (!isPaused) {
        fetch('/api/pause', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    isPaused = true;
                    btn.textContent = 'Tiếp Tục';
                    btn.classList.remove('btn-warning');
                    btn.classList.add('btn-success');
                    showToast('Đã tạm dừng');
                }
            }).catch(err => showToast('Lỗi khi tạm dừng'));
    } else {
        fetch('/api/resume', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    isPaused = false;
                    btn.textContent = 'Tạm Dừng';
                    btn.classList.remove('btn-success');
                    btn.classList.add('btn-warning');
                    showToast('Đã tiếp tục');
                }
            }).catch(err => showToast('Lỗi khi tiếp tục'));
    }
};
