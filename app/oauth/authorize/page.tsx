import { requireChatGPTUser } from "../../chatgpt-auth";
import { authorizeIdentity } from "../../../lib/server/owner-auth";
import { authorizationRequest } from "../../../lib/server/oauth";
import { runtime } from "../../../lib/server/env";
export const dynamic = "force-dynamic";
export default async function Authorize({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  return <ConsentPage params={raw} />;
}
async function ConsentPage({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (typeof v === "string") query.set(k, v);
  const user = await requireChatGPTUser("/oauth/authorize?" + query);
  try {
    const owner = await authorizeIdentity(runtime(), user);
    const request = await authorizationRequest(
      runtime(),
      owner,
      Object.fromEntries(query),
    );
    return (
      <main className="auth-page">
        <a className="wordmark" href="/">
          Xanadu<span>Sidebranch</span>
        </a>
        <div className="auth-panel">
          <p className="eyebrow">连接文档空间</p>
          <h1>
            允许 {request.clientName}
            <br />
            访问你的文档？
          </h1>
          <p>
            连接后，可以阅读和搜索全部文档，创建或修改文档、提问与连接。只有你的账号能够授权。
          </p>
          <p className="auth-account">{user.email}</p>
          <form action="/oauth/consent" method="post">
            <input type="hidden" name="request_id" value={request.id} />
            <button type="submit" name="decision" value="allow">
              允许连接
            </button>
            <button
              className="quiet"
              type="submit"
              name="decision"
              value="deny"
            >
              取消
            </button>
          </form>
        </div>
      </main>
    );
  } catch (error) {
    return (
      <main className="auth-page">
        <h1>无法授权</h1>
        <p>{error instanceof Error ? error.message : "请重新发起连接。"}</p>
        <a href="/">返回介绍页</a>
      </main>
    );
  }
}
