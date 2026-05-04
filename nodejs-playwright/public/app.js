const socket = io();

// UI Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const logsContainer = document.getElementById('logs-container');
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

// Tab Navigation logic
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.getAttribute('data-tab');
        
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        tabPanes.forEach(t => t.classList.remove('active'));
        document.getElementById(targetId + '-tab').classList.add('active');
    });
});

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
    tbody.innerHTML = '';
    
    if (!accounts || accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94a3b8;">Chưa có tài khoản nào. Vui lòng thêm mới.</td></tr>';
        return;
    }

    accounts.forEach(acc => {
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

// Fetch Accounts initially for select options
function loadAccounts() {
    fetch('/api/accounts')
        .then(res => res.json())
        .then(accounts => {
            loadedAccounts = accounts;
            const optionsContainer = document.getElementById('multiselect-options');
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
                text.textContent = `${acc.id} (${acc.status})`;
                
                label.appendChild(input);
                label.appendChild(checkmark);
                label.appendChild(text);
                
                optionsContainer.appendChild(label);
            });
            updateMultiselectText();
            renderAccountsTable(accounts);
        });
}

// Track editing mode
let editingId = null;

// Edit Account Logic
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

    // Update form button
    const submitBtn = document.querySelector('#add-account-form button[type="submit"]');
    submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline></svg> Cập Nhật Tài Khoản`;
    submitBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';

    // Show cancel button
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

    // Switch to accounts tab and scroll
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
    submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Lưu Tài Khoản`;
    submitBtn.style.background = '';

    const cancelBtn = document.getElementById('btnCancelEdit');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// Soft Delete
window.softDeleteAccount = (id) => {
    if (!confirm(`Xóa mềm tài khoản "${id}"? Tài khoản sẽ bị ẩn khỏi danh sách nhưng có thể khôi phục.`)) return;
    fetch(`/api/accounts/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => { showToast(`Đã xóa mềm: ${id}`); loadAccounts(); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khi xóa!'));
};

// Hard Delete
window.hardDeleteAccount = (id) => {
    if (!confirm(`XÓA CỨNG "${id}"? Hành động này KHÔNG thể hoàn tác! Tài khoản sẽ bị xóa vĩnh viễn khỏi CSDL.`)) return;
    fetch(`/api/accounts/${id}/hard`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => { showToast(`Đã xóa cứng: ${id}`); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khi xóa cứng!'));
};

// Restore Account
window.restoreAccount = (id) => {
    fetch(`/api/accounts/${id}/restore`, { method: 'POST' })
        .then(res => res.json())
        .then(() => { showToast(`Đã khôi phục: ${id}`); loadAccounts(); loadDeletedAccounts(); })
        .catch(() => showToast('Lỗi khôi phục!'));
};

// Toggle deleted section
window.toggleDeletedSection = () => {
    const section = document.getElementById('deleted-accounts-section');
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
    if (section.style.display === 'block') loadDeletedAccounts();
};

// Load soft-deleted accounts
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
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; opacity:0.5;">Không có tài khoản nào đã xóa mềm.</td></tr>';
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
        })
        .catch(console.error);
}

// Auto-fill Group URL when selecting account in Dashboard (now handled inside loadAccounts checkbox event)

loadAccounts();
loadDeletedAccounts();

// Show notification toast
function showToast(message) {
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Handle settings submission
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

    const btn = document.getElementById('btnSaveSettings');
    btn.innerHTML = 'Đang lưu...';
    btn.disabled = true;

    fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    }).then(() => {
        showToast('Đã lưu cấu hình thành công!');
        addLog('Đã cập nhật cấu hình hệ thống.', 'system');
        
        setTimeout(() => {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Lưu Cấu Hình`;
            btn.disabled = false;
        }, 500);
    });
});

// Handle Run task submission
runTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const accountIds = selectedAccountIds;
    const taskType = document.getElementById('taskType').value;
    const groupUrl = document.getElementById('groupUrl').value;
    const maxUnfollow = document.getElementById('maxUnfollow').value;
    const btn = document.getElementById('btnRun');
    
    if (accountIds.length === 0) {
        showToast('Vui lòng chọn ít nhất 1 tài khoản!');
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = 'Đang đưa vào hàng đợi...';

    fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountIds, groupUrl, taskType, maxUnfollow })
    })
    .then(res => res.json())
    .then(data => {
        addLog(`Đã xếp hàng đợi cho các tài khoản: ${accountIds.join(', ')}`, 'system');
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Bắt Đầu Chạy`;
            
            // Hiện các nút điều khiển
            document.getElementById('control-buttons').style.display = 'flex';
            document.getElementById('btnPause').style.display = 'flex';
            document.getElementById('btnResume').style.display = 'none';
        }, 1000);
    })
    .catch(err => {
        addLog(`Lỗi khởi tạo tác vụ: ${err}`, 'error');
        btn.disabled = false;
    });
});

// Logic cho nút Tạm Dừng
document.getElementById('btnPause').addEventListener('click', () => {
    fetch('/api/pause', { method: 'POST' }).then(() => {
        document.getElementById('btnPause').style.display = 'none';
        document.getElementById('btnResume').style.display = 'flex';
    });
});

// Logic cho nút Tiếp Tục
document.getElementById('btnResume').addEventListener('click', () => {
    fetch('/api/resume', { method: 'POST' }).then(() => {
        document.getElementById('btnResume').style.display = 'none';
        document.getElementById('btnPause').style.display = 'flex';
    });
});

// Logic cho nút Dừng Hẳn
document.getElementById('btnStop').addEventListener('click', () => {
    if(confirm('Bạn có chắc chắn muốn DỪNG HẲN chiến dịch đang chạy?')) {
        fetch('/api/stop', { method: 'POST' }).then(() => {
            document.getElementById('control-buttons').style.display = 'none'; // Ẩn control
        });
    }
});

// Handle Add / Update Account
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
    })
    .then(res => res.json())
    .then(data => {
        showToast(isEditing ? 'Cập nhật tài khoản thành công!' : 'Thêm tài khoản thành công!');
        resetAccountForm();
        loadAccounts();
    })
    .catch(err => {
        showToast('Lỗi khi lưu tài khoản!');
    });
});

// Auto Generate ID Logic
document.getElementById('generate-id-btn').addEventListener('click', () => {
    // Format: fa_YYMMDD_XXXX
    const date = new Date();
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const randomStr = Math.random().toString(36).substring(2, 6);
    document.getElementById('newAccountId').value = `fa_${yy}${mm}${dd}_${randomStr}`;
});

// Auto trigger ID generation on load
if (!document.getElementById('newAccountId').value) {
    document.getElementById('generate-id-btn').click();
}

// Natural Config Suggestion
document.getElementById('btnNaturalConfig').addEventListener('click', () => {
    // Randomize human-like delays
    const delayMin = Math.floor(Math.random() * (1200 - 800 + 1) + 800);
    const delayMax = Math.floor(Math.random() * (3500 - 2500 + 1) + 2500);
    
    const scrollMin = Math.floor(Math.random() * (2500 - 1800 + 1) + 1800);
    const scrollMax = Math.floor(Math.random() * (6000 - 4500 + 1) + 4500);
    
    document.getElementById('delayMin').value = delayMin;
    document.getElementById('delayMax').value = delayMax;
    document.getElementById('scrollPauseMin').value = scrollMin;
    document.getElementById('scrollPauseMax').value = scrollMax;
    
    // Add visual feedback to the button
    const btn = document.getElementById('btnNaturalConfig');
    btn.style.background = 'rgba(16, 185, 129, 0.2)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
        btn.style.background = 'rgba(255,255,255,0.1)';
        btn.style.borderColor = 'rgba(255,255,255,0.2)';
    }, 500);

    showToast('Đã gợi ý bộ thông số ngẫu nhiên mô phỏng người thật. Vui lòng bấm Lưu!');
});

// Toggle Password Logic
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const passwordInput = document.getElementById('newAccountPassword');

togglePasswordBtn.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    
    if (type === 'password') {
        togglePasswordBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        togglePasswordBtn.title = "Hiện mật khẩu";
    } else {
        togglePasswordBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        togglePasswordBtn.title = "Ẩn mật khẩu";
    }
});

// Clear Logs manually
btnClearLogs.addEventListener('click', () => {
    logsContainer.innerHTML = '';
});

// Append to Log Terminal
function addLog(message, type = 'info', timestamp = null) {
    const liveLogsContainer = document.getElementById('live-logs-container');
    
    let timeStr = '';
    if (timestamp) {
        const date = new Date(timestamp);
        timeStr = date.toLocaleTimeString('vi-VN', { hour12: false });
    } else {
        timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    }
    
    if (message.includes('✓')) type = 'success';
    else if (message.toLowerCase().includes('lỗi') || message.toLowerCase().includes('error')) type = 'error';
    else if (message.toLowerCase().includes('warning') || message.toLowerCase().includes('cảnh báo')) type = 'warning';
    
    const htmlContent = `<span class="log-time">[${timeStr}]</span> <span class="log-msg">${message}</span>`;
    
    // Add to dedicated Logs Tab
    const el = document.createElement('div');
    el.className = `log-line ${type}`;
    el.innerHTML = htmlContent;
    logsContainer.appendChild(el);
    logsContainer.scrollTop = logsContainer.scrollHeight;
    
    // Add to Dashboard Live Logs
    if (liveLogsContainer) {
        const liveEl = document.createElement('div');
        liveEl.className = `log-line ${type}`;
        liveEl.innerHTML = htmlContent;
        liveLogsContainer.appendChild(liveEl);
        liveLogsContainer.scrollTop = liveLogsContainer.scrollHeight;
    }
}

function loadLogs() {
    fetch('/api/logs')
        .then(res => res.json())
        .then(logs => {
            if (logs && logs.length > 0) {
                logsContainer.innerHTML = ''; // clear default message
                const liveLogsContainer = document.getElementById('live-logs-container');
                if (liveLogsContainer) liveLogsContainer.innerHTML = '';
                
                logs.forEach(log => {
                    let type = 'info';
                    if(log.type === 'error') type = 'error';
                    else if(log.type === 'success') type = 'success';
                    else if(log.type === 'warning') type = 'warning';
                    else if(log.type === 'system') type = 'system';
                    
                    addLog(`[${log.account_id}] ${log.message}`, type, log.created_at);
                });
            }
        })
        .catch(console.error);
}

// Load logs initially
loadLogs();

// Socket Events
socket.on('log', (data) => {
    let type = 'info';
    if(data.type === 'error') type = 'error';
    else if(data.type === 'success') type = 'success';
    else if(data.type === 'warning') type = 'warning';
    else if(data.type === 'system') type = 'system';
    
    addLog(`[${data.accountId}] ${data.message}`, type);
});

socket.on('stats', (data) => {
    if(data.queued !== undefined) statQueued.innerText = data.queued;
    if(data.active !== undefined) statActive.innerText = data.active;
    if(data.sent !== undefined) statSent.innerText = data.sent;
    if(data.unfollows !== undefined) statUnfollows.innerText = data.unfollows;
    if(data.accounts !== undefined) {
        loadedAccounts = data.accounts;
        renderAccountsTable(data.accounts);
    }
});
