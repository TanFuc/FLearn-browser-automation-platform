// Research Dashboard JS
let mmoData = [], aiData = [], suggestData = [];
let mmoSort = { col: 'trend', dir: -1 };
let dailyUsageCache = { page: 1, limit: 7, total_days: 0, totals: null, daily: [] };
let selectedDailyDay = null;
let cooldownState = null;
let cooldownTimer = null;

// ─── Standalone page navigation (research.html) ───────────────────────────
window.switchPage = function(page, el) {
    document.querySelectorAll('.page-tabs').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) { target.classList.add('active'); target.style.display = 'block'; }
    if (el) el.classList.add('active');
    if (page === 'trends') { initTrendV4(); }
    if (page === 'mmo') { /* lazy load handled below */ }
};

// Auto-show trends page on standalone load
document.addEventListener('DOMContentLoaded', () => {
    const isStandalone = !!document.querySelector('.sidebar .nav-item[data-page="trends"]');
    if (isStandalone) {
        switchPage('trends', document.querySelector('.nav-item[data-page="trends"]'));
    }
});

// ─── Page navigation ──────────────────────────────────────────────────────
// ─── Research Sub-Tab navigation ──────────────────────────────────────────
function switchResearchTab(page) {
    const pages = document.querySelectorAll('#research-tab .rpage');
    pages.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
    });

    const buttons = ['mmo', 'ai', 'suggest', 'trends', 'quota', 'prompts'];
    buttons.forEach(b => {
        const btn = document.getElementById('rtab-' + b);
        if (btn) {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-outline');
        }
    });

    const targetPage = document.getElementById('rpage-' + page);
    if (targetPage) {
        targetPage.classList.add('active');
        targetPage.style.display = 'block';
    }

    const targetBtn = document.getElementById('rtab-' + page);
    if (targetBtn) {
        targetBtn.classList.remove('btn-outline');
        targetBtn.classList.add('btn-primary');
    }

    if (page === 'mmo' && mmoData.length === 0) loadMMO();
    if (page === 'ai' && aiData.length === 0) loadAI();
    if (page === 'suggest' && suggestData.length === 0) loadSuggestions();
    if (page === 'trends') initTrendV4();
    if (page === 'quota') {
        loadQuota();
        loadDailyUsage(dailyUsageCache.page || 1).catch(() => {});
    }
    if (page === 'prompts') loadPrompts();

    if (['mmo', 'ai', 'suggest'].includes(page)) {
        if (dailyUsageCache.daily?.length) {
            renderDailySummaryAll();
        } else {
            loadDailyUsage(1).catch(() => {});
        }
    }
}

// ─── Utility ─────────────────────────────────────────────────────────────
function scoreColor(v) {
    if (v >= 70) return 'var(--success)';
    if (v >= 40) return 'var(--warning)';
    return 'var(--error)';
}
function scoreBar(v) {
    return `<div class="score-bar"><div class="bar"><div class="fill" style="width:${v}%;background:${scoreColor(v)}"></div></div><span>${v}</span></div>`;
}
function badge(label, type) {
    return `<span class="badge badge-${type}">${label}</span>`;
}
function priceColor(p) {
    const map = { free: 'success', freemium: 'info', paid: 'warning', enterprise: 'error' };
    return map[p] || 'muted';
}
function statusBadge(s) {
    const map = { new_launch: ['success','🆕 New'], on_discount: ['warning','💰 Discount'], established: ['info','✅ Stable'], deprecated: ['error','⚠ Deprecated'] };
    const [type, label] = map[s] || ['muted', s];
    return badge(label, type);
}
function showAlert(msg, type = 'warning') {
    const banner = document.getElementById('researchAlertBanner') || document.getElementById('alertBanner');
    if (!banner) return;
    banner.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(() => { banner.innerHTML = ''; }, 6000);
}

function formatDay(d) {
    const date = new Date(d);
    return isNaN(date) ? d : date.toLocaleDateString('vi-VN');
}

function formatNumber(v) {
    return (v || 0).toLocaleString();
}

function formatTime(ts) {
    if (!ts) return '--';
    const date = new Date(ts);
    return isNaN(date) ? '--' : date.toLocaleTimeString('vi-VN');
}

function getLatestDay() {
    return dailyUsageCache.daily?.[0]?.day || null;
}

function getSelectedDay() {
    const available = (dailyUsageCache.daily || []).map(d => String(d.day));
    if (selectedDailyDay && available.includes(String(selectedDailyDay))) return selectedDailyDay;
    return getLatestDay();
}

function renderCooldownStatus(state) {
    const statusEl = document.getElementById('cooldownStatus');
    const remainingEl = document.getElementById('cooldownRemaining');
    const nextEl = document.getElementById('cooldownNext');
    const devBadge = document.getElementById('cooldownDevBadge');
    if (!statusEl || !remainingEl || !nextEl) return;

    cooldownState = state || cooldownState;
    const devMode = !!cooldownState?.dev_mode;
    const pages = cooldownState?.pages || {};
    const active = Object.values(pages).some(p => p.is_blocked);
    const remaining = Math.max(...Object.values(pages).map(p => p.remaining_seconds || 0), 0);
    const nextTime = Math.max(...Object.values(pages).map(p => p.blocked_until || 0), 0);

    statusEl.textContent = devMode ? 'Cooldown: CHẾ ĐỘ PHÁT TRIỂN' : `Cooldown: ${active ? 'Đang khóa' : 'Sẵn sàng'}`;
    remainingEl.textContent = devMode ? 'Còn lại: --' : `Còn lại: ${remaining}s`;
    nextEl.textContent = devMode ? 'Lần tiếp theo: --' : `Lần tiếp theo: ${formatTime(nextTime)}`;
    if (devBadge) devBadge.style.display = devMode ? 'inline-flex' : 'none';
}

function startCooldownTicker() {
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        if (!cooldownState || cooldownState.dev_mode) return;
        Object.keys(cooldownState.pages || {}).forEach(key => {
            const p = cooldownState.pages[key];
            if (p.remaining_seconds > 0) p.remaining_seconds -= 1;
            if (p.remaining_seconds <= 0) {
                p.remaining_seconds = 0;
                p.is_blocked = false;
            }
        });
        renderCooldownStatus(cooldownState);
    }, 1000);
}

async function loadDailyUsage(page = 1) {
    const limit = 7;
    const res = await fetch(`/api/research/usage/daily?page=${page}&limit=${limit}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Lỗi tải thống kê ngày');
    dailyUsageCache = json;
    renderDailyUsage();
    renderDailySummaryAll();
}

function renderDailySummary(targetId, latest, totals) {
    const el = document.getElementById(targetId);
    if (!el) return;
    if (!latest) {
        el.innerHTML = '<div class="daily-summary-empty">Chưa có dữ liệu thống kê theo ngày.</div>';
        return;
    }
    const selectedDay = getSelectedDay();
    const options = (dailyUsageCache.daily || []).map(d => {
        const val = String(d.day);
        const selected = val === String(selectedDay) ? 'selected' : '';
        return `<option value="${val}" ${selected}>${formatDay(d.day)}</option>`;
    }).join('');
    const dayToShow = dailyUsageCache.daily.find(d => String(d.day) === String(selectedDay)) || latest;
    el.innerHTML = `
        <div class="daily-controls">
            <label for="dailySelect">Chọn ngày</label>
            <select class="daily-day-select" data-daily-select="${targetId}">${options}</select>
        </div>
        <div class="daily-card">
            <div class="daily-label">Hôm nay</div>
            <div class="daily-value">${formatNumber(dayToShow.requests)}</div>
            <div class="daily-sub">${formatDay(dayToShow.day)}</div>
        </div>
        <div class="daily-card">
            <div class="daily-label">Total Requests</div>
            <div class="daily-value">${formatNumber(totals?.total_requests)}</div>
            <div class="daily-sub">Tất cả</div>
        </div>
        <div class="daily-card">
            <div class="daily-label">Total Tokens</div>
            <div class="daily-value">${formatNumber(totals?.total_tokens)}</div>
            <div class="daily-sub">Prompt + Output</div>
        </div>
        <div class="daily-card">
            <div class="daily-label">Cache Hits</div>
            <div class="daily-value">${formatNumber(totals?.cache_hits)}</div>
            <div class="daily-sub">Tất cả</div>
        </div>
    `;
}

function renderDailySummaryAll() {
    const latest = dailyUsageCache.daily?.[0];
    renderDailySummary('dailySummary-usage', latest, dailyUsageCache.totals);
    renderDailySummary('dailySummary-mmo', latest, dailyUsageCache.totals);
    renderDailySummary('dailySummary-ai', latest, dailyUsageCache.totals);
    renderDailySummary('dailySummary-suggest', latest, dailyUsageCache.totals);
}

function renderDailyUsage() {
    const tbody = document.getElementById('dailyUsageBody');
    const pageInfo = document.getElementById('dailyPageInfo');
    const prevBtn = document.getElementById('dailyPrevBtn');
    const nextBtn = document.getElementById('dailyNextBtn');

    if (!tbody) return;
    const rows = dailyUsageCache.daily || [];
    const selectedDay = getSelectedDay();
    tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="6" style="text-align:center;opacity:0.5;padding:16px">Chưa có thống kê ngày</td></tr>'
        : rows.map(d => `
            <tr class="${String(d.day) === String(selectedDay) ? 'daily-row-selected' : ''}">
                <td>${formatDay(d.day)}</td>
                <td>${formatNumber(d.requests)}</td>
                <td>${formatNumber(d.prompt_tokens)}</td>
                <td>${formatNumber(d.output_tokens)}</td>
                <td>${formatNumber(d.total_tokens)}</td>
                <td>${formatNumber(d.cache_hits)}</td>
            </tr>`).join('');

    if (pageInfo) {
        const totalPages = Math.max(Math.ceil((dailyUsageCache.total_days || 0) / (dailyUsageCache.limit || 7)), 1);
        pageInfo.textContent = `${dailyUsageCache.page}/${totalPages}`;
        if (prevBtn) prevBtn.disabled = dailyUsageCache.page <= 1;
        if (nextBtn) nextBtn.disabled = dailyUsageCache.page >= totalPages;
    }
}

// ─── Quota bar (Socket.io + polling) ─────────────────────────────────────
function updateQuotaBar(q) {
    if (!q) return;
    document.getElementById('qReq').textContent = q.request_count;
    document.getElementById('qSoft').textContent = q.soft_cap;
    document.getElementById('qHard').textContent = q.hard_cap;
    document.getElementById('qTokens').textContent = (q.total_tokens || 0).toLocaleString();
    document.getElementById('qCache').textContent = q.cache_hits || 0;

    const pct = Math.round((q.request_count / q.hard_cap) * 100);
    const fill = document.getElementById('quotaFill');
    document.getElementById('quotaPct').textContent = pct + '%';
    fill.style.width = Math.min(pct, 100) + '%';
    fill.className = 'progress-fill' + (pct >= 80 ? ' danger' : pct >= 60 ? ' warn' : '');

    if (q.is_blocked) {
        showAlert('🚫 Hard cap đã đạt! Mọi yêu cầu AI bị tạm dừng. Reset vào ngày mai hoặc bấm Reset Quota.', 'error');
    } else if (q.request_count >= q.soft_cap) {
        showAlert(`⚠️ Soft cap đạt! Còn ${q.hard_cap - q.request_count} requests. Hệ thống sẽ hạn chế calls không quan trọng.`, 'warning');
    }
}

// ─── Load MMO (Page 1) ────────────────────────────────────────────────────
window.loadMMO = async function loadMMO() {
    console.log('[Research] Loading MMO data...');
    const tableBody = document.getElementById('mmoTableBody');
    const updatedLabel = document.getElementById('mmoUpdated');
    
    if (tableBody) renderSkeleton('mmoTableBody', 6, 7);
    if (updatedLabel) updatedLabel.textContent = '⏳ Đang tải dữ liệu từ server...';

    try {
        const res = await fetch('/api/research/page-1');
        const json = await res.json();
        if (!json.success) {
            if (updatedLabel) updatedLabel.textContent = '❌ Lỗi tải dữ liệu';
            return showAlert(json.error, 'error');
        }
        mmoData = json.data || [];
        console.log('[Research] MMO data received:', mmoData);
        if (updatedLabel) updatedLabel.textContent = `${mmoData.length} cơ hội · Nguồn: ${json.meta?.source || 'DB'} · ${new Date().toLocaleString('vi-VN')}`;
        renderMMOTopCards();
        renderGroupSections('mmoGroupSections', mmoData, 'category');
        renderMMOTable();
        fillMMOFilters();
        console.log('[Research] MMO data loaded:', mmoData.length);
    } catch (e) { 
        console.error('[Research] MMO Load Error:', e);
        if (updatedLabel) updatedLabel.textContent = '❌ Lỗi kết nối server';
        showAlert('Lỗi tải dữ liệu MMO: ' + e.message, 'error'); 
    }
}

function fillMMOFilters() {
    const cats = [...new Set(mmoData.map(d => d.category).filter(Boolean))];
    const sel = document.getElementById('mmoCategoryFilter');
    sel.innerHTML = '<option value="">Tất cả Niche</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderMMOTopCards() {
    const top = [...mmoData].sort((a,b) => (b.trend_score||0) - (a.trend_score||0)).slice(0, 3);
    document.getElementById('mmoTopCards').innerHTML = top.map(item => `
        <div class="opportunity-card">
            <div class="badge-row">${badge(item.category || '—', 'primary')}${badge(item.traffic_source || '—', 'muted')}</div>
            <h3>${item.title || '—'}</h3>
            <p>${item.summary || ''}</p>
            <div class="score-row">
                <div class="score-item">Trend <span class="sv">${item.trend_score||0}</span></div>
                <div class="score-item">Monetize <span class="sv">${item.monetization_score||0}</span></div>
                <div class="score-item">Cạnh tranh <span class="sv">${item.competition_score||0}</span></div>
            </div>
            <p style="font-size:0.78rem;color:var(--muted);margin-top:10px;">💰 ${item.monetization_model || '—'}</p>
        </div>`).join('');
}

function renderGroupSections(containerId, data, groupKey, labelMap) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const groups = {};
    (data || []).forEach(item => {
        const key = item[groupKey] || 'other';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    });

    const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    if (entries.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = entries.map(([key, items]) => {
        const label = labelMap?.[key] || key;
        const cards = items.slice(0, 6).map(item => `
            <div class="opportunity-card">
                <div class="badge-row">${badge(label, 'primary')}${item.traffic_source ? badge(item.traffic_source, 'muted') : ''}</div>
                <h3>${item.title || item.tool_name || item.recommendation_title || '—'}</h3>
                <p>${item.summary || item.market_signal || item.recommendation_text || ''}</p>
            </div>`).join('');

        return `
            <section class="group-section">
                <div class="group-header">
                    <h3>${label}</h3>
                    <span>${items.length} mục</span>
                </div>
                <div class="group-grid">${cards}</div>
            </section>
        `;
    }).join('');
}

function getFilteredMMO() {
    const q = document.getElementById('mmoSearch').value.toLowerCase();
    const cat = document.getElementById('mmoCategoryFilter').value;
    const sort = document.getElementById('mmoSortFilter').value;
    let data = mmoData.filter(d =>
        (!q || (d.title||'').toLowerCase().includes(q) || (d.summary||'').toLowerCase().includes(q) || (d.category||'').toLowerCase().includes(q)) &&
        (!cat || d.category === cat)
    );
    const key = sort === 'monetization' ? 'monetization_score' : sort === 'competition' ? 'competition_score' : 'trend_score';
    data.sort((a,b) => (b[key]||0) - (a[key]||0));
    return data;
}

function renderMMOTable(data) {
    data = data || getFilteredMMO();
    document.getElementById('mmoCount').textContent = `${data.length} kết quả`;
    if (!data.length) { document.getElementById('mmoTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state"><h3>Không có dữ liệu</h3><p>Nhấn Refresh AI để tải</p></div></td></tr>`; return; }
    document.getElementById('mmoTableBody').innerHTML = data.map(d => `
        <tr>
            <td><b>${d.title||'—'}</b><br><span style="font-size:0.75rem;color:var(--muted)">${d.content_angle||''}</span></td>
            <td>${badge(d.category||'—','primary')}</td>
            <td>${scoreBar(d.trend_score||0)}</td>
            <td>${scoreBar(d.monetization_score||0)}</td>
            <td>${scoreBar(d.competition_score||0)}</td>
            <td><span style="font-size:0.8rem">${d.traffic_source||'—'}</span></td>
            <td><span style="font-size:0.8rem">${d.monetization_model||'—'}</span></td>
        </tr>`).join('');
}

function filterMMO() { renderMMOTable(); }
function sortMMO(col) { mmoSort = { col, dir: -1 }; renderMMOTable(); }

// ─── Load AI Tools (Page 2) ───────────────────────────────────────────────
window.loadAI = async function loadAI() {
    renderSkeleton('aiTableBody', 8, 7);
    try {
        const res = await fetch('/api/research/page-2');
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        aiData = json.data || [];
        document.getElementById('aiUpdated').textContent = `${aiData.length} công cụ · ${new Date().toLocaleString('vi-VN')}`;
        renderAITopCards();
        renderGroupSections('aiGroupSections', aiData, 'tool_type', {
            code: 'Code',
            video: 'Video',
            writing: 'Writing',
            automation: 'Automation',
            image: 'Image',
            other: 'Other'
        });
        renderAITable();
    } catch (e) { showAlert('Lỗi tải AI tools: ' + e.message, 'error'); }
}

function renderAITopCards() {
    const bv = aiData.filter(d => d.is_best_value).slice(0, 2);
    const nn = aiData.filter(d => d.is_new_noteworthy).slice(0, 2);
    const top = [...bv, ...nn].slice(0, 4);
    document.getElementById('aiTopCards').innerHTML = top.map(d => `
        <div class="opportunity-card">
            <div class="badge-row">
                ${d.is_best_value ? badge('💎 Best Value','success') : ''}
                ${d.is_new_noteworthy ? badge('🆕 New','info') : ''}
                ${badge(d.tool_type||'other','primary')}
                ${badge(d.price_level||'?', priceColor(d.price_level))}
            </div>
            <h3>${d.tool_name||'—'}</h3>
            <p>${d.summary||''}</p>
            <p style="font-size:0.78rem;color:var(--muted);margin-top:10px">📡 ${d.market_signal||''}</p>
        </div>`).join('');
}

function getFilteredAI() {
    const q = document.getElementById('aiSearch').value.toLowerCase();
    const type = document.getElementById('aiTypeFilter').value;
    const price = document.getElementById('aiPriceFilter').value;
    const bvOnly = document.getElementById('aiBestValue').checked;
    return aiData.filter(d =>
        (!q || (d.tool_name||'').toLowerCase().includes(q) || (d.use_case||'').toLowerCase().includes(q)) &&
        (!type || d.tool_type === type) &&
        (!price || d.price_level === price) &&
        (!bvOnly || d.is_best_value)
    );
}

function renderAITable(data) {
    data = data || getFilteredAI();
    document.getElementById('aiCount').textContent = `${data.length} công cụ`;
    if (!data.length) { document.getElementById('aiTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state"><h3>Không có dữ liệu</h3></div></td></tr>`; return; }
    document.getElementById('aiTableBody').innerHTML = data.map(d => `
        <tr>
            <td><b>${d.tool_name||'—'}</b>
                ${d.is_best_value ? '<span style="font-size:0.7rem;color:var(--success);margin-left:6px">💎</span>' : ''}
                ${d.is_new_noteworthy ? '<span style="font-size:0.7rem;color:var(--info);margin-left:4px">🆕</span>' : ''}
            </td>
            <td>${badge(d.tool_type||'other','primary')}</td>
            <td>${badge(d.price_level||'?', priceColor(d.price_level))}</td>
            <td>${statusBadge(d.discount_or_launch_status)}</td>
            <td style="max-width:200px;font-size:0.8rem">${d.use_case||'—'}</td>
            <td style="max-width:180px;font-size:0.78rem;color:var(--muted)">${d.market_signal||'—'}</td>
            <td style="max-width:160px;font-size:0.78rem">${d.best_value_reason||'—'}</td>
        </tr>`).join('');
}
function filterAI() { renderAITable(); }

// ─── Load Suggestions (Page 3) ────────────────────────────────────────────
window.loadSuggestions = async function loadSuggestions() {
    document.getElementById('suggestList').innerHTML = '<div class="empty-state">⏳ Đang tải...</div>';
    try {
        const res = await fetch('/api/research/page-3');
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        suggestData = json.data || [];
        document.getElementById('suggestUpdated').textContent = `${suggestData.length} gợi ý · ${new Date().toLocaleString('vi-VN')}`;
        renderSuggestions();
    } catch (e) { showAlert('Lỗi: ' + e.message, 'error'); }
}

function renderSuggestions() {
    if (!suggestData.length) {
        document.getElementById('suggestList').innerHTML = `<div class="empty-state"><h3>Chưa có gợi ý</h3><p>Nhấn Refresh AI để tạo gợi ý mới</p></div>`;
        return;
    }
    const byTopic = {};
    suggestData.forEach(item => {
        const key = item.topic || 'General';
        if (!byTopic[key]) byTopic[key] = [];
        byTopic[key].push(item);
    });

    const sections = Object.entries(byTopic).map(([topic, items]) => {
        const sorted = items.sort((a,b) => (b.roi_score||0) - (a.roi_score||0));
        const cards = sorted.map((d, i) => `
            <div class="suggest-card">
                <div class="suggest-rank">${i+1}</div>
                <div class="suggest-body">
                    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
                        ${badge(topic,'primary')}
                        ${d.urgency_score >= 70 ? badge('🔥 Urgent','error') : ''}
                    </div>
                    <h3>${d.recommendation_title||'—'}</h3>
                    <p>${d.recommendation_text||''}</p>
                    <div class="suggest-scores">
                        <div class="suggest-score">Confidence <span class="val">${d.confidence_score||0}</span></div>
                        <div class="suggest-score">Urgency <span class="val">${d.urgency_score||0}</span></div>
                        <div class="suggest-score">ROI <span class="val">${d.roi_score||0}</span></div>
                    </div>
                    ${d.reasoning_summary ? `<p style="font-size:0.8rem;color:var(--muted);margin-top:8px;border-left:2px solid var(--border);padding-left:10px">${d.reasoning_summary}</p>` : ''}
                    ${d.next_action ? `<div class="suggest-action">→ ${d.next_action}</div>` : ''}
                </div>
            </div>`).join('');

        return `
            <section class="group-section">
                <div class="group-header">
                    <h3>${topic}</h3>
                    <span>${items.length} mục</span>
                </div>
                <div class="group-grid">${cards}</div>
            </section>
        `;
    }).join('');

    document.getElementById('suggestList').innerHTML = sections;
}

// ─── Load Quota (Page 4) ──────────────────────────────────────────────────
async function loadQuota() {
    try {
        const res = await fetch('/api/research/usage');
        const json = await res.json();
        const q = json.quota;
        if (!q) return;

        updateQuotaBar(q);

        const pct = Math.round((q.request_count / q.hard_cap) * 100);
        const quotaAlert = document.getElementById('quotaAlertFull');
        if (quotaAlert) {
            if (q.is_blocked) {
                quotaAlert.innerHTML = `<div class="alert alert-error">🚫 Tài khoản đã đạt hard cap (${q.hard_cap}). Mọi AI request bị chặn cho đến ngày mai.</div>`;
            } else if (q.request_count >= q.soft_cap) {
                quotaAlert.innerHTML = `<div class="alert alert-warning">⚠️ Đạt soft cap! Hệ thống đang bảo vệ quota. Còn ${q.hard_cap - q.request_count} requests.</div>`;
            } else {
                quotaAlert.innerHTML = `<div class="alert alert-success">✅ Quota an toàn — ${q.request_count}/${q.hard_cap} requests đã dùng hôm nay.</div>`;
            }
        }

        const remaining = q.remaining_requests ?? Math.max((q.hard_cap || 0) - (q.request_count || 0), 0);
        const retryAfter = q.retry_after_seconds || 0;
        document.getElementById('usageGrid').innerHTML = [
            { label: 'Requests hôm nay', val: q.request_count, sub: `/ ${q.hard_cap} hard cap`, color: pct >= 80 ? 'var(--error)' : pct >= 60 ? 'var(--warning)' : 'var(--success)' },
            { label: 'Còn lại', val: remaining, sub: 'Requests còn lại' },
            { label: 'Model hiện tại', val: q.last_model || '—', sub: 'Model dùng gần nhất' },
            { label: 'Retry sau', val: retryAfter ? `${retryAfter}s` : '—', sub: 'Theo quota' },
            { label: 'Prompt Tokens', val: (q.prompt_tokens||0).toLocaleString(), sub: 'Tổng hôm nay' },
            { label: 'Output Tokens', val: (q.output_tokens||0).toLocaleString(), sub: 'Tổng hôm nay' },
            { label: 'Total Tokens', val: (q.total_tokens||0).toLocaleString(), sub: 'Prompt + Output' },
            { label: 'Cache Hits', val: q.cache_hits || 0, sub: 'Tiết kiệm API calls' },
            { label: 'Soft Cap', val: q.soft_cap, sub: 'Giới hạn mềm/ngày' },
            { label: 'Hard Cap', val: q.hard_cap, sub: 'Giới hạn cứng/ngày' },
            { label: 'Trạng Thái', val: q.is_blocked ? '🚫 Blocked' : '✅ OK', sub: q.is_blocked ? 'API bị tạm khóa' : 'API hoạt động bình thường' },
        ].map(c => `
            <div class="usage-card">
                <div class="u-label">${c.label}</div>
                <div class="u-val" style="${c.color ? `color:${c.color}` : ''}">${c.val}</div>
                <div class="u-sub">${c.sub}</div>
            </div>`).join('');

        // Recent calls table
        const calls = json.recent_calls || [];
        document.getElementById('recentCallsBody').innerHTML = calls.length === 0
            ? '<tr><td colspan="7" style="text-align:center;opacity:0.5;padding:20px">Chưa có lịch sử gọi API</td></tr>'
            : calls.map(c => `<tr>
                <td style="font-size:0.8rem">${c.model}</td>
                <td>${c.prompt_tokens}</td>
                <td>${c.output_tokens}</td>
                <td>${c.total_tokens}</td>
                <td>${c.cache_hit ? badge('Cache','success') : badge('Live','info')}</td>
                <td style="font-size:0.78rem">${c.endpoint}</td>
                <td style="font-size:0.78rem;color:var(--muted)">${new Date(c.created_at).toLocaleString('vi-VN')}</td>
            </tr>`).join('');
    } catch(e) { showAlert('Lỗi tải quota: ' + e.message, 'error'); }
}

async function loadCooldownStatus() {
    const res = await fetch('/api/research/cooldown');
    const json = await res.json();
    renderCooldownStatus(json);
    startCooldownTicker();
}

document.addEventListener('click', (e) => {
    const prevBtn = document.getElementById('dailyPrevBtn');
    const nextBtn = document.getElementById('dailyNextBtn');
    if (e.target === prevBtn) {
        loadDailyUsage(Math.max((dailyUsageCache.page || 1) - 1, 1)).catch(err => showAlert(err.message, 'error'));
    }
    if (e.target === nextBtn) {
        const totalPages = Math.max(Math.ceil((dailyUsageCache.total_days || 0) / (dailyUsageCache.limit || 7)), 1);
        loadDailyUsage(Math.min((dailyUsageCache.page || 1) + 1, totalPages)).catch(err => showAlert(err.message, 'error'));
    }
});

document.addEventListener('change', (e) => {
    if (e.target && e.target.classList.contains('daily-day-select')) {
        selectedDailyDay = e.target.value;
        renderDailySummaryAll();
        renderDailyUsage();
    }
});

// ─── Refresh AI ───────────────────────────────────────────────────────────
async function refreshPage(page) {
    const btnMap = { mmo: 'mmoRefreshBtn', ai_tools: 'aiRefreshBtn', suggestions: 'suggestRefreshBtn' };
    const btn = document.getElementById(btnMap[page]);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang gọi AI...'; }

    try {
        const res = await fetch('/api/research/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page })
        });
        const json = await res.json();
        if (!res.ok) { showAlert(json.error, 'warning'); return; }

        showAlert(`✅ Đã refresh! ${json.count} mục mới.${json.use_lite ? ' (Lite mode)' : ''}`, 'success');
        if (page === 'mmo') { mmoData = []; loadMMO(); }
        if (page === 'ai_tools') { aiData = []; loadAI(); }
        if (page === 'suggestions') { suggestData = []; loadSuggestions(); }
    } catch(e) { showAlert('Lỗi: ' + e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '↺ Refresh AI'; } }
}


// ─── Admin actions ────────────────────────────────────────────────────────
async function resetQuota() {
    if (!confirm('Reset quota về 0? Chỉ dùng cho mục đích test.')) return;
    const r = await fetch('/api/research/admin/reset-quota', { method: 'POST' });
    const j = await r.json();
    showAlert(j.message, 'success');
    loadQuota();
}

async function runDailyJob() {
    const r = await fetch('/api/research/admin/run-daily-job', { method: 'POST' });
    showAlert('Daily research job đã bắt đầu chạy trong nền...', 'success');
}

async function testGemini() {
    const btn = document.getElementById('btnTestGemini');
    const testPanel = document.getElementById('testResult');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Testing...'; }
    if (testPanel) {
        testPanel.style.display = 'block';
        testPanel.innerHTML = '<div class="tr-title">Đang gọi Gemini…</div><div class="tr-meta">Vui lòng chờ phản hồi.</div>';
    }

    try {
        const res = await fetch('/api/research/test-gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ useLite: true })
        });
        const json = await res.json();
        if (!res.ok) {
            showAlert(json.error, 'warning');
            if (testPanel) {
                testPanel.innerHTML = `<div class="tr-title">❌ Test thất bại</div><div class="tr-meta">${json.error || 'Lỗi không xác định'}</div>`;
            }
            return;
        }

        const payload = JSON.stringify(json.data || {}, null, 2);
        if (testPanel) {
            testPanel.innerHTML = `
                <div class="tr-title">✅ Test Gemini thành công</div>
                <div class="tr-meta">${json.use_lite ? 'Lite mode' : 'Full mode'} · ${new Date().toLocaleString('vi-VN')}</div>
                <pre>${payload}</pre>
            `;
        }
        showAlert('✅ Test Gemini thành công.', 'success');
        loadQuota();
    } catch (e) {
        showAlert('❌ Test Gemini lỗi: ' + e.message, 'error');
        if (testPanel) {
            testPanel.innerHTML = `<div class="tr-title">❌ Test thất bại</div><div class="tr-meta">${e.message}</div>`;
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🧪 Test Gemini'; }
    }
}

// ─── Prompt manager ─────────────────────────────────────────────────────
let promptEditingId = null;

async function loadPrompts() {
    const list = document.getElementById('promptList');
    if (!list) return;
    list.innerHTML = '<div class="empty-state">⏳ Đang tải prompt...</div>';

    try {
        const res = await fetch('/api/research/prompts');
        const data = await res.json();
        renderPromptList(Array.isArray(data) ? data : []);
    } catch (e) {
        showAlert('Lỗi tải prompts: ' + e.message, 'error');
    }
}

function renderPromptList(items) {
    const list = document.getElementById('promptList');
    if (!list) return;

    if (!items.length) {
        list.innerHTML = '<div class="empty-state"><h3>Chưa có prompt</h3><p>Tạo prompt mới ở khung bên trái.</p></div>';
        return;
    }

    const groups = {};
    items.forEach(item => {
        if (!groups[item.page_type]) groups[item.page_type] = [];
        groups[item.page_type].push(item);
    });

    list.innerHTML = Object.entries(groups).map(([page, prompts]) => {
        const rows = prompts.map(p => `
            <div class="prompt-item">
                <div>
                    <div class="prompt-title">${p.variant_name}
                        ${p.is_active ? '<span class="badge badge-success">active</span>' : ''}
                    </div>
                    <div class="prompt-meta">${page} · ${new Date(p.updated_at).toLocaleString('vi-VN')}</div>
                </div>
                <div class="prompt-actions">
                    <button class="btn btn-outline btn-sm" onclick="activatePrompt(${p.id})">Active</button>
                    <button class="btn btn-outline btn-sm" onclick="editPrompt(${p.id})">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deletePrompt(${p.id})">Delete</button>
                </div>
            </div>
        `).join('');

        return `
            <div class="prompt-group">
                <div class="prompt-group-header">${page}</div>
                ${rows}
            </div>
        `;
    }).join('');

    window.__promptCache = items;
}

function editPrompt(id) {
    const items = window.__promptCache || [];
    const item = items.find(p => p.id === id);
    if (!item) return;

    promptEditingId = id;
    document.getElementById('promptPageType').value = item.page_type;
    document.getElementById('promptVariant').value = item.variant_name;
    document.getElementById('promptText').value = item.prompt_text;
    document.getElementById('promptSetActive').checked = item.is_active;
}

async function activatePrompt(id) {
    await fetch(`/api/research/prompts/${id}/activate`, { method: 'POST' });
    loadPrompts();
}

async function deletePrompt(id) {
    if (!confirm('Xoa prompt nay?')) return;
    await fetch(`/api/research/prompts/${id}`, { method: 'DELETE' });
    loadPrompts();
}

const promptForm = document.getElementById('promptForm');
if (promptForm) {
    promptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            id: promptEditingId,
            page_type: document.getElementById('promptPageType').value,
            variant_name: document.getElementById('promptVariant').value.trim(),
            prompt_text: document.getElementById('promptText').value.trim(),
            set_active: document.getElementById('promptSetActive').checked,
        };

        const res = await fetch('/api/research/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await res.json();
        if (!res.ok) return showAlert(json.error || 'Loi luu prompt', 'error');

        promptEditingId = null;
        promptForm.reset();
        document.getElementById('promptSetActive').checked = false;
        loadPrompts();
        showAlert('Da luu prompt thanh cong.', 'success');
    });
}

// ─── Export CSV ───────────────────────────────────────────────────────────
function exportCSV(type) {
    let data, fields, filename;
    if (type === 'mmo') {
        data = getFilteredMMO();
        fields = ['title','category','trend_score','monetization_score','competition_score','traffic_source','monetization_model','summary'];
        filename = 'mmo_research.csv';
    } else {
        data = getFilteredAI();
        fields = ['tool_name','tool_type','price_level','discount_or_launch_status','use_case','best_value_reason','market_signal','summary'];
        filename = 'ai_tools.csv';
    }
    const rows = [fields.join(','), ...data.map(d => fields.map(f => `"${String(d[f]||'').replace(/"/g,'""')}"`).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ─── Skeleton loader ──────────────────────────────────────────────────────
function renderSkeleton(tbodyId, rows, cols) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = Array(rows).fill(`<tr>${Array(cols).fill('<td><div class="skeleton" style="height:16px;border-radius:4px"></div></td>').join('')}</tr>`).join('');
}

// ─── Socket.io quota updates ──────────────────────────────────────────────
if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('quota_update', updateQuotaBar);
    socket.on('cron_status', d => showAlert(d.status === 'success' ? '✅ Daily cron hoàn thành!' : '❌ Cron lỗi: ' + d.message, d.status === 'success' ? 'success' : 'error'));
    socket.on('cooldown_update', data => {
        renderCooldownStatus(data);
        startCooldownTicker();
    });
    socket.on('quota:update', (data) => {
        updateQuotaBar(data);
        const quotaTab = document.getElementById('rpage-quota');
        if (quotaTab && quotaTab.classList.contains('active')) {
            loadQuota();
        }
    });
    socket.on('quota:blocked', data => {
        if (data?.retry_after) {
            showAlert(`⚠️ Quota đạt giới hạn. Thử lại sau ${data.retry_after}s.`, 'warning');
        }
    });
    socket.on('quota:model_fallback', () => {
        showAlert('⚠️ Model quota đạt giới hạn. Đang dùng fallback model.', 'warning');
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────
window.initResearchTab = () => {
    if (window.__researchInitDone) return;
    window.__researchInitDone = true;
    switchResearchTab('trends');
};

console.log('[Research] Research module initialized');
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/research/usage').then(r => r.json()).then(j => {
        if (j.quota) {
            updateQuotaBar(j.quota);
            const badge = document.getElementById('researchQuotaBadge');
            if (badge) {
                badge.textContent = j.quota.request_count;
                badge.style.display = 'inline-block';
            }
        }
    }).catch(e => console.error('[Research] Quota init error:', e));

    const researchTab = document.getElementById('research-tab');
    if (researchTab && researchTab.classList.contains('active')) {
        initResearchTab();
    }

    loadCooldownStatus().catch(() => {});
    loadDailyUsage(1).catch(() => {});

    const resetBtn = document.getElementById('btnResetCooldown');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            const res = await fetch('/api/admin/reset-cooldown', { method: 'POST' });
            const json = await res.json();
            if (!res.ok) return showAlert(json.error || 'Loi reset cooldown', 'error');
            showAlert(json.message || 'Cooldown reset.', 'success');
            loadCooldownStatus().catch(() => {});
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// V4 PRODUCT TREND ENGINE
// ═══════════════════════════════════════════════════════════════════════════

const TrendV4 = {
    state: {
        market: 'vn',
        categories: ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé'],
        window: 'last_7_days',
        limit: 8,
        mode: 'overview',
        sortBy: 'trend_score',
        loading: false,
        data: [],
        pagination: { page: 1, limit: 8, total: 0, has_more: false },
        is_stale: false,
    },

    async init() {
        this.bindFilters();
        this.load();
    },

    bindFilters() {
        ['v4LimitFilter', 'v4WindowFilter', 'v4SortFilter', 'v4MarketFilter', 'v4CustomCategory'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => this.applyFilters());
            if (id === 'v4CustomCategory') {
                el.addEventListener('keyup', (e) => { if(e.key === 'Enter') this.applyFilters(); });
            }
        });
        const catCheckboxes = document.querySelectorAll('#v4CategoryFilters input[type="checkbox"]');
        catCheckboxes.forEach(cb => cb.addEventListener('change', () => this.applyFilters()));
        const refreshBtn = document.getElementById('v4RefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.load(true));
    },

    applyFilters() {
        const limit = parseInt(document.getElementById('v4LimitFilter')?.value || '8', 10);
        const window = document.getElementById('v4WindowFilter')?.value || 'last_7_days';
        const sortBy = document.getElementById('v4SortFilter')?.value || 'trend_score';
        const market = document.getElementById('v4MarketFilter')?.value || 'vn';
        
        const catBoxes = document.querySelectorAll('#v4CategoryFilters input[type="checkbox"]:checked');
        let categories = Array.from(catBoxes).map(cb => cb.value);
        
        const custom = document.getElementById('v4CustomCategory')?.value?.trim();
        if (custom) {
            // Split by comma if multiple
            const customList = custom.split(',').map(c => c.trim()).filter(c => c);
            categories = [...categories, ...customList];
        }

        if (categories.length === 0) {
            categories = ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé'];
        }

        Object.assign(this.state, { limit, window, sortBy, market, categories });
        this.load();
    },

    async load(forceRefresh = false) {
        if (this.state.loading) return;
        this.state.loading = true;
        this.setLoadingState(true);

        try {
            const cats = this.state.categories.join(',');
            const url = `/api/product-trends?market=${this.state.market}&categories=${encodeURIComponent(cats)}&limit=${this.state.limit}&window=${this.state.window}&mode=${this.state.mode}`;
            const res = await fetch(url);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Lỗi tải dữ liệu xu hướng');
            
            this.state.data = json.data || [];
            this.state.pagination = json.meta?.pagination || {};
            this.state.is_stale = json.meta?.is_stale || false;
            this.render();
        } catch (err) {
            this.renderError(err.message);
        } finally {
            this.state.loading = false;
            this.setLoadingState(false);
        }
    },

    setLoadingState(loading) {
        const grid = document.getElementById('v4TrendGrid');
        const btn = document.getElementById('v4RefreshBtn');
        if (grid && loading) {
            grid.innerHTML = `<div class="v4-loading">
                <div class="v4-spinner"></div>
                <p style="font-weight:600; color:#f8fafc;">Đang quét xu hướng thị trường...</p>
                <p style="font-size:0.8rem; margin-top:8px;">AI đang tổng hợp dữ liệu từ Search & Social</p>
            </div>`;
        }
        if (btn) {
            btn.disabled = loading;
            btn.innerHTML = loading ? `<span class="v4-spinner-sm"></span> Đang chạy...` : `🔄 Refresh AI`;
        }
    },

    renderError(msg) {
        const grid = document.getElementById('v4TrendGrid');
        if (grid) {
            grid.innerHTML = `<div class="v4-error">
                <span class="v4-empty-icon">⚠️</span>
                <p style="font-weight:600; color:#ef4444;">Đã xảy ra lỗi</p>
                <p style="font-size:0.85rem;">${msg}</p>
                <button class="btn btn-outline btn-sm" style="margin-top:16px;" onclick="TrendV4.load()">Thử lại</button>
            </div>`;
        }
    },

    growthBadge(signal) {
        const map = {
            exploding: ['v4-badge-exploding', '🚀 Đang bùng nổ'],
            rising:    ['v4-badge-rising',    '📈 Đang tăng'],
            seasonal:  ['v4-badge-seasonal',  '❄️ Theo mùa'],
            stable:    ['v4-badge-stable',    '📊 Ổn định'],
        };
        const [cls, label] = map[signal] || ['v4-badge-stable', signal || 'Unknown'];
        return `<span class="v4-badge ${cls}">${label}</span>`;
    },

    staleIndicator(is_stale) {
        if (!is_stale) return '';
        return `<span class="v4-badge v4-badge-stale" title="Dữ liệu từ bộ nhớ đệm, AI đang được làm mới">📦 Cached</span>`;
    },

    scoreRing(val, label) {
        const color = val >= 70 ? '#22d3a5' : val >= 45 ? '#f59e0b' : '#ef4444';
        return `<div class="v4-score-ring" style="--ring-color:${color}">
            <span class="v4-score-val">${val}</span>
            <span class="v4-score-lbl">${label}</span>
        </div>`;
    },

    render() {
        const grid = document.getElementById('v4TrendGrid');
        const metaEl = document.getElementById('v4MetaInfo');
        if (!grid) return;

        const { data, pagination, is_stale, sortBy } = this.state;
        
        if (metaEl) {
            metaEl.innerHTML = `<span>Hiển thị <b>${data.length}</b> sản phẩm</span> ${this.staleIndicator(is_stale)}`;
        }

        if (!data.length) {
            grid.innerHTML = `<div class="v4-empty">
                <span class="v4-empty-icon">🔍</span>
                <p>Chưa có dữ liệu xu hướng cho mục này.</p>
                <p style="font-size:0.8rem; margin-top:8px;">Nhấn <b>Refresh AI</b> để bắt đầu quét thị trường.</p>
            </div>`;
            return;
        }

        const sorted = [...data].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

        grid.innerHTML = sorted.map(item => `
            <div class="v4-card" data-product-id="${item.id}">
                <div class="v4-card-header">
                    <div class="v4-card-title-group">
                        <h3 class="v4-card-name">${item.product_name || 'N/A'}</h3>
                        <span class="v4-card-cat">${item.category || ''}${item.sub_category ? ' › ' + item.sub_category : ''}</span>
                    </div>
                    <div class="v4-card-badges">
                        ${this.growthBadge(item.growth_signal)}
                        ${item.market_maturity ? `<span class="v4-badge v4-badge-maturity">${item.market_maturity}</span>` : ''}
                    </div>
                </div>
                <div class="v4-card-scores">
                    ${this.scoreRing(item.trend_score || 0, 'Trend')}
                    ${this.scoreRing(item.confidence_score || 0, 'Conf.')}
                    ${item.competition_level ? `<div class="v4-comp-level">
                        <span class="v4-comp-label">Cạnh tranh</span>
                        <span class="v4-comp-val">${item.competition_level}</span>
                    </div>` : ''}
                </div>
                <p class="v4-card-summary">${item.summary || ''}</p>
                <div class="v4-card-meta">
                    ${(item.platform_signal || []).map(p => `<span class="v4-platform-tag">${p}</span>`).join('')}
                </div>
                <div class="v4-card-footer">
                    <button class="v4-btn v4-btn-detail" onclick="TrendV4.openDetail('${item.id}')">📊 Chi tiết</button>
                    <span class="v4-price-band v4-price-${item.price_band || 'mid'}">${item.price_band || 'mid'}</span>
                </div>
            </div>
        `).join('');
    },

    async openDetail(productId) {
        const modal = document.getElementById('v4DetailModal');
        const modalBody = document.getElementById('v4ModalBody');
        const modalTitle = document.getElementById('v4ModalTitle');
        if (!modal || !modalBody) return;

        modalBody.innerHTML = `<div class="v4-loading"><div class="v4-spinner"></div><p>Đang tải phân tích chuyên sâu...</p></div>`;
        modal.style.display = 'flex';

        const baseItem = this.state.data.find(d => d.id === productId);
        if (modalTitle) modalTitle.textContent = baseItem?.product_name || productId;

        try {
            const res = await fetch(`/api/product-trends/${productId}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Lỗi');
            const { overview, deep_dive, opportunity } = json.data;
            modalBody.innerHTML = this.renderDetailContent(overview, deep_dive, opportunity);
        } catch (err) {
            modalBody.innerHTML = `<p class="v4-error">❌ ${err.message}</p>`;
        }
    },

    renderDetailContent(overview, deepDive, opportunity) {
        let html = `<div class="v4-detail-tabs">`;
        
        // Overview
        html += `<div class="v4-detail-section">
            <h4>📊 Tổng quan</h4>
            <div class="v4-detail-grid">
                <div><span class="v4-label">Audience</span><span>${overview?.target_audience || '--'}</span></div>
                <div><span class="v4-label">Search Intent</span><span>${overview?.search_intent || '--'}</span></div>
                <div><span class="v4-label">Price Band</span><span>${overview?.price_band || '--'}</span></div>
                <div><span class="v4-label">Window</span><span>${overview?.source_window || '--'}</span></div>
            </div>
            <div class="v4-platform-row">
                ${(overview?.source_providers || []).map(p => `<span class="v4-platform-tag">${p}</span>`).join('')}
            </div>
        </div>`;

        // Deep Dive
        if (deepDive) {
            html += `<div class="v4-detail-section">
                <h4>🔬 Phân tích chuyên sâu</h4>
                <div class="v4-detail-grid">
                    <div><span class="v4-label">Biên lợi nhuận</span><span class="v4-highlight">${deepDive.margin_potential || '--'}</span></div>
                    <div><span class="v4-label">Viral content</span><span class="v4-highlight">${deepDive.content_virality || '--'}</span></div>
                    <div><span class="v4-label">Vận chuyển</span><span>${deepDive.shipping_complexity || '--'}</span></div>
                    <div><span class="v4-label">Rủi ro pháp lý</span><span>${deepDive.regulatory_risk || '--'}</span></div>
                    <div><span class="v4-label">Biên GM ước tính</span><span>${deepDive.estimated_gross_margin_percent || '--'}%</span></div>
                    <div><span class="v4-label">Giá thị trường</span><span>$${deepDive.average_market_price_usd || '--'}</span></div>
                </div>
                ${deepDive.consumer_pain_points?.length ? `<div class="v4-pain-points">
                    <b>Pain points:</b> ${deepDive.consumer_pain_points.map(p => `<span class="v4-tag">${p}</span>`).join('')}
                </div>` : ''}
                ${deepDive.main_keywords?.length ? `<div class="v4-keywords">
                    <b>Keywords:</b> ${deepDive.main_keywords.map(k => `<span class="v4-keyword-tag">${k}</span>`).join('')}
                </div>` : ''}
            </div>`;
        }

        // Opportunity
        if (opportunity) {
            const plan = Array.isArray(opportunity.execution_plan) ? opportunity.execution_plan : [];
            html += `<div class="v4-detail-section v4-opportunity">
                <h4>🎯 ${opportunity.recommendation_title || 'Chiến lược hành động'}</h4>
                <p class="v4-hook">"${opportunity.hook || ''}"</p>
                <div class="v4-detail-grid v4-kpi-row">
                    <div><span class="v4-label">ROI</span><b class="v4-score-green">${opportunity.roi_score || '--'}</b></div>
                    <div><span class="v4-label">Urgency</span><b>${opportunity.urgency_score || '--'}</b></div>
                    <div><span class="v4-label">Difficulty</span><b>${opportunity.difficulty_score || '--'}</b></div>
                    <div><span class="v4-label">Kết quả đầu tiên</span><b>${opportunity.time_to_first_result || '--'}</b></div>
                </div>
                ${plan.length ? `<ol class="v4-execution-plan">${plan.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
                ${opportunity.risk ? `<p class="v4-risk">⚠️ <b>Rủi ro:</b> ${opportunity.risk}</p>` : ''}
                ${opportunity.expected_kpi ? `<p class="v4-kpi">📌 <b>KPI:</b> ${opportunity.expected_kpi}</p>` : ''}
            </div>`;
        }

        html += `</div>`;
        return html;
    },

    closeModal() {
        const modal = document.getElementById('v4DetailModal');
        if (modal) modal.style.display = 'none';
    }
};

// Init V4 when the trend tab is selected
window.initTrendV4 = function() {
    if (!TrendV4._initialized) {
        TrendV4._initialized = true;
        TrendV4.init();
    }
};

