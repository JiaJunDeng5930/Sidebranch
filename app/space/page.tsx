import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import { authorizeIdentity } from "../../lib/server/owner-auth";
import { runtime } from "../../lib/server/env";
import { Workspace } from "../../components/reader/workspace";
import { DomainError } from "../../lib/domain/model";
export const dynamic = "force-dynamic";
export default async function Space() {
  const user = await requireChatGPTUser("/space");
  try {
    await authorizeIdentity(runtime(), user);
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === "AUTH_REQUIRED" || error.code === "OWNER_ONLY")
    )
      return (
        <main className="auth-page">
          <h1>这是一个私人文档空间。</h1>
          <p>当前登录账号没有访问权限。</p>
          <a href={chatGPTSignOutPath("/")} target="_top">
            退出登录
          </a>
        </main>
      );
    console.error("Space failed to load", error);
    return (
      <main className="auth-page">
        <h1>文档空间暂时无法打开。</h1>
        <p>服务暂时不可用，请稍后重试。</p>
        <a href="/space">重试</a>
      </main>
    );
  }
  return <Workspace />;
}
