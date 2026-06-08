// Research Dashboard JS
let mmoData = [], aiData = [], suggestData = [];
let mmoMeta = null, aiMeta = null, suggestMeta = null;
let affVidCandidates = [];
let affVidCurrentPlan = null;
let affVidMeta = null;
let upPostSources = [];
let upPostCurrent = null;
let upPostMeta = null;
let promptBuilderOptions = null;
let promptBuilderSelection = { scenario: null, character: null, moods: [], styles: [] };
let promptBuilderLastPrompt = '';
let mediaCreatorLastUpload = null;
let mmoSort = { col: 'trend', dir: -1 };
let dailyUsageCache = { page: 1, limit: 7, total_days: 0, totals: null, daily: [] };
let selectedDailyDay = null;
let dateAvailabilityCache = null;
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
    if (page === 'mmo') { loadMMO(); }
    if (page === 'ai') { loadAI(); }
    if (page === 'suggest') { loadSuggestions(); }
    if (page === 'affvid') { loadAffVidCandidates(); }
    if (page === 'uppost') { loadUpPostSources(); }
    if (page === 'promptbuilder') { loadPromptBuilderOptions(); }
    if (page === 'mediacreator') { initMediaCreator(); }
    if (page === 'quota') { loadQuota(); }
    if (page === 'prompts') { loadPrompts(); }
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

    const buttons = ['mmo', 'ai', 'suggest', 'trends', 'affvid', 'uppost', 'promptbuilder', 'mediacreator', 'quota', 'prompts'];
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

    if (page === 'mmo') loadMMO();
    if (page === 'ai') loadAI();
    if (page === 'suggest') loadSuggestions();
    if (page === 'trends') initTrendV4();
    if (page === 'affvid') loadAffVidCandidates();
    if (page === 'uppost') loadUpPostSources();
    if (page === 'promptbuilder') loadPromptBuilderOptions();
    if (page === 'mediacreator') initMediaCreator();
    if (page === 'quota') {
        loadQuota();
        loadDailyUsage(dailyUsageCache.page || 1).catch(() => {});
    }
    if (page === 'prompts') loadPrompts();

    if (['mmo', 'ai', 'suggest', 'trends', 'affvid', 'uppost'].includes(page)) {
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
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}
function scoreBar(v) {
    return `<div class="score-bar"><div class="bar"><div class="fill" style="width:${v}%;background:${scoreColor(v)}"></div></div><span>${v}</span></div>`;
}
function badge(label, type) {
    return `<span class="badge badge-${type}">${label}</span>`;
}
function promptPageLabel(page) {
    const map = {
        overview: 'Xu hướng Sản phẩm (Product Trends)',
        deep_dive: 'Phân tích sâu (Deep Dive)',
        opportunity: 'Kế hoạch cơ hội (Opportunity Plan)',
        mmo: 'Nghiên cứu MMO (MMO Research)',
        ai_tools: 'Thị trường AI (AI Tools Market)',
        suggestions: 'Gợi ý từ AI (AI Suggestions)',
        aff_vid: 'Studio Kịch bản Video (Video Script Studio)',
        up_post: 'Soạn thảo bài viết (Social Post Composer)',
        test: 'Kiểm tra Prompt (Test Prompt)'
    };
    return map[page] || String(page || '').replace(/_/g, ' ');
}
function priceColor(p) {
    const map = { free: 'success', freemium: 'info', paid: 'warning', enterprise: 'error' };
    return map[p] || 'muted';
}
function statusBadge(s) {
    const map = {
        new_launch: ['success','New launch'],
        on_discount: ['warning','Discount'],
        major_update: ['info','Major update'],
        viral: ['success','Viral'],
        established: ['info','Stable'],
        deprecated: ['error','Deprecated']
    };
    const [type, label] = map[s] || ['muted', s];
    return badge(label, type);
}
function showAlert(msg, type = 'warning') {
    if (window.AppToast?.show) {
        window.AppToast.show(msg, type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info');
    }
    const banner = document.getElementById('researchAlertBanner') || document.getElementById('alertBanner');
    if (!banner) return;
    banner.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(() => { banner.innerHTML = ''; }, 6000);
}

function formatDay(d) {
    const date = new Date(d);
    return isNaN(date) ? d : date.toLocaleDateString('vi-VN');
}

function dayKey(d) {
    if (!d) return '';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const date = new Date(d);
    if (isNaN(date)) return String(d).slice(0, 10);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
    return getDailyDays()[0] || null;
}

function getDailyDays() {
    const seen = new Set();
    const days = [];
    (dailyUsageCache.daily || []).forEach(row => {
        const day = dayKey(row.day);
        if (!day || seen.has(day)) return;
        seen.add(day);
        days.push(day);
    });
    return days;
}

function getDailyAggregate(day) {
    const rows = (dailyUsageCache.daily || []).filter(row => dayKey(row.day) === dayKey(day));
    if (rows.length === 0) return null;
    return rows.reduce((acc, row) => ({
        day: row.day,
        requests: (acc.requests || 0) + Number(row.requests || 0),
        prompt_tokens: (acc.prompt_tokens || 0) + Number(row.prompt_tokens || 0),
        output_tokens: (acc.output_tokens || 0) + Number(row.output_tokens || 0),
        total_tokens: (acc.total_tokens || 0) + Number(row.total_tokens || 0),
        cache_hits: (acc.cache_hits || 0) + Number(row.cache_hits || 0)
    }), { day });
}

function getSelectedDay() {
    const available = getDailyDays().map(d => dayKey(d));
    if (selectedDailyDay && available.includes(dayKey(selectedDailyDay))) return dayKey(selectedDailyDay);
    return getLatestDay();
}

function getSelectedResearchDate() {
    return selectedDailyDay ? dayKey(selectedDailyDay) : '';
}

function withResearchDate(url) {
    const date = getSelectedResearchDate();
    if (!date) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}date=${encodeURIComponent(date)}`;
}

async function ensureDailyUsageLoaded() {
    if (dailyUsageCache.daily?.length) return;
    await loadDailyUsage(1).catch(err => console.warn('[Research] Daily usage preload failed:', err.message));
}

async function loadDateAvailability() {
    const date = getSelectedResearchDate();
    const url = date ? `/api/research/date-availability?date=${encodeURIComponent(date)}` : '/api/research/date-availability';
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Lỗi tải trạng thái ngày');
    dateAvailabilityCache = json;
    return json;
}

function metaDateLabel(meta) {
    const mode = meta?.date_mode === 'selected' ? 'Ngày chọn (Selected date)' : 'Mới nhất có dữ liệu (Latest available)';
    const date = meta?.resolved_date || meta?.date || meta?.requested_date || '';
    return `${mode}: ${date ? formatDay(date) : '--'}`;
}

function emptyMetaHtml(title, meta, refreshText = 'Refresh AI') {
    const nearest = meta?.available_dates?.[0];
    const switchBtn = nearest && nearest !== meta?.requested_date
        ? `<button class="btn btn-outline btn-sm" onclick="selectResearchDate('${nearest}')">Chuyển sang ${formatDay(nearest)}</button>`
        : '';
    return `<div class="empty-state">
        <h3>${title}</h3>
        <p>${meta?.empty_reason || 'Không có dữ liệu cho bộ lọc hiện tại.'}</p>
        <p>${metaDateLabel(meta)}</p>
        <div class="empty-actions">${switchBtn}<span>${refreshText}</span></div>
    </div>`;
}

function shortText(value, max = 130) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sourceMeta(item = {}) {
    const date = item.source_date || item.source_dates?.[0] || item.published_at || item.updated_at || '';
    const url = item.source_url || item.source_urls?.[0] || item.supporting_sources?.[0] || item.url || item.launch_url || item.github_url || '';
    const evidence = item.evidence_summary || item.market_reason || item.freshness_note || '';
    const source = url ? `<a class="source-link" href="${url}" target="_blank" rel="noopener">Nguồn</a>` : '';
    return `<div class="fresh-meta">${date ? `<span>${formatDay(date)}</span>` : ''}${source}${evidence ? `<span>${shortText(evidence, 110)}</span>` : ''}</div>`;
}

window.selectResearchDate = function selectResearchDate(day) {
    selectedDailyDay = day ? dayKey(day) : null;
    renderDailySummaryAll();
    renderDailyUsage();
    reloadResearchDataForSelectedDate();
};

function currentTabKey() {
    if (document.getElementById('rpage-mmo')?.classList.contains('active') || document.getElementById('page-mmo')?.classList.contains('active')) return 'mmo';
    if (document.getElementById('rpage-ai')?.classList.contains('active') || document.getElementById('page-ai')?.classList.contains('active')) return 'ai';
    if (document.getElementById('rpage-suggest')?.classList.contains('active') || document.getElementById('page-suggest')?.classList.contains('active')) return 'suggest';
    if (document.getElementById('rpage-trends')?.classList.contains('active') || document.getElementById('page-trends')?.classList.contains('active')) return 'trends';
    if (document.getElementById('rpage-affvid')?.classList.contains('active') || document.getElementById('page-affvid')?.classList.contains('active')) return 'affvid';
    if (document.getElementById('rpage-uppost')?.classList.contains('active') || document.getElementById('page-uppost')?.classList.contains('active')) return 'uppost';
    if (document.getElementById('rpage-quota')?.classList.contains('active') || document.getElementById('page-quota')?.classList.contains('active')) return 'quota';
    return null;
}

function reloadResearchDataForSelectedDate() {
    mmoData = [];
    aiData = [];
    suggestData = [];
    const tab = currentTabKey();
    if (tab === 'mmo') return loadMMO();
    if (tab === 'ai') return loadAI();
    if (tab === 'suggest') return loadSuggestions();
    if (tab === 'trends' && window.TrendV4) return TrendV4.load(false);
    if (tab === 'affvid') return loadAffVidCandidates();
    if (tab === 'uppost') return loadUpPostSources();
    if (tab === 'quota') return loadQuota();
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
    const selectedDay = getSelectedResearchDate();
    const options = getDailyDays().map(day => {
        const val = dayKey(day);
        const selected = val === dayKey(selectedDay) ? 'selected' : '';
        return `<option value="${val}" ${selected}>${formatDay(day)}</option>`;
    }).join('');
    const dayToShow = getDailyAggregate(selectedDay) || latest;
    el.innerHTML = `
        <div class="daily-controls">
            <label for="dailySelect">Chọn ngày (Date)</label>
            <select class="daily-day-select" data-daily-select="${targetId}">
                <option value="" ${selectedDay ? '' : 'selected'}>Tự động mới nhất theo page (Auto latest per page)</option>
                ${options}
            </select>
        </div>
        <div class="daily-card">
            <div class="daily-label">${selectedDay ? 'Ngày đang chọn' : 'Usage mới nhất'}</div>
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
    renderDailySummary('dailySummary-trends', latest, dailyUsageCache.totals);
    renderDailySummary('dailySummary-affvid', latest, dailyUsageCache.totals);
    renderDailySummary('dailySummary-uppost', latest, dailyUsageCache.totals);
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
    await ensureDailyUsageLoaded();
    const tableBody = document.getElementById('mmoTableBody');
    const updatedLabel = document.getElementById('mmoUpdated');
    
    if (tableBody) renderSkeleton('mmoTableBody', 6, 6);
    if (updatedLabel) updatedLabel.textContent = 'Đang tải dữ liệu (Loading data) từ server...';

    try {
        const res = await fetch(withResearchDate('/api/research/page-1'));
        const json = await res.json();
        if (!json.success) {
            if (updatedLabel) updatedLabel.textContent = 'Lỗi tải dữ liệu (Data load error)';
            return showAlert(json.error, 'error');
        }
        mmoData = json.data || [];
        mmoMeta = json.meta || null;
        console.log('[Research] MMO data received:', mmoData);
        if (updatedLabel) updatedLabel.textContent = `${mmoData.length} cơ hội (opportunities) · ${metaDateLabel(json.meta)} · Nguồn (Source): ${json.meta?.source || 'DB'}`;
        renderMMOTopCards();
        renderGroupSections('mmoGroupSections', mmoData, 'category');
        renderMMOTable();
        fillMMOFilters();
        console.log('[Research] MMO data loaded:', mmoData.length);
    } catch (e) { 
        console.error('[Research] MMO Load Error:', e);
        if (updatedLabel) updatedLabel.textContent = 'Lỗi kết nối server (Server connection error)';
        showAlert('Lỗi tải dữ liệu MMO (MMO data load error): ' + e.message, 'error');
    }
}

function fillMMOFilters() {
    const cats = [...new Set(mmoData.map(d => d.category).filter(Boolean))];
    const sel = document.getElementById('mmoCategoryFilter');
    sel.innerHTML = '<option value="">Tất cả ngách (All niches)</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderMMOTopCards() {
    const top = [...mmoData].sort((a,b) => (b.trend_score||0) - (a.trend_score||0)).slice(0, 3);
    document.getElementById('mmoTopCards').innerHTML = top.map(item => `
        <div class="opportunity-card">
            <div class="badge-row">${badge(item.category || '—', 'primary')}${badge(item.traffic_source || '—', 'muted')}</div>
            <h3>${item.title || '—'}</h3>
            <p>${shortText(item.summary || item.content_angle || '', 150)}</p>
            <div class="score-row">
                <div class="score-item">Xu hướng (Trend) <span class="sv">${item.trend_score||0}</span></div>
                <div class="score-item">Kiếm tiền (Monetize) <span class="sv">${item.monetization_score||0}</span></div>
                <div class="score-item">Cạnh tranh (Competition) <span class="sv">${item.competition_score||0}</span></div>
            </div>
            <div class="compact-line"><b>Model</b><span>${shortText(item.monetization_model || '—', 90)}</span></div>
            ${sourceMeta(item)}
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

    // Merge small groups into "other" to avoid cluttering UI with many 1-item sections
    const MIN_ITEMS_PER_GROUP = 3;
    const finalGroups = {};
    let otherItems = [];

    Object.entries(groups).forEach(([key, items]) => {
        if (items.length < MIN_ITEMS_PER_GROUP && key !== 'other') {
            // Keep original category in badge, but move card to 'other' section
            items.forEach(item => {
                if (!item._originalGroupLabel) {
                    item._originalGroupLabel = labelMap?.[key] || key;
                }
            });
            otherItems.push(...items);
        } else {
            finalGroups[key] = items;
        }
    });

    if (otherItems.length > 0) {
        if (!finalGroups['other']) finalGroups['other'] = [];
        finalGroups['other'].push(...otherItems);
    }

    const entries = Object.entries(finalGroups).sort((a, b) => {
        if (a[0] === 'other') return 1;
        if (b[0] === 'other') return -1;
        return b[1].length - a[1].length;
    });

    if (entries.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = entries.map(([key, items]) => {
        if (items.length === 0) return '';
        const label = key === 'other' ? 'Khác (Others)' : (labelMap?.[key] || key);
        const cards = items.slice(0, 8).map(item => `
            <div class="opportunity-card">
                <div class="badge-row">${badge(item._originalGroupLabel || labelMap?.[item[groupKey]] || item[groupKey] || 'Khác', 'primary')}${item.traffic_source ? badge(item.traffic_source, 'muted') : ''}</div>
                <h3>${item.title || item.tool_name || item.recommendation_title || '—'}</h3>
                <p>${shortText(item.summary || item.market_signal || item.recommendation_text || '', 120)}</p>
                ${sourceMeta(item)}
            </div>`).join('');

        return `
            <section class="group-section">
                <div class="group-header">
                    <h3>${label}</h3>
                    <span>${items.length} mục (items)</span>
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
    document.getElementById('mmoCount').textContent = `${data.length} kết quả (results)`;
    if (!data.length) { document.getElementById('mmoTableBody').innerHTML = `<tr><td colspan="6">${emptyMetaHtml('Không có dữ liệu MMO (No MMO data)', mmoMeta, 'Nhấn Refresh AI để tạo dữ liệu mới.')}</td></tr>`; return; }
    document.getElementById('mmoTableBody').innerHTML = data.map(d => `
        <tr>
            <td><b>${d.title||'—'}</b><div class="table-sub">${shortText(d.content_angle||d.summary||'', 150)}</div>${sourceMeta(d)}</td>
            <td>${badge(d.category||'—','primary')}</td>
            <td>${scoreBar(d.trend_score||0)}</td>
            <td>${scoreBar(d.monetization_score||0)}</td>
            <td>${scoreBar(d.competition_score||0)}</td>
            <td><span class="table-sub">${shortText(d.monetization_model||'—', 110)}</span>${d.traffic_source ? `<div class="table-sub">Traffic: ${shortText(d.traffic_source, 90)}</div>` : ''}</td>
        </tr>`).join('');
}

function filterMMO() { renderMMOTable(); }
function sortMMO(col) { mmoSort = { col, dir: -1 }; renderMMOTable(); }

// ─── Load AI Tools (Page 2) ───────────────────────────────────────────────
window.loadAI = async function loadAI() {
    await ensureDailyUsageLoaded();
    renderSkeleton('aiTableBody', 8, 7);
    try {
        const res = await fetch(withResearchDate('/api/research/page-2'));
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        aiData = json.data || [];
        aiMeta = json.meta || null;
        document.getElementById('aiUpdated').textContent = `${aiData.length} công cụ (tools) · ${metaDateLabel(json.meta)}`;
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
            <p>${shortText(d.summary || d.use_case || '', 150)}</p>
            <div class="compact-line"><b>Tín hiệu</b><span>${shortText(d.market_signal||'', 100)}</span></div>
            ${sourceMeta(d)}
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
    if (!data.length) { document.getElementById('aiTableBody').innerHTML = `<tr><td colspan="7">${emptyMetaHtml('Không có dữ liệu AI Market (No AI Market data)', aiMeta, 'Nhấn Refresh AI để tạo dữ liệu mới.')}</td></tr>`; return; }
    document.getElementById('aiTableBody').innerHTML = data.map(d => `
        <tr>
            <td><b>${d.tool_name||'—'}</b>
                ${d.is_best_value ? '<span style="font-size:0.7rem;color:var(--success);margin-left:6px">💎</span>' : ''}
                ${d.is_new_noteworthy ? '<span style="font-size:0.7rem;color:var(--info);margin-left:4px">🆕</span>' : ''}
            </td>
            <td>${badge(d.tool_type||'other','primary')}</td>
            <td>${badge(d.price_level||'?', priceColor(d.price_level))}</td>
            <td>${statusBadge(d.discount_or_launch_status)}</td>
            <td class="table-sub">${shortText(d.use_case||'—', 120)}</td>
            <td class="table-sub">${shortText(d.market_signal||'—', 120)}${sourceMeta(d)}</td>
            <td class="table-sub">${shortText(d.best_value_reason||'—', 120)}</td>
        </tr>`).join('');
}
function filterAI() { renderAITable(); }

// ─── Load Suggestions (Page 3) ────────────────────────────────────────────
window.loadSuggestions = async function loadSuggestions() {
    await ensureDailyUsageLoaded();
    document.getElementById('suggestList').innerHTML = '<div class="empty-state">⏳ Đang tải...</div>';
    try {
        const res = await fetch(withResearchDate('/api/research/page-3'));
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        suggestData = json.data || [];
        suggestMeta = json.meta || null;
        document.getElementById('suggestUpdated').textContent = `${suggestData.length} gợi ý (suggestions) · ${metaDateLabel(json.meta)}`;
        renderSuggestions();
    } catch (e) { showAlert('Lỗi: ' + e.message, 'error'); }
}

function renderSuggestions() {
    if (!suggestData.length) {
        document.getElementById('suggestList').innerHTML = emptyMetaHtml('Chưa có gợi ý (No suggestions)', suggestMeta, 'Nhấn Refresh AI để tạo gợi ý mới.');
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
                    <p>${shortText(d.recommendation_text||'', 190)}</p>
                    <div class="suggest-scores">
                        <div class="suggest-score">Confidence <span class="val">${d.confidence_score||0}</span></div>
                        <div class="suggest-score">Urgency <span class="val">${d.urgency_score||0}</span></div>
                        <div class="suggest-score">ROI <span class="val">${d.roi_score||0}</span></div>
                    </div>
                    ${d.reasoning_summary ? `<p class="suggest-reason">${shortText(d.reasoning_summary, 170)}</p>` : ''}
                    ${sourceMeta(d)}
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

// ─── AFF VID ────────────────────────────────────────────────────────────────
function selectedAffVidPlatform() {
    return document.getElementById('affVidPlatformFilter')?.value || 'TikTok';
}

function getAffVidSetup() {
    return {
        platform_targets: [selectedAffVidPlatform()],
        video_duration: document.getElementById('affVidDuration')?.value || '30-45s',
        tone: document.getElementById('affVidTone')?.value || 'review thực tế',
        cta_type: document.getElementById('affVidCtaType')?.value || 'affiliate_click',
        creator_persona: document.getElementById('affVidPersona')?.value || 'reviewer tiếng Việt',
        affiliate_url: document.getElementById('affVidAffiliateUrl')?.value?.trim() || null,
        language: 'vi'
    };
}

window.loadAffVidCandidates = async function loadAffVidCandidates() {
    const list = document.getElementById('affVidCandidateList');
    const updated = document.getElementById('affVidUpdated');
    if (!list) return;
    await ensureDailyUsageLoaded();
    list.innerHTML = '<div class="empty-state">Đang tải sản phẩm từ research...</div>';
    const windowValue = document.getElementById('affVidWindowFilter')?.value || 'today';
    const date = getSelectedResearchDate();
    const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
    try {
        const res = await fetch(`/api/research/aff-vid/source-products?market=vn&window=${encodeURIComponent(windowValue)}&categories=all&limit=20${dateParam}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Không tải được sản phẩm Video Script Studio');
        affVidCandidates = json.data || [];
        affVidMeta = json.meta || null;
        if (updated) updated.textContent = `${affVidCandidates.length} sản phẩm (products) · ${metaDateLabel(json.meta)} · Window: ${json.meta?.window || windowValue}`;
        renderAffVidCandidates();
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><h3>Lỗi tải Video Script Studio</h3><p>${err.message}</p></div>`;
        showAlert(err.message, 'error');
    }
};
window.renderAffVidCandidates = function renderAffVidCandidates() {
    const list = document.getElementById('affVidCandidateList');
    if (!list) return;
    if (!affVidCandidates.length) {
        list.innerHTML = emptyMetaHtml('Chưa có sản phẩm phù hợp (No suitable product)', affVidMeta, 'Hãy refresh Trends V4 hoặc đổi ngày/window.');
        return;
    }
    list.innerHTML = affVidCandidates.map(item => `
        <div class="affvid-item">
            <div>
                <b>${item.product_name || item.product_id}</b>
                <p>${item.niche || 'General'} · ${item.angle_seed || 'Không có summary'}</p>
                <div class="badge-row">
                    ${badge(`Trend ${item.trend_score || 0}`, 'primary')}
                    ${badge(`Tin cậy ${item.confidence_score || 0}`, 'success')}
                    ${badge(`Ưu tiên ${item.priority_score || 0}`, 'muted')}
                </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="generateAffVidPlan('${item.product_id}')">Sinh video (Generate)</button>
        </div>
    `).join('');
};

window.generateAffVidPlan = async function generateAffVidPlan(productId) {
    const out = document.getElementById('affVidOutput');
    if (out) out.textContent = 'Đang gọi Gemini để sinh video plan JSON...';
    try {
        const res = await fetch('/api/research/aff-vid/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: productId,
                ...getAffVidSetup()
            })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Không sinh được video plan');
        affVidCurrentPlan = json.data;
        if (out) out.textContent = formatUpPostPreview(json.data);
        showAlert('Đã sinh video affiliate plan từ dữ liệu research.', 'success');
    } catch (err) {
        if (out) out.textContent = `Lỗi: ${err.message}`;
        showAlert(err.message, 'error');
    }
};

window.copyAffVidPlan = async function copyAffVidPlan() {
    if (!affVidCurrentPlan) return showAlert('Chưa có video plan để copy.', 'warning');
    await navigator.clipboard.writeText(JSON.stringify(affVidCurrentPlan, null, 2));
    showAlert('Đã copy JSON video plan.', 'success');
};

window.showResearchGuide = function showResearchGuide(type) {
    const guides = {
        affvid: {
            title: 'Hướng dẫn Video Script Studio',
            steps: [
                'Stage 1: Chọn ngày/window để lấy sản phẩm thật từ Trends V4.',
                'Stage 2: Setup platform, độ dài video, tone, CTA và affiliate URL nếu có.',
                'Stage 3: Bấm Sinh video để tạo hook, script, shot list, caption, hashtag.',
                'Stage 4: Copy JSON hoặc dùng plan này làm source cho Social Post Composer/n8n.'
            ]
        },
        uppost: {
            title: 'Hướng dẫn Social Post Composer',
            steps: [
                'Stage 1: Chọn source từ Video Script Studio hoặc Research result theo ngày.',
                'Stage 2: Chọn từng nền tảng; hệ thống sẽ sinh biến thể riêng, không dùng một bài chung.',
                'Stage 3: Setup giờ đăng, campaign tag, post type, tone và CTA.',
                'Stage 4: Bấm Sinh post rồi đưa draft đạt yêu cầu vào publishing queue.'
            ]
        }
    };
    const guide = guides[type] || guides.affvid;
    let modal = document.getElementById('researchGuideModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'researchGuideModal';
        modal.className = 'research-guide-modal';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="research-guide-backdrop" onclick="closeResearchGuide()"></div>
        <div class="research-guide-card">
            <div class="research-guide-head">
                <h3>${guide.title}</h3>
                <button class="btn btn-outline btn-sm" onclick="closeResearchGuide()">Đóng (Close)</button>
            </div>
            <ol>${guide.steps.map(step => `<li>${step}</li>`).join('')}</ol>
        </div>`;
    modal.style.display = 'block';
};

window.closeResearchGuide = function closeResearchGuide() {
    const modal = document.getElementById('researchGuideModal');
    if (modal) modal.style.display = 'none';
};

// ─── UP POST ────────────────────────────────────────────────────────────────
function selectedUpPostPlatforms() {
    const boxes = document.querySelectorAll('.uppost-platforms input[type="checkbox"]:checked');
    return Array.from(boxes).map(box => box.value);
}

function getUpPostSetup() {
    return {
        scheduled_time: document.getElementById('upPostScheduledTime')?.value || null,
        campaign_tag: document.getElementById('upPostCampaignTag')?.value?.trim() || null,
        post_type: document.getElementById('upPostPostType')?.value || null,
        tone: document.getElementById('upPostTone')?.value || 'rõ ràng, có CTA',
        cta_type: document.getElementById('upPostCtaType')?.value || 'engagement_or_click'
    };
}

function formatUpPostPreview(data) {
    const posts = data?.posts || [];
    const warnings = data?.warnings || [];
    if (!posts.length) return JSON.stringify(data || {}, null, 2);
    const lines = [
        `Social Post Composer ${data.schema_version || ''}`,
        `Source: ${data.source_type || ''} / ${data.source_content_id || ''}`,
        `Model: ${data.model_name || '--'}`,
        ''
    ];
    if (warnings.length) {
        lines.push('Warnings:');
        warnings.forEach(w => lines.push(`- ${w}`));
        lines.push('');
    }
    posts.forEach(post => {
        const render = post.render_data || {};
        lines.push(`=== ${String(post.platform || '').toUpperCase()} | ${post.status || 'draft'} | fit ${post.platform_fit_score ?? '--'} | confidence ${post.confidence_score ?? '--'} ===`);
        lines.push(`Type: ${post.post_type || ''}`);
        if (post.campaign_tag) lines.push(`Campaign: ${post.campaign_tag}`);
        if (post.scheduled_time) lines.push(`Scheduled: ${post.scheduled_time}`);
        lines.push(`Title: ${post.title || ''}`);
        lines.push(`Hook: ${post.hook || ''}`);
        lines.push('');
        lines.push(render.preview_text || `${post.body || ''}\n\n${(post.hashtags || []).join(' ')}`.trim());
        if ((post.shot_suggestions || []).length) {
            lines.push('');
            lines.push('Shot suggestions:');
            post.shot_suggestions.forEach(s => lines.push(`- ${s}`));
        }
        if ((post.validation_warnings || []).length) {
            lines.push('');
            lines.push('Validation warnings:');
            post.validation_warnings.forEach(w => lines.push(`- ${w}`));
        }
        lines.push('');
    });
    return lines.join('\n');
}

window.loadUpPostSources = async function loadUpPostSources() {
    const list = document.getElementById('upPostSourceList');
    const updated = document.getElementById('upPostUpdated');
    if (!list) return;
    list.innerHTML = '<div class="empty-state">Đang tải source content...</div>';
    const sourceType = document.getElementById('upPostSourceType')?.value || 'aff_vid';
    const date = getSelectedResearchDate();
    const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
    try {
        const res = await fetch(`/api/research/up-post/sources?source_type=${encodeURIComponent(sourceType)}&limit=20${dateParam}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Không tải được Social Post Composer sources');
        upPostSources = json.data || [];
        upPostMeta = json.meta || null;
        if (updated) updated.textContent = `${upPostSources.length} source · Loại (Type): ${sourceType} · ${metaDateLabel(json.meta)}`;
        renderUpPostSources();
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><h3>Lỗi tải Social Post Composer</h3><p>${err.message}</p></div>`;
        showAlert(err.message, 'error');
    }
};

window.renderUpPostSources = function renderUpPostSources() {
    const list = document.getElementById('upPostSourceList');
    if (!list) return;
    if (!upPostSources.length) {
        list.innerHTML = emptyMetaHtml('Chưa có source (No source content)', upPostMeta, 'Hãy sinh Video Script Studio trước hoặc chọn Research result.');
        return;
    }
    list.innerHTML = upPostSources.map(source => `
        <div class="uppost-item">
            <div>
                <b>${source.title || source.source_content_id}</b>
                <p>${source.summary || 'Không có summary'}</p>
                <div class="badge-row">
                    ${badge(source.source_type || 'source', 'primary')}
                    ${source.product_id ? badge(source.product_id, 'muted') : ''}
                </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="generateUpPostVariants('${source.source_content_id}', '${source.source_type || 'aff_vid'}')">Sinh post (Generate)</button>
        </div>
    `).join('');
};

window.generateUpPostVariants = async function generateUpPostVariants(sourceContentId, sourceType = 'aff_vid') {
    const out = document.getElementById('upPostOutput');
    if (out) out.textContent = 'Đang gọi Gemini để sinh post variants theo platform...';
    const platforms = selectedUpPostPlatforms();
    if (!platforms.length) {
        if (out) out.textContent = 'Hãy chọn ít nhất một nền tảng.';
        return showAlert('Hãy chọn ít nhất một nền tảng.', 'warning');
    }
    try {
        const res = await fetch('/api/research/up-post/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_content_id: sourceContentId,
                source_type: sourceType,
                platforms,
                ...getUpPostSetup()
            })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Không sinh được post variants');
        upPostCurrent = json.data;
        if (out) out.textContent = JSON.stringify(json.data, null, 2);
        showAlert('Đã sinh post variants theo từng nền tảng.', 'success');
    } catch (err) {
        if (out) out.textContent = `Lỗi: ${err.message}`;
        showAlert(err.message, 'error');
    }
};

window.loadUpPostVariants = async function loadUpPostVariants() {
    const out = document.getElementById('upPostOutput');
    try {
        const date = getSelectedResearchDate();
        const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
        const res = await fetch(`/api/research/up-post/variants?limit=20${dateParam}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Không tải được drafts');
        upPostCurrent = {
            posts: (json.data || []).map(row => ({ ...(row.post_data || {}), status: row.status, render_data: row.render_data })),
            warnings: []
        };
        if (out) out.textContent = formatUpPostPreview(upPostCurrent);
    } catch (err) {
        if (out) out.textContent = `Lỗi: ${err.message}`;
        showAlert(err.message, 'error');
    }
};

window.enqueueUpPostVariants = async function enqueueUpPostVariants() {
    const posts = upPostCurrent?.posts || [];
    if (!posts.length) return showAlert('Chưa có post variants để đưa vào queue.', 'warning');
    const postIds = posts.map(post => post.post_id).filter(Boolean);
    const res = await fetch('/api/research/up-post/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: postIds })
    });
    const json = await res.json();
    if (!res.ok || !json.success) return showAlert(json.error || 'Không enqueue được post', 'error');
    showAlert(`Đã đưa ${json.data.length} post vào queue publishing.`, 'success');
};

// ─── Load Quota (Page 4) ──────────────────────────────────────────────────
async function loadQuota() {
    try {
        await ensureDailyUsageLoaded();
        const dateParam = getSelectedResearchDate() ? `?date=${encodeURIComponent(getSelectedResearchDate())}` : '';
        const [res, overviewRes] = await Promise.all([
            fetch(`/api/research/usage${dateParam}`),
            fetch(`/api/research/overview${dateParam}`)
        ]);
        const json = await res.json();
        const q = json.quota;
        const overview = overviewRes.ok ? await overviewRes.json() : null;
        if (!q) return;

        updateQuotaBar(q);

        const pct = Math.round((q.request_count / q.hard_cap) * 100);
        const quotaAlert = document.getElementById('quotaAlertFull');
        if (quotaAlert) {
            if (q.is_blocked) {
                quotaAlert.innerHTML = `<div class="alert alert-error">Tài khoản đã đạt giới hạn cứng (Hard cap) ${q.hard_cap}. Mọi yêu cầu AI (AI requests) bị chặn cho đến ngày mai.</div>`;
            } else if (q.request_count >= q.soft_cap) {
                quotaAlert.innerHTML = `<div class="alert alert-warning">Đạt giới hạn mềm (Soft cap). Hệ thống đang bảo vệ quota. Còn ${q.hard_cap - q.request_count} yêu cầu (requests).</div>`;
            } else {
                quotaAlert.innerHTML = `<div class="alert alert-success">Hạn mức an toàn (Quota safe) — ${q.request_count}/${q.hard_cap} yêu cầu (requests) đã dùng hôm nay.</div>`;
            }
        }

        const remaining = q.remaining_requests ?? Math.max((q.hard_cap || 0) - (q.request_count || 0), 0);
        const retryAfter = q.retry_after_seconds || 0;
        document.getElementById('usageGrid').innerHTML = [
            { label: 'Yêu cầu hôm nay (Requests today)', val: q.request_count, sub: `/ ${q.hard_cap} giới hạn cứng (hard cap)`, color: pct >= 80 ? 'var(--error)' : pct >= 60 ? 'var(--warning)' : 'var(--success)' },
            { label: 'Xu hướng sản phẩm (Product trends)', val: overview?.trends?.products || 0, sub: `${overview?.trends?.categories || 0} danh mục (categories) từ DB` },
            { label: 'MMO / Affiliate', val: overview?.legacy?.mmo?.count || 0, sub: 'Cơ hội (opportunities) từ DB' },
            { label: 'Công cụ AI (AI tools)', val: overview?.legacy?.ai_tools?.count || 0, sub: 'Công cụ (tools) từ DB' },
            { label: 'Gợi ý (Suggestions)', val: overview?.legacy?.suggestions?.count || 0, sub: 'Chiến lược (strategies) từ DB' },
            { label: 'Nhật ký API (API logs)', val: overview?.usage?.requests || 0, sub: 'Tổng lượt gọi (total calls)' },
            { label: 'Xu hướng mới nhất (Latest trend)', val: overview?.trends?.latest_generated_at ? new Date(overview.trends.latest_generated_at).toLocaleDateString('vi-VN') : '--', sub: 'Lần cập nhật gần nhất (latest update)' },
            { label: 'Còn lại (Remaining)', val: remaining, sub: 'Yêu cầu còn lại (requests left)' },
            { label: 'Model hiện tại (Current model)', val: q.last_model || '—', sub: 'Model dùng gần nhất (latest model)' },
            { label: 'Thử lại sau (Retry after)', val: retryAfter ? `${retryAfter}s` : '—', sub: 'Theo quota (quota based)' },
            { label: 'Token prompt (Prompt tokens)', val: (q.prompt_tokens||0).toLocaleString(), sub: 'Tổng hôm nay (today total)' },
            { label: 'Token đầu ra (Output tokens)', val: (q.output_tokens||0).toLocaleString(), sub: 'Tổng hôm nay (today total)' },
            { label: 'Tổng token (Total tokens)', val: (q.total_tokens||0).toLocaleString(), sub: 'Prompt + Output' },
            { label: 'Cache hit (Cache hits)', val: q.cache_hits || 0, sub: 'Tiết kiệm lượt gọi API (saved API calls)' },
            { label: 'Giới hạn mềm (Soft cap)', val: q.soft_cap, sub: 'Theo ngày (per day)' },
            { label: 'Giới hạn cứng (Hard cap)', val: q.hard_cap, sub: 'Theo ngày (per day)' },
            { label: 'Trạng thái (Status)', val: q.is_blocked ? 'Blocked' : 'OK', sub: q.is_blocked ? 'API bị tạm khóa (blocked)' : 'API hoạt động bình thường (healthy)' },
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
        reloadResearchDataForSelectedDate();
    }
});

// ─── Refresh AI ───────────────────────────────────────────────────────────
async function refreshPage(page) {
    const btnMap = { mmo: 'mmoRefreshBtn', ai_tools: 'aiRefreshBtn', suggestions: 'suggestRefreshBtn' };
    const targetDate = dayKey(new Date());
    const selectedDate = getSelectedResearchDate();
    if (selectedDate && selectedDate !== targetDate) {
        showAlert(`Refresh chỉ tạo dữ liệu cho hôm nay (${formatDay(targetDate)}). Ngày cũ sẽ đọc lại từ DB.`, 'warning');
    }
    const buttons = Array.from(document.querySelectorAll(`button[onclick="refreshPage('${page}')"]`));
    const mainBtn = document.getElementById(btnMap[page]);
    if (mainBtn && !buttons.includes(mainBtn)) buttons.push(mainBtn);
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = 'Đang gọi AI...';
    });

    try {
        const res = await fetch('/api/research/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page, source_window: 'last_7_days', target_date: targetDate })
        });
        const json = await res.json();
        if (!res.ok) { showAlert(json.error, 'warning'); return; }

        selectedDailyDay = json.target_date || targetDate;
        showAlert(`Đã refresh ngày ${formatDay(selectedDailyDay)}: ${json.count} mục mới.${json.use_lite ? ' (Lite mode)' : ''}`, 'success');
        await loadDailyUsage(1).catch(() => {});
        if (page === 'mmo') { mmoData = []; loadMMO(); }
        if (page === 'ai_tools') { aiData = []; loadAI(); }
        if (page === 'suggestions') { suggestData = []; loadSuggestions(); }
    } catch(e) { showAlert('Lỗi: ' + e.message, 'error'); }
    finally {
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || 'Refresh AI';
            delete btn.dataset.originalText;
        });
    }
}

// ─── Admin actions ────────────────────────────────────────────────────────
async function resetQuota() {
    const ok = await showConfirm({
        title: 'Reset quota',
        message: 'Reset quota về 0? Chỉ dùng thao tác này cho mục đích test.',
        confirmText: 'Reset quota',
        cancelText: 'Hủy'
    });
    if (!ok) return;
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
// Prompt Builder and Media Creator
async function loadPromptBuilderOptions(force = false) {
    const hasUi = document.getElementById('pbScenarios');
    if (!hasUi) return;
    if (promptBuilderOptions && !force) {
        renderPromptBuilderOptions();
        return;
    }

    ['pbScenarios', 'pbCharacters', 'pbMoods', 'pbStyles'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="empty-state">Loading...</div>';
    });

    try {
        const res = await fetch('/api/product-trends/prompt-options');
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load prompt options');
        promptBuilderOptions = json.data || {};
        promptBuilderSelection = {
            scenario: promptBuilderOptions.scenarios?.[0]?.id || null,
            character: promptBuilderOptions.characters?.[0]?.id || null,
            moods: [promptBuilderOptions.moods?.[0]?.id].filter(Boolean),
            styles: [promptBuilderOptions.styles?.[0]?.id].filter(Boolean)
        };
        renderPromptBuilderOptions();
    } catch (e) {
        showAlert('Prompt Builder options error: ' + e.message, 'error');
    }
}

function renderPromptBuilderOptions() {
    if (!promptBuilderOptions) return;
    renderPromptBuilderCards('pbScenarios', promptBuilderOptions.scenarios || [], 'scenario', false);
    renderPromptBuilderCards('pbCharacters', promptBuilderOptions.characters || [], 'character', false);
    renderPromptBuilderCards('pbMoods', promptBuilderOptions.moods || [], 'moods', true);
    renderPromptBuilderCards('pbStyles', promptBuilderOptions.styles || [], 'styles', true);
}

function renderPromptBuilderCards(containerId, items, key, multiple) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const selected = promptBuilderSelection[key];
    container.innerHTML = items.map(item => {
        const active = multiple ? (selected || []).includes(item.id) : selected === item.id;
        const cls = multiple ? 'option-tag' : 'option-card';
        return `
            <button type="button" class="${cls} ${active ? 'active' : ''}" onclick="selectPromptBuilderOption('${key}','${item.id}',${multiple})">
                <span>${escapeHtml(item.label)}</span>
                ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}
            </button>
        `;
    }).join('');
}

function selectPromptBuilderOption(key, id, multiple) {
    if (multiple) {
        const current = new Set(promptBuilderSelection[key] || []);
        if (current.has(id)) current.delete(id); else current.add(id);
        promptBuilderSelection[key] = Array.from(current);
    } else {
        promptBuilderSelection[key] = id;
    }
    renderPromptBuilderOptions();
}

function collectPromptBuilderPayload() {
    return {
        ...promptBuilderSelection,
        product: document.getElementById('pbProduct')?.value.trim() || '',
        platform: document.getElementById('pbPlatform')?.value || 'TikTok',
        output_type: document.getElementById('pbOutputType')?.value || 'image',
        language: document.getElementById('pbLanguage')?.value || 'English',
        notes: document.getElementById('pbNotes')?.value.trim() || ''
    };
}

async function generateBuiltPrompt() {
    const output = document.getElementById('pbResult');
    if (!output) return;
    output.textContent = 'Generating premium prompt...';

    try {
        if (!promptBuilderOptions) await loadPromptBuilderOptions();
        const res = await fetch('/api/product-trends/generate-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectPromptBuilderPayload())
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to generate prompt');
        promptBuilderLastPrompt = json.data?.prompt || '';
        output.textContent = promptBuilderLastPrompt || 'No prompt returned.';
        showAlert('Prompt generated.', 'success');
    } catch (e) {
        output.textContent = 'Prompt generation failed: ' + e.message;
        showAlert('Prompt generation error: ' + e.message, 'error');
    }
}

async function copyBuiltPrompt() {
    const text = promptBuilderLastPrompt || document.getElementById('pbResult')?.textContent || '';
    if (!text || text.includes('Chon options')) return showAlert('No generated prompt to copy.', 'warning');
    await navigator.clipboard.writeText(text);
    showAlert('Prompt copied.', 'success');
}

function sendPromptToMediaCreator() {
    const text = promptBuilderLastPrompt || document.getElementById('pbResult')?.textContent || '';
    if (!text || text.includes('Chon options')) return showAlert('Generate a prompt first.', 'warning');
    const promptInput = document.getElementById('mcPrompt');
    if (promptInput) promptInput.value = text;
    const type = document.getElementById('pbOutputType')?.value;
    const mediaType = document.getElementById('mcType');
    if (mediaType && type) mediaType.value = type === 'video' ? 'video' : 'image';
    switchPage('mediacreator', document.querySelector('.nav-item[data-page="mediacreator"]'));
}

function initMediaCreator() {
    const promptInput = document.getElementById('mcPrompt');
    if (promptInput && !promptInput.value && promptBuilderLastPrompt) {
        promptInput.value = promptBuilderLastPrompt;
    }
}

function usePromptBuilderResult() {
    if (!promptBuilderLastPrompt) return showAlert('No Prompt Builder result yet.', 'warning');
    const promptInput = document.getElementById('mcPrompt');
    if (promptInput) promptInput.value = promptBuilderLastPrompt;
}

function previewMediaUpload(event) {
    const file = event.target.files?.[0];
    const preview = document.getElementById('mcUploadPreview');
    if (!file || !preview) return;
    const reader = new FileReader();
    reader.onload = () => {
        mediaCreatorLastUpload = { name: file.name, dataUrl: reader.result };
        preview.innerHTML = `
            <div class="upload-chip">
                <img src="${reader.result}" alt="${escapeHtml(file.name)}">
                <span>${escapeHtml(file.name)}</span>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

async function generateMediaAsset() {
    const prompt = document.getElementById('mcPrompt')?.value.trim();
    const status = document.getElementById('mcStatus');
    const result = document.getElementById('mcResult');
    if (!prompt) return showAlert('Nhap prompt truoc khi generate media.', 'warning');
    if (status) status.textContent = 'Generating...';
    if (result) result.innerHTML = '<div class="media-empty">Generating media mockup...</div>';

    try {
        const res = await fetch('/api/product-trends/generate-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                media_type: document.getElementById('mcType')?.value || 'image',
                aspect_ratio: document.getElementById('mcAspect')?.value || '9:16',
                quality: document.getElementById('mcQuality')?.value || 'premium',
                reference_image_name: mediaCreatorLastUpload?.name || ''
            })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to generate media');
        renderMediaResult(json.data || {});
        if (status) status.textContent = 'Generated';
        showAlert('Media mockup generated.', 'success');
    } catch (e) {
        if (status) status.textContent = 'Error';
        if (result) result.innerHTML = `<div class="media-empty">Media generation failed: ${escapeHtml(e.message)}</div>`;
        showAlert('Media generation error: ' + e.message, 'error');
    }
}

function renderMediaResult(data) {
    const result = document.getElementById('mcResult');
    if (!result) return;
    const isVideo = data.media_type === 'video';
    result.innerHTML = `
        <div class="media-result-card">
            <div class="media-art-wrap">
                <img src="${escapeHtml(data.image_url || '')}" alt="Generated media mockup">
                ${isVideo ? '<span class="media-pill">Storyboard placeholder</span>' : '<span class="media-pill">Image placeholder</span>'}
            </div>
            <div class="media-result-meta">
                <b>${escapeHtml(data.title || 'Generated Media')}</b>
                <span>${escapeHtml(data.aspect_ratio || '')} - ${escapeHtml(data.quality || '')}</span>
                <p>${escapeHtml(data.description || '')}</p>
            </div>
        </div>
    `;
}

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
                <div class="prompt-main">
                    <div class="prompt-title">${p.title || promptPageLabel(page)}
                        ${p.is_active ? '<span class="badge badge-success">active</span>' : ''}
                    </div>
                    <div class="prompt-meta">${promptPageLabel(page)} · ${p.variant_name} · ${new Date(p.updated_at).toLocaleString('vi-VN')}</div>
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
                <div class="prompt-group-header"><span>${promptPageLabel(page)}</span><small>${page}</small></div>
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
    const promptTitle = document.getElementById('promptTitle');
    if (promptTitle) promptTitle.value = item.title || promptPageLabel(item.page_type);
    document.getElementById('promptVariant').value = item.variant_name;
    document.getElementById('promptText').value = item.prompt_text;
    document.getElementById('promptSetActive').checked = item.is_active;
}

async function activatePrompt(id) {
    await fetch(`/api/research/prompts/${id}/activate`, { method: 'POST' });
    loadPrompts();
}

async function deletePrompt(id) {
    const ok = await showConfirm({
        title: 'Xóa prompt',
        message: 'Bạn có chắc chắn muốn xóa prompt này không?',
        confirmText: 'Xóa prompt',
        cancelText: 'Hủy'
    });
    if (!ok) return;
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
            title: document.getElementById('promptTitle')?.value.trim() || '',
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
        if (!res.ok) return showAlert(json.error || 'Lỗi lưu prompt', 'error');

        promptEditingId = null;
        promptForm.reset();
        document.getElementById('promptSetActive').checked = false;
        loadPrompts();
        showAlert('Đã lưu prompt thành công.', 'success');
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
            if (!res.ok) return showAlert(json.error || 'Lỗi reset cooldown', 'error');
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
        categories: ['all'],
        window: 'last_7_days',
        limit: 15,
        mode: 'overview',
        sortBy: 'trend_score',
        loading: false,
        data: [],
        pagination: { page: 1, limit: 15, total: 0, has_more: false },
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
        catCheckboxes.forEach(cb => cb.addEventListener('change', (e) => {
            if (e.target.value === 'all' && e.target.checked) {
                catCheckboxes.forEach(other => { if (other !== e.target) other.checked = false; });
            } else if (e.target.checked) {
                const allBox = document.querySelector('#v4CategoryFilters input[value="all"]');
                if (allBox) allBox.checked = false;
            }
            this.applyFilters();
        }));
        const refreshBtn = document.getElementById('v4RefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.load(true));
    },

    applyFilters() {
        const limit = parseInt(document.getElementById('v4LimitFilter')?.value || '15', 10);
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
            categories = ['all'];
        }

        Object.assign(this.state, { limit, window, sortBy, market, categories });
        this.load();
    },

    async load(forceRefresh = false) {
        if (this.state.loading) return;
        this.state.loading = true;
        await ensureDailyUsageLoaded();
        this.setLoadingState(true);

        try {
            const cats = this.state.categories.join(',');
            const selectedDate = getSelectedResearchDate();
            const today = dayKey(new Date());
            const canForceRefresh = forceRefresh && (!selectedDate || selectedDate === today);
            if (forceRefresh && selectedDate && selectedDate !== today) {
                showAlert('Không refresh AI cho ngày quá khứ; đang đọc dữ liệu DB theo ngày đã chọn.', 'warning');
            }
            const dateParam = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : '';
            const url = `/api/product-trends?market=${this.state.market}&categories=${encodeURIComponent(cats)}&limit=${this.state.limit}&window=${this.state.window}&mode=${this.state.mode}&forceFresh=${canForceRefresh ? 'true' : 'false'}${dateParam}`;
            const res = await fetch(url);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Lỗi tải dữ liệu xu hướng');
            
            this.state.data = json.data || [];
            this.state.pagination = json.meta?.pagination || {};
            this.state.is_stale = json.meta?.is_stale || false;
            this.state.meta = json.meta || null;
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

    windowLabel(sourceWindow = this.state.window) {
        return {
            today: 'Hôm nay',
            last_3_days: '3 ngày qua',
            last_7_days: '7 ngày qua'
        }[sourceWindow] || sourceWindow;
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
        const statsEl = document.getElementById('v4TrendStats');
        if (!grid) return;

        const { data, pagination, is_stale, sortBy } = this.state;
        
        if (metaEl) {
            metaEl.innerHTML = `<span>Hiển thị <b>${data.length}</b> sản phẩm · ${metaDateLabel(this.state.meta)} · Khung: <b>${this.windowLabel()}</b></span> ${this.staleIndicator(is_stale)}`;
        }

        if (statsEl) {
            const avg = key => data.length ? Math.round(data.reduce((sum, item) => sum + Number(item[key] || 0), 0) / data.length) : 0;
            const exploding = data.filter(item => item.growth_signal === 'exploding').length;
            const lowCompetition = data.filter(item => item.competition_level === 'low').length;
            statsEl.innerHTML = `
                <div class="v4-stat-card"><span>Khung lọc</span><b>${this.windowLabel()}</b></div>
                <div class="v4-stat-card"><span>Sản phẩm</span><b>${data.length}</b></div>
                <div class="v4-stat-card"><span>Trend TB</span><b>${avg('trend_score')}</b></div>
                <div class="v4-stat-card"><span>Tin cậy TB</span><b>${avg('confidence_score')}</b></div>
                <div class="v4-stat-card"><span>Bùng nổ</span><b>${exploding}</b></div>
                <div class="v4-stat-card"><span>Cạnh tranh thấp</span><b>${lowCompetition}</b></div>
            `;
        }

        if (!data.length) {
            grid.innerHTML = emptyMetaHtml('Chưa có dữ liệu Trends V4 (No Trends V4 data)', this.state.meta, 'Nhấn Refresh AI để quét thị trường cho ngày/window này.');
            return;
        }

        const sorted = [...data].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

        grid.innerHTML = sorted.map(item => `
            <div class="v4-card" data-product-id="${item.id}">
                <div class="v4-card-header">
                    <div class="v4-card-title-group">
                        <h3 class="v4-card-name">${item.product_name || 'N/A'}</h3>
                    <span class="v4-card-cat">${item.category || ''}${item.sub_category ? ' › ' + item.sub_category : ''} · ${this.windowLabel(item.source_window)}</span>
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
                <p class="v4-card-summary">${shortText(item.summary || item.evidence_summary || '', 150)}</p>
                ${sourceMeta(item)}
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

window.TrendV4 = TrendV4;

// Init V4 when the trend tab is selected
window.initTrendV4 = function() {
    if (!TrendV4._initialized) {
        TrendV4._initialized = true;
        TrendV4.init();
    }
};
