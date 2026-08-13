const AI_KEYWORD_RE = /\b(ai|llm|agent|rag|automation|workflow|crawler|scraper|playwright|selenium|data|analytics|chatbot|copilot|vector|embedding)\b/i;

function stripTags(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.7,en;q=0.6'
      }
    });
    const text = await response.text();
    return { status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function crawlGoogleTrendsVN(limit = 10) {
  const { status, text } = await fetchText('https://trends.google.com/trending/rss?geo=VN');
  if (status !== 200) throw new Error(`Google Trends HTTP ${status}`);

  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]);
  return items.slice(0, limit).map(itemXml => {
    const keyword = stripTags(itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const traffic = stripTags(itemXml.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1] || '');
    const newsTitle = stripTags(itemXml.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/)?.[1] || '');
    const newsUrl = stripTags(itemXml.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/)?.[1] || '');
    return {
      name: keyword,
      source: 'google_trends_vn',
      signal: traffic || 'trending',
      evidence: newsTitle || 'Google Trends RSS item',
      url: newsUrl || 'https://trends.google.com/trending?geo=VN'
    };
  }).filter(item => item.name);
}

function parseGitHubTrending(html, since) {
  const articles = [...String(html || '').matchAll(/<article[\s\S]*?<\/article>/g)].map(match => match[0]);
  return articles.map(article => {
    const href = article.match(/<h2[\s\S]*?<a[^>]+href="([^"]+)"/i)?.[1];
    if (!href) return null;
    const repo = href.replace(/^\/+/, '').trim();
    const description = stripTags(article.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const language = stripTags(article.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const bodyText = stripTags(article);
    if (!AI_KEYWORD_RE.test(`${repo} ${description} ${bodyText}`)) return null;
    return {
      name: repo,
      source: `github_trending_${since}`,
      signal: language || 'repo momentum',
      evidence: description || 'GitHub trending repository',
      url: `https://github.com/${repo}`
    };
  }).filter(Boolean);
}

async function crawlGitHubTrendingAI(limit = 10) {
  const [daily, weekly] = await Promise.all([
    fetchText('https://github.com/trending?since=daily').catch(() => ({ text: '' })),
    fetchText('https://github.com/trending?since=weekly').catch(() => ({ text: '' }))
  ]);

  const seen = new Set();
  return [
    ...parseGitHubTrending(daily.text, 'daily'),
    ...parseGitHubTrending(weekly.text, 'weekly')
  ].filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, limit);
}

function analyze(items) {
  return items.map(item => {
    const text = `${item.name} ${item.signal} ${item.evidence}`;
    const isAutomation = /automation|crawler|scraper|playwright|selenium|workflow/i.test(text);
    const isAI = AI_KEYWORD_RE.test(text);
    const hasEvidenceUrl = /^https?:\/\//i.test(item.url || '');
    const score = 40 + (isAI ? 20 : 0) + (isAutomation ? 20 : 0) + (hasEvidenceUrl ? 10 : 0);
    return {
      ...item,
      category: isAutomation ? 'automation/crawling' : (isAI ? 'ai/data' : 'market trend'),
      opportunity_score: Math.min(score, 100),
      suggested_action: isAutomation
        ? 'Đọc repo/source, kiểm tra use case automation và thử prototype nhỏ.'
        : 'Kiểm tra thêm nguồn, volume tìm kiếm, sản phẩm liên quan và khả năng monetization.'
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score);
}

async function main() {
  console.log('[Demo] Crawl + analysis started...');
  const [googleTrends, githubAI] = await Promise.all([
    crawlGoogleTrendsVN(8).catch(err => {
      console.error('[Demo] Google Trends failed:', err.message);
      return [];
    }),
    crawlGitHubTrendingAI(8).catch(err => {
      console.error('[Demo] GitHub Trending failed:', err.message);
      return [];
    })
  ]);

  const rows = analyze([...googleTrends, ...githubAI]);
  console.log(JSON.stringify({
    crawled_at: new Date().toISOString(),
    source_counts: {
      google_trends_vn: googleTrends.length,
      github_trending_ai: githubAI.length
    },
    top_results: rows.slice(0, 10)
  }, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error('[Demo] Fatal:', err);
    process.exit(1);
  });
}

module.exports = {
  crawlGoogleTrendsVN,
  crawlGitHubTrendingAI,
  analyze
};
