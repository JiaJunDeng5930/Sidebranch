# v3 整合设计与实现交接

四份专项设计见本目录。本文记录现有 v3 实现的整合契约，不再保留 v2 的窗口列表、close-view、open-new-view、read/overview、目录侧栏。此次只做本地实现、打磨和 GitHub 提交，不发布。

> 2026-09-19：用户指出颜色带等原设计细节被过度简化。涉及 Xanadu 视觉与阅读导航的后续修正，先依据 [原设计研究与项目差距](../research/xanadu/README.md)重新设计；本文不能据以宣称设计已经完成或实现已经符合原型。

## 唯一的阅读语义

空间成员来自活动与归档文档元数据，不来自正文是否挂载。持久 Document/Revision/Anchor/Connection/Question/AnswerAssociation 不变。

- hover/focus 只轻揭标题、版本、真实已知摘录；不加载整篇，不改变阅读位置，不记历史。
- stack 激活才扇开，hover 不扇开。fan 在原边缘展开，桌面最多 7 叶、窄屏 3 叶，翻动可遍历全部成员。fan 打开期间冻结成员次序，新增文档不把指针下面的对象换掉。
- 激活叶片或连接是显式旁读。原 current 保持，target 的确切 revision 成为 companion，写一次历史。无连接文档也能旁读，便于在两篇文字间创建新连接；没有 Connection 时不画 beam。
- companion 的正文只用于阅读、滚动、选字；其标题身份区域上明确的“继续读这篇”才 promote。promote 后旧 current 收成固定返回叶；Back 恢复完整的先前 current/companion/版本/段落/滚动。收起旁读不建立 tombstone，不改写历史。
- 搜索、AI 显式定位和空空间首次创建可以根导航；普通创建/批量导入成功只提示，不抢 current。
- 只有 explicit answerFor 的 host 返回才是答案抵达，并由服务端核验 question 的 answers 包含目标文档。普通 open_document 保留 AI 显式设为当前。答案抵达不导航；用户正选字、IME 输入、编辑或写问题时，普通 host 定位也暂存为可接受的提示，不丢草稿。

## 空间布局与视觉

深色纸场、真实可选正文、折边与遮挡表达深度。current 正面可读；companion 同样使用正常字号，最多同时两个正文。旧 current 的返回叶不进入普通排序或 overflow。已证明一跳放近侧纸边，二跳退后，其余文档始终在边缘叠页；未知不能叫无关。历史关系叶显示其真实 vN，并可明确选择该 Document 的当前版本。

桌面纸场铺满阅读区，无管理侧栏。单页有足够横向空白让边缘扇页进入；并读时优先保护 current 的主阅读列，扇页可在外围遮挡旁文的非焦点部分，但不能覆盖当前正在选择的文字。fan 是共根、浅弧、错位和倾斜的短纸叶，禁止等宽等距的纵向菜单。窄屏把 current、companion 和可翻动折页纸场顺序排列，保留全部身份与操作语义。

常驻外壳只保留品牌、阅读后退/前进、搜索和一个空间命令入口。新建、导入、归档、连接设置及帮助按意图出现。正文菜单也按需出现；不把每个功能做成常驻按钮。

颜色以 visual-motion.md 为准，常用控件最小 14px，元数据最小 12px。关系在纸面/暗舞台使用成对颜色；原生选择为蓝色，导航落点为中性金色，问题状态不借 question 关系色。没有 source identity 就没有 transclusion 视觉。

## 数据边界

沿用 ls，分别读取 active/archived 全部元数据，分别保存 complete。complete 前只报“已载入”，不能把数量当总数。客户端 fan 冻结成员 ID 窗口，不新增服务端 manifest snapshot 或持久 XYZ。

新增只读命令 `neighborhood({revisionId, cursor?, limit?})`，默认 100、最大 200。返回仅含两跳内的版本身份与证明，不含正文或 quote：

```ts
interface NeighborhoodNode {
  document: DocumentSummary; // 文档最新 metadata
  revisionId: RevisionId; // 图上的真实版本，可为历史版
  sequence: number;
  distance: 1 | 2;
  viaRevisionId: RevisionId | null; // distance 1 为 null；2 必须非空
  connectionId: ConnectionId; // 抵达该节点的真实边
}
interface NeighborhoodResult {
  centerRevisionId: RevisionId;
  nodes: NeighborhoodNode[];
  nextCursor: string | null;
}
```

实际静态类型与 Zod 使用 distance 判别联合表达 viaRevisionId 的约束。在 RevisionId 图上遍历，不能跨同 Document 的版本跳跃。cursor 绑定中心 revision。每页查询数固定，不逐文档发请求；归档节点也保留，Connection 仍是唯一精确端点真相。客户端用 centerRevisionId+generation 丢弃迟到的重排。partial 只能证明已返回节点近，不能证明未返回节点远。

`open_document` 新增可选 `answerFor: QuestionId`。有此参数时核验 Question.answers 包含结果文档，否则明确失败；ready 结果增加可选 `arrival: {question: Question}`。默认结果形状兼容现有客户端。MCP 描述明确 answerFor 是提示抵达，默认是设置当前。QA host answer 使用此参数。无需新增写能力或改变 OAuth。

## 共享代码契约（以这些导出为准）

### lib/reader/attention.ts

以下对象属于单个阅读会话。history 只含轻量位置，不保存正文、DOM 或逐帧姿态；revision cache 独立且有界。

```ts
interface ReadingPosition {
  documentId: DocumentId;
  revisionId: RevisionId;
  focus: AnchorInput | null;
  scrollTop: number;
}
type SurfaceRole = "current" | "companion";
interface CameraPose {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  zoom: number;
}
type ComparisonReason =
  | { kind: "connection"; connectionId: ConnectionId }
  | { kind: "document" }
  | { kind: "revision" }
  | { kind: "answer"; questionId: QuestionId };
type Attention =
  | { kind: "empty" }
  | {
      kind: "reading";
      current: ReadingPosition;
      companion: { position: ReadingPosition; reason: ComparisonReason } | null;
    };
interface AttentionSnapshot {
  attention: Attention;
  camera: CameraPose;
}
interface AttentionState extends AttentionSnapshot {
  history: readonly AttentionSnapshot[];
  historyIndex: number;
}
type AttentionAction =
  | { type: "navigate"; position: ReadingPosition }
  | { type: "compare"; position: ReadingPosition; reason: ComparisonReason }
  | { type: "promote" }
  | { type: "return-to-current" }
  | { type: "history"; index: number }
  | { type: "scroll"; role: SurfaceRole; scrollTop: number }
  | { type: "focus"; role: SurfaceRole; focus: AnchorInput | null }
  | { type: "replace-revision"; role: SurfaceRole; position: ReadingPosition }
  | { type: "camera"; pose: CameraPose };
```

导出 `DEFAULT_CAMERA`、`emptyAttention()`、`attentionReducer(state,action)`、`readingPosition(document,focus?,scrollTop?)`、`returnHistoryIndex(state):number|null`。history 保存当前条目并有 index；显式 navigate/compare/promote 追加，scroll/focus/camera 更新当前条目，history 恢复而不追加；return-to-current 是可回退的注意力变化。promote 后 companion 为 null，旧 current 由返回叶表达。returnHistoryIndex 找最近一个不同 current 文档或版本的历史条目。不要给折页创建 ViewId。

`lib/domain/space.ts` 导出 NeighborhoodNode / NeighborhoodResult 及其 Zod schema。`lib/reader/space-index.ts` 导出：

```ts
type NeighborhoodKnowledge =
  | { kind: "idle" }
  | {
      kind: "loading";
      centerRevisionId: RevisionId;
      nodes: readonly NeighborhoodNode[];
    }
  | {
      kind: "partial";
      centerRevisionId: RevisionId;
      nodes: readonly NeighborhoodNode[];
      nextCursor: string;
    }
  | {
      kind: "complete";
      centerRevisionId: RevisionId;
      nodes: readonly NeighborhoodNode[];
    }
  | {
      kind: "failed";
      centerRevisionId: RevisionId;
      nodes: readonly NeighborhoodNode[];
      message: string;
    };
interface DocumentTarget {
  documentId: DocumentId;
  revisionId: RevisionId;
  focus: AnchorInput | null;
}
interface EdgeLeaf {
  document: DocumentSummary;
  target: DocumentTarget;
  sequence: number;
  band: "direct" | "second" | "other" | "archive";
  connectionId: ConnectionId | null;
  alternatives: readonly { revisionId: RevisionId; sequence: number }[];
}
```

`projectSpaceEdges(documents, knowledge, excludedPositions): readonly EdgeLeaf[]`，其中 excludedPositions 为 readonly ReadingPosition[]。每个 Document 最多一个主叶，历史/当前版本是该叶的 alternatives。按已证明最短距离选关系版，若距离未知保留 other；archive 只对不在 direct/second 的归档文档使用。不要把不同版本视为一跳。元数据按稳定 title/path/id 顺序，关系叶优先 current 可见 Connection；最终布局不用存进领域对象。

### components/reader/spatial-scene.tsx

组件负责纸面投影、edge/fan/hover、输入和逐帧 camera/beam。Reader 负责取数、持久命令、历史与草稿。接口固定：

```ts
interface ReadingSurface {
  position: ReadingPosition;
  document: DocumentRevision;
}
interface ReturnLeaf {
  position: ReadingPosition;
  document: DocumentSummary;
  historyIndex: number;
}
interface PendingSurface {
  target: DocumentTarget;
  title: string;
  error: string | null;
}
interface SpatialSceneController {
  resetCamera(): void;
  measure(): void;
}
interface SpatialSceneProps {
  current: ReadingSurface | null;
  companion: ReadingSurface | null;
  previous: ReturnLeaf | null;
  camera: CameraPose;
  documents: readonly DocumentSummary[];
  catalogue: {
    activeComplete: boolean;
    archivedComplete: boolean;
    loading: boolean;
  };
  neighborhood: NeighborhoodKnowledge;
  connections: readonly Connection[];
  selectedConnectionId: ConnectionId | null;
  pending: PendingSurface | null;
  onReadBeside: (target: DocumentTarget) => void;
  onPromote: () => void;
  onReturnToCurrent: () => void;
  onFollow: (id: ConnectionId) => void;
  onHistory: (index: number) => void;
  onScroll: (role: SurfaceRole, scrollTop: number) => void;
  onCameraCheckpoint: (pose: CameraPose) => void;
  renderDocument: (
    surface: ReadingSurface,
    role: SurfaceRole,
  ) => React.ReactNode;
  controllerRef?: React.Ref<SpatialSceneController>;
}
```

组件不会直接 invoke 或保存业务草稿。边缘近邻若有已取得的精确 Connection，激活走 onFollow，否则走 onReadBeside；hover 只消费元数据/已知 quote。version alternative 用 target revision 显式旁读。pending 显示局部标题/重试，不替换 current。ReadyReadingSurface 由已有 cache 按 position 解析。props 回调必须稳定，正文 memo 不订阅逐帧输入。

全局流转有单一拥有者：AttentionState 拥有阅读位置、比较关系和历史。ReaderSession 只保留数据、缓存、任务/草稿和暂态 UI，删除旧 active.current/companion/mode 等镜像。旧 `scene.ts` 删除，旧 ViewId 与 open/close reducer 测试被新语义测试替换。

## 手势、动态与性能合并决策

普通正文输入全归浏览器；场景空白拖动 pan，Shift+空白拖动 orbit，Space 先按下后拖动为显式 pan。Shift+wheel 在所有设备上一致为水平 pan，不猜设备。只有空场景的 Ctrl/pinch wheel 缩放相机，正文保留页面缩放。正文 overscroll 不传到场景。移动端原生正文滚动/长按和场景单/双指有明确 hitRole。

camera 逐帧只更新呈现矩阵/transform；手势结束低频 checkpoint 才进 AttentionState。正文 scroll 也不能复制正文或刷新整个 Reader。选定端点由 sourceRanges 精确定位；同坐标系 camera-only 不重新读 Range/DOM，内容 scroll/resize/chunk 改变才使几何失效。若端点不在虚拟窗口，用明确方向端点而非纸中心冒充。纯 link 用单线，不画厚带冒充 transclusion。

动画从当前呈现 pose 接手，不能先跳旧终点；同一 transform 只有一个 writer。hover 160ms，fan 220ms，attention 约400ms，可中断。文字 pointerdown 冻结手下纸面，选区非折叠期间不弹 hover。减少动态直接到终态。禁止 idle RAF、循环漂浮、大滤镜、为所有文档分配 GPU 层。

暖态60Hz目标：p95 frame interval≤20ms、p99≤33ms，5秒直接操作没有>50ms Long Task；输入单RAF write与双RAF proxy分开报告。预览环境若只能测到33ms不能称已达60fps。优先保全正文和选定连接，再减少非选定连接与外围效果。冷解析单独报告。

## 分工与交接

所有实现者只在独立 scratch staging 中修改指定文件，不改 Site checkout、不用 Sites 工具、不部署、不提交；根代理整合。

1. **attention/index 核心**：`lib/reader/attention.ts`、`lib/reader/space-index.ts`、`tests/attention.test.ts`。实现上文 reducer/projection，纯类型与必要的不变量/历史测试；不改 UI/后端。
2. **只读数据与抵达协议**：`lib/domain/space.ts`、`lib/domain/model.ts`、`commands.ts`、`protocol.ts`、`lib/server/document-store.ts`、`mcp-server.ts`，对应 service/integration 测试与 `tests/ui-host-answer.ts`。保留全部 auth 行为，不改数据库实体或加无必要 migration。
3. **空间与手势**：`components/reader/spatial-scene.tsx/css`，可增 `lib/reader/camera.ts` / `components/reader/space-*.tsx` / `space-*.css`。依本文接口实现纸场、折页fan、返回叶、camera、精确连接。纯几何/输入必要测试可放独立文件；不碰 Reader/session。
4. **阅读流程**：`components/reader/reader.tsx/css`、`workspace-controls.tsx`、`lib/reader/session.ts`、`tests/reader-session.test.ts`。按四意图重组流程、移除侧栏/overview、集成新接口，保留上传/问答/编辑/检索/历史能力。拆有明确概念职责的文件可以，禁止把所有事情仍塞进一个 Reader。不改 renderer、空间、协议。

根代理负责统一 tokens、正文 renderer 的交互衔接、QA 样机/实际浏览、整合与提交。没有设计者在同一阶段兼任自己方案的代码作者。实现者遇到接口矛盾及时返回，不自行另造共享模型。

## 本地验证的具体判据

以真实含内容的纸场检验：A→B旁读→B提升→A返回；第100份等距文档可从fold翻到；无连接C与历史版B可达；选字/滚动不导航；连续中断A→B→C无迟到抢焦点；长标题可用键盘/触摸读全；网站和 App 共用 UI；答案通知不吞草稿；定位编辑仍校验旧版本；390px和减少动态保持语义。

类型保证完整的 attention 与 distance 判别、命令边界；测试只补分页真值、revision图、history/异步和原生选择等类型无法保证的风险。旧 open-new-view/close-view/overview 测试删除，不为兼容它们保留错误模型。
