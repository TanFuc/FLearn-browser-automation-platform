const db = require('./src/db');

async function seed() {
    console.log('🌱 Seeding dummy research data for AI Research tab...');

    // 1. MMO Results (Page 1)
    const mmoData = [
        {
            topic: 'Skincare',
            page_type: 'mmo',
            title: 'Niche Skincare Affiliate on TikTok',
            category: 'Beauty',
            trend_score: 85,
            monetization_score: 90,
            competition_score: 60,
            data: {
                content_angle: "Reviewing Korean skincare for sensitive skin",
                traffic_source: "TikTok Organic + Shopee Video",
                monetization_model: "Shopee/Lazada Affiliate",
                summary: "Huge demand for K-beauty in VN market. Focus on short-form video reviews."
            }
        },
        {
            topic: 'Home Appliances',
            page_type: 'mmo',
            title: 'Smart Home Gadgets for Small Apartments',
            category: 'Home',
            trend_score: 75,
            monetization_score: 80,
            competition_score: 40,
            data: {
                content_angle: "Space-saving hacks with smart gadgets",
                traffic_source: "Facebook Reels + Pinterest",
                monetization_model: "Amazon/Shopee Affiliate",
                summary: "Rising urban population needs space-saving solutions. Smart air purifiers and compact vacuums are trending."
            }
        },
        {
            topic: 'Fitness',
            page_type: 'mmo',
            title: 'At-home Pilates Equipment Affiliate',
            category: 'Health & Fitness',
            trend_score: 92,
            monetization_score: 85,
            competition_score: 70,
            data: {
                content_angle: "Pilates for busy professionals - no gym needed",
                traffic_source: "Instagram Reels + Facebook Groups",
                monetization_model: "TikTok Shop + Affiliate",
                summary: "Pilates is exploding in popularity among Gen Z and Millennials. Focus on aesthetic equipment reviews."
            }
        }
    ];

    // 2. AI Tools (Page 2)
    const aiTools = [
        {
            topic: 'AI',
            page_type: 'ai_tools',
            title: 'Midjourney v7',
            category: 'Image Generation',
            data: {
                tool_name: "Midjourney v7",
                tool_type: "image",
                use_case: "High-end commercial photography and art",
                best_value_reason: "Best-in-class realism and artistic control",
                discount_or_launch_status: "new_launch",
                market_signal: "Consolidating market lead in high-end gen-art",
                price_level: "paid",
                summary: "The latest version of the top image generator, now with better text rendering and consistency.",
                is_best_value: false,
                is_new_noteworthy: true
            }
        },
        {
            topic: 'AI',
            page_type: 'ai_tools',
            title: 'Claude 3.5 Sonnet',
            category: 'LLM',
            data: {
                tool_name: "Claude 3.5 Sonnet",
                tool_type: "writing",
                use_case: "Coding and nuanced creative writing",
                best_value_reason: "Faster and smarter than GPT-4o for many tasks",
                discount_or_launch_status: "established",
                market_signal: "Pressure on OpenAI to release GPT-5",
                price_level: "freemium",
                summary: "Anthropic's latest model that excels at human-like reasoning and coding assistance.",
                is_best_value: true,
                is_new_noteworthy: true
            }
        },
        {
            topic: 'AI',
            page_type: 'ai_tools',
            title: 'Luma Dream Machine',
            category: 'Video Generation',
            data: {
                tool_name: "Luma Dream Machine",
                tool_type: "video",
                use_case: "Realistic video creation from text/images",
                best_value_reason: "High consistency and free trial available",
                discount_or_launch_status: "new_launch",
                market_signal: "Rapidly closing the gap with OpenAI's Sora",
                price_level: "freemium",
                summary: "A highly capable video generator that creates cinematic 5-second clips with high physical accuracy.",
                is_best_value: true,
                is_new_noteworthy: true
            }
        }
    ];

    // 3. Suggestions (Page 3)
    const suggestions = [
        {
            recommendation_title: "Start a 'Daily AI Tool' Short Video Series",
            recommendation_text: "Create 60-second reviews of obscure but powerful AI tools for specific office tasks.",
            confidence_score: 90,
            urgency_score: 85,
            roi_score: 95,
            reasoning_summary: "Short form video is the fastest way to build authority in the AI space right now.",
            next_action: "Pick 5 tools from the AI Tools tab and script 5 videos.",
            topic: "AI Content"
        },
        {
            recommendation_title: "Focus on Eco-friendly Home Appliances",
            recommendation_text: "Build a niche affiliate site focusing solely on energy-efficient and sustainable home tech.",
            confidence_score: 70,
            urgency_score: 60,
            roi_score: 80,
            reasoning_summary: "Consumer trend moving towards sustainability and lower electricity bills.",
            next_action: "Find high-ticket eco-friendly appliances on Shopee Mall.",
            topic: "Affiliate"
        },
        {
            recommendation_title: "Automate Facebook Group Engagement with AI",
            recommendation_text: "Use LLMs to summarize trending posts and generate helpful comments to build authority.",
            confidence_score: 88,
            urgency_score: 90,
            roi_score: 85,
            reasoning_summary: "Manual engagement is slow. AI can help you stay top-of-mind in multiple groups.",
            next_action: "Connect this bot's logs to a GPT-4o analysis script.",
            topic: "Automation"
        }
    ];

    try {
        // Clear old data to avoid duplicates
        await db.query('DELETE FROM research_results');
        await db.query('DELETE FROM ai_suggestions');

    // Insert MMO/AI Tools
    for (const item of mmoData) {
        // Merge top-level fields into the data object for the frontend
        const fullData = { 
            ...item.data, 
            title: item.title, 
            category: item.category,
            trend_score: item.trend_score,
            monetization_score: item.monetization_score,
            competition_score: item.competition_score
        };
        await db.query(
            `INSERT INTO research_results (topic, page_type, title, category, trend_score, monetization_score, competition_score, data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [item.topic, item.page_type, item.title, item.category, item.trend_score, item.monetization_score, item.competition_score, JSON.stringify(fullData)]
        );
    }

    for (const item of aiTools) {
        const fullData = {
            ...item.data,
            title: item.title,
            category: item.category
        };
        await db.query(
            `INSERT INTO research_results (topic, page_type, title, category, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [item.topic, item.page_type, item.title, item.category, JSON.stringify(fullData)]
        );
    }

        // Insert Suggestions
        for (const item of suggestions) {
            await db.query(
                `INSERT INTO ai_suggestions (recommendation_title, recommendation_text, confidence_score, urgency_score, roi_score, reasoning_summary, next_action, topic)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.recommendation_title, item.recommendation_text, item.confidence_score, item.urgency_score, item.roi_score, item.reasoning_summary, item.next_action, item.topic]
            );
        }

        console.log('✅ Dummy research data seeded successfully!');
    } catch (err) {
        console.error('❌ Error seeding data:', err.message);
    } finally {
        process.exit();
    }
}

seed();
