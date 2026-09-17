import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import { authorizeIdentity } from "../../lib/server/owner-auth";
import { runtime } from "../../lib/server/env";
import { Workspace } from "../../components/reader/workspace";
export const dynamic = "force-dynamic";
export default async function Space() {
  const user = await requireChatGPTUser("/space");
  try {
    await authorizeIdentity(runtime(), user);
  } catch {
    return (
      <main className="auth-page">
        <h1>这是一个私人文档空间。</h1>
        <p>当前登录账号没有访问权限。</p>
        <a href={chatGPTSignOutPath("/")} target="_top">
          退出登录
        </a>
      </main>
    );
  }
  return <Workspace />;
}
