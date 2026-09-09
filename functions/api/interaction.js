export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const db = env.DB; // 对应 Cloudflare D1 绑定的变量名

    if (!db) {
        return new Response(JSON.stringify({ error: "Database not bound" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }

    const slug = url.searchParams.get("slug");
    if (!slug) {
        return new Response(JSON.stringify({ error: "Slug required" }), { status: 400 });
    }

    // 1. GET 请求：阅读量自增 + 获取统计与已发布评论
    if (request.method === "GET") {
        await db.prepare("INSERT INTO article_stats (slug, views, likes) VALUES (?1, 1, 0) ON CONFLICT(slug) DO UPDATE SET views = views + 1").bind(slug).run();

        const stats = await db.prepare("SELECT views, likes FROM article_stats WHERE slug = ?1").bind(slug).first() || { views: 1, likes: 0 };
        const { results: comments } = await db.prepare("SELECT nickname, content, created_at FROM comments WHERE slug = ?1 AND status = 'approved' ORDER BY id DESC").bind(slug).all();

        return new Response(JSON.stringify({ stats, comments }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    // 2. POST 请求：点赞或发布评论
    if (request.method === "POST") {
        try {
            const data = await request.json();
            
            // 点赞
            if (data.action === "like") {
                await db.prepare("INSERT INTO article_stats (slug, views, likes) VALUES (?1, 0, 1) ON CONFLICT(slug) DO UPDATE SET likes = likes + 1").bind(slug).run();
                const stats = await db.prepare("SELECT likes FROM article_stats WHERE slug = ?1").bind(slug).first();
                return new Response(JSON.stringify({ success: true, likes: stats.likes }), {
                    headers: { "Content-Type": "application/json" }
                });
            }

            // 评论
            if (data.action === "comment") {
                const nickname = (data.nickname || "匿名读者").trim().slice(0, 30);
                const content = (data.content || "").trim().slice(0, 500);
                if (!content) {
                    return new Response(JSON.stringify({ error: "内容不能为空" }), { status: 400 });
                }
                await db.prepare("INSERT INTO comments (slug, nickname, content) VALUES (?1, ?2, ?3)").bind(slug, nickname, content).run();
                return new Response(JSON.stringify({ success: true }), {
                    headers: { "Content-Type": "application/json" }
                });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    return new Response("Method not allowed", { status: 405 });
}
