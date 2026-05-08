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
const toast = document.getElementById('toast');

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
window.loadSchedules = async () => {
    try {
        const res = await fetch('/api/automation/schedules');
        const schedules = await res.json();
        const tbody = document.getElementById('schedulesTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (schedules.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; opacity:0.6; padding:20px;">Chưa có lịch hẹn nào được tạo.</td></tr>';
            return;
        }

        schedules.forEach(s => {
            const tr = document.createElement('tr');
            const lastRun = s.last_run ? new Date(s.last_run).toLocaleString('vi-VN') : 'Chưa chạy';
            const createdAt = new Date(s.created_at).toLocaleString('vi-VN');
            
            let typeBadge = `<span class="badge" style="background:rgba(99,102,241,0.1);color:#818cf8;border:1px solid rgba(99,102,241,0.2)">${s.task_type}</span>`;
            if (s.task_type === 'unfollow') typeBadge = `<span class="badge" style="background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.2)">${s.task_type}</span>`;

            tr.innerHTML = `
                <td>
                    <div style="font-size:0.7rem; opacity:0.6;">#${s.id.slice(0,8)}</div>
                    ${typeBadge}
                </td>
                <td>
                    <div style="font-size:0.85rem;">${s.account_ids.length} tài khoản</div>
                    <div style="font-size:0.7rem; opacity:0.6;">${s.account_ids.join(', ')}</div>
                </td>
                <td>
                    <div style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.85rem;" title="${s.group_url || 'N/A'}">
                        ${s.group_url ? `<a href="${s.group_url}" target="_blank">${s.group_url}</a>` : 'N/A'}
                    </div>
                </td>
                <td>
                    <div style="font-size:0.85rem; font-weight:600;">${s.schedule_type === 'none' ? 'Chạy ngay' : (s.schedule_type === 'time' ? 'Hàng ngày @ ' + s.schedule_value : 'Lặp lại mỗi ' + s.schedule_value + ' giờ')}</div>
                    <div style="font-size:0.7rem; opacity:0.6;">Tạo: ${createdAt}</div>
                </td>
                <td>
                    <div style="font-size:0.85rem;">${s.total_runs} lượt</div>
                    <div style="font-size:0.7rem; opacity:0.6;">Cuối: ${lastRun}</div>
                </td>
                <td>
                    <span class="status-badge online" style="font-size:0.7rem; padding:2px 6px;">${s.status}</span>
                </td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="viewScheduleHistory('${s.id}')">Lịch Sử</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Lỗi tải lịch:', err);
    }
};

window.viewScheduleHistory = async (id) => {
    const section = document.getElementById('scheduleHistorySection');
    const tbody = document.getElementById('historyTableBody');
    const title = document.getElementById('historyTitle');
    if (!section || !tbody) return;

    section.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Đang tải...</td></tr>';
    title.textContent = `Lịch Sử Chạy (#${id.slice(0,8)})`;
    section.scrollIntoView({ behavior: 'smooth' });

    try {
        const res = await fetch(`/api/automation/history?scheduleId=${id}`);
        const history = await res.json();
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.6; padding:20px;">Lịch hẹn này chưa phát sinh lượt chạy nào.</td></tr>';
            return;
        }

        history.forEach(h => {
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
    const unfollowOptionsContainer = document.getElementById('unfollowOptionsContainer');
    
    if (type === 'unfollow') {
        groupUrlContainer.style.display = 'none';
        groupUrlInput.removeAttribute('required');
        unfollowOptionsContainer.style.display = 'block';
    } else {
        groupUrlContainer.style.display = 'block';
        groupUrlInput.setAttribute('required', 'required');
        unfollowOptionsContainer.style.display = 'none';
    }
};

function renderAccountsTable(accounts) {
    const tbody = document.getElementById('accounts-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeAccounts = (accounts || []).filter(acc => !acc.deleted_at);
    
    if (!activeAccounts || activeAccounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94a3b8;">Chưa có tài khoản nào. Vui lòng thêm mới.</td></tr>';
        return;
    }

    activeAccounts.forEach(acc => {
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

window.softDeleteAccount = (id) => {
    if (!confirm(`Xóa mềm tài khoản "${id}"?`)) return;
    fetch(`/api/accounts/${id}`, { method: 'DELETE' })
        .then(() => { showToast(`Đã xóa mềm: ${id}`); loadAccounts(); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khi xóa!'));
};

window.hardDeleteAccount = (id) => {
    if (!confirm(`XÓA CỨNG "${id}"?`)) return;
    fetch(`/api/accounts/${id}/hard`, { method: 'DELETE' })
        .then(() => { showToast(`Đã xóa cứng: ${id}`); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khi xóa cứng!'));
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
            const badge = document.getElementById('deleted-count-badge');
            if (badge) badge.textContent = accounts.length;

            const tbody = document.getElementById('deleted-accounts-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (accounts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; opacity:0.5;">Không có tài khoản nào.</td></tr>';
                return;
            }

            accounts.forEach(acc => {
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
        });
}

loadAccounts();
loadDeletedAccounts();

function showToast(message) {
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

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
    
    if (type === 'time') {
        timeInput.style.display = 'block';
        intervalInput.style.display = 'none';
        btnSubmit.textContent = 'Hẹn Giờ Bắt Đầu';
    } else if (type === 'interval') {
        timeInput.style.display = 'none';
        intervalInput.style.display = 'block';
        btnSubmit.textContent = 'Tạo Lịch Chạy Lặp Lại';
    } else {
        timeInput.style.display = 'none';
        intervalInput.style.display = 'none';
        btnSubmit.textContent = 'Bắt Đầu';
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
            scheduleInterval
        })
    }).then(() => {
        if (scheduleType === 'none') {
            showToast('Đã đưa vào hàng đợi!');
            document.getElementById('control-buttons').style.display = 'flex';
        } else {
            showToast('Đã thiết lập lịch hẹn giờ thành công!');
        }
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
