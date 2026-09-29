// mushikingraph-cron
// GitHub Actions の定期実行(schedule)が数時間遅れる問題の対策として、
// Cloudflare Workers の Cron Triggers から毎日決まった時刻に
// 「Update subscriber counts」ワークフローを起動する(workflow_dispatch)。
//
// Cloudflare 側で必要な設定:
//   - シークレット GITHUB_TOKEN : このリポジトリの Actions を Read and write できる
//                                  fine-grained personal access token
//   - シークレット RUN_KEY      : (任意) 手動テスト用の合言葉。未設定なら手動テストは無効
//   - Cron Trigger              : 10 15 * * *   (UTC。= 毎日 0:10 JST)

const OWNER = "mnjiw";
const REPO = "mushikingraph";
const WORKFLOW_FILE = "update_subscribers.yml";
const BRANCH = "main";

async function dispatchWorkflow(env) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN が設定されていません");
  }
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "mushikingraph-cron", // GitHub API は User-Agent が無いと拒否する
    },
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API エラー ${res.status}: ${text}`);
  }
  console.log(`ワークフローを起動しました (HTTP ${res.status})`);
  return res.status;
}

export default {
  // Cron Trigger から毎日呼ばれる
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env));
  },

  // 手動テスト用: https://<このWorker>.workers.dev/run?key=<RUN_KEY>
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/run" || !env.RUN_KEY || url.searchParams.get("key") !== env.RUN_KEY) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const status = await dispatchWorkflow(env);
      return new Response(`OK: ワークフローを起動しました (HTTP ${status})\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (e) {
      return new Response(`失敗: ${e.message}\n`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
