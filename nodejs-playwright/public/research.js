// Research Dashboard JS
let mmoData = [], aiData = [], suggestData = [];
let mmoSort = { col: 'trend', dir: -1 };

// ─── Page navigation ──────────────────────────────────────────────────────
function switchPage(page, el) {
    document.querySelectorAll('.page-tabs').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    if (el) el.classList.add('active');

    if (page === 'mmo' && mmoData.length === 0) loadMMO();
    if (page === 'ai' && aiData.length === 0) loadAI();
    if (page === 'suggest' && suggestData.length === 0) loadSuggestions();
    if (page === 'quota') loadQuota();
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
    document.getElementById('alertBanner').innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(() => { document.getElementById('alertBanner').innerHTML = ''; }, 6000);
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
        document.getElementById('alertBanner').innerHTML = `<div class="alert alert-error">🚫 Hard cap đã đạt! Mọi yêu cầu AI bị tạm dừng. Reset vào ngày mai hoặc bấm Reset Quota.</div>`;
    } else if (q.request_count >= q.soft_cap) {
        document.getElementById('alertBanner').innerHTML = `<div class="alert alert-warning">⚠️ Soft cap đạt! Chỉ còn ${q.hard_cap - q.request_count} requests. Hệ thống sẽ hạn chế calls không quan trọng.</div>`;
    }
}

// ─── Load MMO (Page 1) ────────────────────────────────────────────────────
async function loadMMO() {
    renderSkeleton('mmoTableBody', 6, 7);
    try {
        const res = await fetch('/api/research/page-1');
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        mmoData = json.data || [];
        document.getElementById('mmoUpdated').textContent = `${mmoData.length} cơ hội · Nguồn: ${json.meta?.source || 'DB'} · ${new Date().toLocaleString('vi-VN')}`;
        renderMMOTopCards();
        renderMMOTable();
        fillMMOFilters();
    } catch (e) { showAlert('Lỗi tải dữ liệu MMO: ' + e.message, 'error'); }
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
async function loadAI() {
    renderSkeleton('aiTableBody', 8, 7);
    try {
        const res = await fetch('/api/research/page-2');
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        aiData = json.data || [];
        document.getElementById('aiUpdated').textContent = `${aiData.length} công cụ · ${new Date().toLocaleString('vi-VN')}`;
        renderAITopCards();
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
async function loadSuggestions() {
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
    const sorted = [...suggestData].sort((a,b) => (b.roi_score||0) - (a.roi_score||0));
    document.getElementById('suggestList').innerHTML = sorted.map((d, i) => `
        <div class="suggest-card">
            <div class="suggest-rank">${i+1}</div>
            <div class="suggest-body">
                <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
                    ${badge(d.topic||'General','primary')}
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
        if (q.is_blocked) {
            document.getElementById('quotaAlertFull').innerHTML = `<div class="alert alert-error">🚫 Tài khoản đã đạt hard cap (${q.hard_cap}). Mọi AI request bị chặn cho đến ngày mai.</div>`;
        } else if (q.request_count >= q.soft_cap) {
            document.getElementById('quotaAlertFull').innerHTML = `<div class="alert alert-warning">⚠️ Đạt soft cap! Hệ thống đang bảo vệ quota. Còn ${q.hard_cap - q.request_count} requests.</div>`;
        } else {
            document.getElementById('quotaAlertFull').innerHTML = `<div class="alert alert-success">✅ Quota an toàn — ${q.request_count}/${q.hard_cap} requests đã dùng hôm nay.</div>`;
        }

        document.getElementById('usageGrid').innerHTML = [
            { label: 'Requests hôm nay', val: q.request_count, sub: `/ ${q.hard_cap} hard cap`, color: pct >= 80 ? 'var(--error)' : pct >= 60 ? 'var(--warning)' : 'var(--success)' },
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

        showAlert(`✅ Đã refresh! ${json.count} mục mới.`, 'success');
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
}

// ─── Init ─────────────────────────────────────────────────────────────────
loadMMO();
fetch('/api/research/usage').then(r=>r.json()).then(j=>updateQuotaBar(j.quota)).catch(()=>{});
