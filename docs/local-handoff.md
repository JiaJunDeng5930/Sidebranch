# 本地接续：2026-09-19

本轮没有部署。用户决定将当前进度带回本地继续；以 Git 提交区分已整合的纸场与随后保存的阅读生命周期修复。

## 本地启动

需要 Node 22.13+ 和 package.json 指定的 pnpm 11.25.0。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build:app
pnpm build:qa
pnpm build:qa space
pnpm build:qa renderer
pnpm dev
```

普通本地环境默认端口 5173。打开 `/__qa` 使用真实 Reader、临时 D1/R2 和官方 AppBridge 测试宿主；`/__space` 是 120 文档/101 近邻的交互样机；`/__renderer` 用于长文滚动与精确选区。QA 数据是合成的，服务停止后不作为生产数据保留。真实 ChatGPT 登录、MCP OAuth 和生产数据不由这些样机模拟证明。

改动 Reader 后先重建 `build:app`，再重建 `build:qa`，最后刷新浏览器。QA HTML 嵌入构建后的代码，单纯刷新不会包含尚未重新构建的改动。空间和正文样机分别重建其对应命令。

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

不要复制云环境的 `.sites-runtime`、`.wrangler`、`node_modules` 或运行时 secrets。普通本地环境自动选择 portable profile；登录与生产部署配置见 README。

## 已整合

- 侧栏、文件开关与总览模型被移除。文档持久存在；当前文档、旁读、历史和正文缓存分别表达。
- 全文档边缘折页；按实际 revision 连接计算一跳/两跳；元数据分页与正文加载分开。101 个近邻可翻到最后，长标题可轻揭。
- 修正桌面返回叶的 3D 命中、旁读后连接几何不更新、短容器裁切、重复标题/按钮、窄屏搜索名称及键盘 Space/Escape 仲裁。
- 长文分块、精确源码映射、连续选区保护、重叠连接高亮合并；逐帧相机更新不进入 React，也不重读 Range。
- 回答与文档独立；经服务端核验的 answerFor 只通知抵达，不自动切换当前文档。

## 尚需收尾

阅读生命周期修复在后续 WIP 提交中保存，不能视为已通过完整验收。重点逐项复核：已完成选择的保护；编辑/连接保存迟到响应；现有标题不可假保存；A→C→A 的过期旁读；宿主与本地导航竞态；同问题多个答案通知；问题草稿关闭/放弃；编辑后滚动保持；延期导航失败后重试。原始审查指出的这些问题位于 Reader/session；修复使用更细的草稿判别联合与导航请求身份。

性能门槛没有通过。长文滚动样本 0 个 >50ms 长任务、frame p95 约33ms；相机仍约50ms。冻结画面对照约33ms。最新长帧记录大部分时间在渲染提交/呈现等待，不能因此宣布软件达标。请在本机重新测量，具体数据与可重复 QA 入口见 performance-baseline.md。真实触摸设备和实际 ChatGPT 账号端到端认证尚未验证。

权威交互设计见 `space-redesign/implementation.md`，其余专项设计解释取舍；最终要求见 `rebuild-acceptance.md`。不要恢复文档列表、打开/关闭成员或 overview 来绕过纸场问题。
