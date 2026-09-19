# Xanadu Sidebranch 交互研究规格

> 2026-09-19：原始资料已按原型版本重新核实，当前研究入口为 [Xanadu 原设计研究与修正依据](research/xanadu/README.md)。本文件保留历史，不再用其概括代替具体图示、操作说明和源码证据。

> 历史研究与 v2 方案。2026-09-18 用户已明确否定文档目录、打开/关闭空间窗口和总览模式；这些实现建议不再是约束。原始资料摘述仍可参考，本轮设计入口是 `space-redesign/brief.md`，后续以整合后的连续文档空间契约为准。

范围：Project Xanadu / XanaduSpace 的原始交互、平行文档与空间视觉原则，以及它们在 Sidebranch 中可验收的产品操作模型。本文不审查服务端、D1/R2 或 OAuth。没有运行浏览器；现有实现的差距均标为静态代码证据。

## 1. 核心结论

Sidebranch 的核心应是可操作的平行文档空间，而不是双栏阅读器加一条装饰线：

- 一个精确的 DocumentRevision 作为 current slab 位于 line of fire 中央，正面、可读、可选取。
- 用户选择 passage 或 beam 后，另一端的 revision 作为 companion 沿 line of fire 进入 current 旁边；用户可以在 companion 上阅读、选取、继续跟随，或将它提升为 current。
- 其他相关文档以有标题和关系提示的外围 slab 保留在场景中，提供连接上下文，不抢走近景文字的可读性。
- beam 的两端必须绑定两个 passage 的实际渲染范围；滚动、相机变换、窗口尺寸变化后仍跟随文字，不能只连两个卡片中心。
- content link 与 transclusion 是两个概念。用户创建的关系是 link；只有系统掌握同一内容的 source identity 时才可显示 transclusion 的来源视觉。
- Document、Revision、Passage/Anchor、Connection、ReadingView、SlabInstance、BeamInstance、CameraState、FocusState、SelectionState 必须各有类型。current document 的切换是 ReadingContext 的角色变更或导航，不等于删除旧上下文、清空场景或替换全部阅读状态。
- 真正 3D 的验收标准是多文档、镜头导航、范围连接共同工作。仅把两个白色卡片并排、在中间画 SVG 线不算完成。移动端可使用明确的 2D 投影，但不能丢失 current/companion/beam 语义。

## 2. 原始资料确认的交互事实

### 2.1 Parallel pages, visibly connected

[Project Xanadu 首页](https://xanadu.com/) 明确提出 “PARALLEL PAGES, VISIBLY CONNECTED”。

[The Xanadu Universe](https://xanadu.com/xUniverse-D6) 说明 Xanadu 追求的是 parallel, interconnected documents；1972 年示意图展示窗口之间的可见精确连接，并称可见连接是写作的结构组成部分。它还列出 XanaduSpace 的具体对象和动作：页面是 3D space 中的 slabs；页面可按用户命令移动；高亮文字是独立 3D 对象 tetroids；tetroids 通过 beams 连接；页面、tetroids 和 beams 一起 swoop/morph。该 prototype 是 Windows only、内容不可修改、没有完成联网抓取；产品应借用交互语义，不复制其技术限制。

[Xanalogical Structure, Needed Now More than Ever](https://cs.brown.edu/memex/ACM_HypertextTestbed/papers/60.html) 是 Ted Nelson 署名的完整说明。页面第 30 至 50 行说明 side-by-side connected comparison 是 Xanadu 的基本可视化，窗口移动和滚动时连接必须仍附着在实际内容。

产品含义：两个文档共享一个空间和导航关系；窗口边框不是连接端点。

### 2.2 line of fire / reading plane

[Back to the Future](https://www.xanadu.net/XanaduSpace/btf.htm) 的 “A SYSTEM OF SIDE-BY-SIDE VIEWING” 给出完整操作：

1. reading plane / line of fire 把 current page 或 vunit 放到 3D 屏幕中央。
2. 用户在 current page 选择 link 或 transclusion。
3. 另一端的 vunit 摆到旁边，成为字号较小但仍可读的 companion page。
4. 用户可把 companion 设为 current。
5. 其他 page 留在场景中，显示更大的连接关系。
6. current 与至少一个 connected page 近距离可读，同时整个场景保留外围 pages 和连接。

同页第 102 至 111 行区分 links 和 transclusions 的不同视觉：light/dark lines 对应 link，heavy/red bands 对应 transclusion。产品可换颜色，但不能把关系都做成没有语义的线。

“摆动”是关系驱动的布局过渡，不要求第一人称穿越物理房间；近景正面文字优先于透视效果。

### 2.3 样例原型的真实操作

[Try Our Sample Xanadoc](https://xanadu.com/xuSampleXanadoc-D12.html) 记录了：

- fulfill EDL 后需要移动窗口，才能同时查看和滚动；
- 点击蓝色区域跟随 xanalink，把 linked page 移到右边后连接更清楚；
- 再点蓝色区域可关闭 bridge；
- 滚动 xanadoc 后点击橙色内容查看 live sources/transclusions；
- source window 在右侧打开，连接随 source 标记拖动；滚动 source window 直到对齐；
- 再次点击 field 关闭连接。

这证明 follow 是显式动作，不自动替换 current；关闭 bridge 只关闭这次阅读关系；连接端点必须随两个文本窗口滚动重新对齐。

### 2.4 Link 与 transclusion

Brown 页面第 65 至 73 行把 content link 定义为连接不同内容，把 transclusion 定义为“同一内容在多处且身份可知”的可见重用。第 147 至 153 行说明点击 transclusion 可定位原始版本并打开原始上下文。

[Understanding Xanalinks](https://xanadu.com/xanaLinks.html) 说明 xanalink 是外部、独立、可复用、可带 relation/property/structure 的连接表，不是 HTML 内嵌 link。Brown 页面第 93 至 117 行还说明 content link 可双向、可重叠，由独立实体连接两个 span。

Sidebranch 契约：

- reference、explanation、question、contrast、continuation 等用户关系都是 content link，使用普通 relation beam。
- 只有明确 source identity 的同一内容才有 transclusion beam、来源 marker 和“查看原文”。
- 相同字符串、相似句子、AI 复述不能自动成为 transclusion。
- 当前领域只有 Anchor + Connection 时，文案只能说 link/connection，不能声称“原文实时引用”。

### 2.5 版本和精确端点

Brown 页面第 121 至 140 行展示 link 在版本插入、删除后如何继续附着于仍存在的内容。Sidebranch 当前模型采用 immutable revision + revision-bound Anchor，交互上应明确：

- beam endpoint 标签显示文档标题和版本，例如 A · v3；
- 历史 slab 显示历史版本；
- 编辑不会将旧 beam 静默迁移到新 revision；用户显式选择查看历史端点或最新版；
- 如果未来做跨版本 surviving passage，必须展示旧/新对应关系，不能默默改端点。

## 3. 概念实体、程序实体和状态归属

| 领域概念     | 稳定程序实体                                                     | 渲染/会话实体                           | 所属                                      |
| ------------ | ---------------------------------------------------------------- | --------------------------------------- | ----------------------------------------- |
| 文档         | DocumentRecord：documentId、path、title、current revision        | 无，文档可多次实例化                    | 持久；不等于屏幕 slab                     |
| 文档版本     | DocumentRevision：revisionId、sequence、content、parent          | RevisionSlab / SlabInstance             | 持久版本；同一 revision 可出现在多个 view |
| Passage      | PassageRef 或 Anchor：revisionId、start、end、quote、documentId  | TetroidInstance / PassageHighlight      | 精确范围；不等于整个文档组件              |
| 连接         | ConnectionRecord：两端 Anchor、relation、label                   | BeamInstance：两端 slab 和实际 DOM rect | Connection 持久；Beam 是 view 内派生      |
| 同一内容来源 | TransclusionRecord 或 source identity                            | TransclusionBeamInstance / SourceMarker | 与 Connection 分开；没有来源身份不显示    |
| 阅读快照     | ReadingView：current revision、connections、questions、documents | SceneGraph / slab list                  | 数据投影；不拥有 camera                   |
| 当前阅读角色 | ReadingContext.currentSlabId / currentRevisionRef                | current slab 样式                       | 会话状态；提升 companion 不删除旧 slab    |
| Companion    | ReadingContext.companionSlabIds                                  | companion slab                          | 会话派生集合；line of fire 突出一个或少数 |
| 镜头         | CameraState：position、rotation、zoom、projection                | scene transform                         | ReadingSession 私有；不写 Document        |
| 焦点         | FocusState：focusAnchor、focusSlabId、selectedConnectionId       | focus ring、active beam、scroll target  | 临时；与文本 Selection 分开               |
| 文本选取     | SelectionState：DOM selection + AnchorInput                      | highlight + action popover              | 临时；提交 ask/link 后可清除              |
| 导航历史     | ReadingHistoryEntry：current、companion、focus、camera、scroll   | back/forward                            | 会话私有；与 revision history 分离        |

建议代码中明确三层：

- ReadingView：一次命令/MCP 返回的内容快照，可被多个 ReadingContext 使用，不拥有 camera。
- ReadingContext：可返回的阅读上下文，保存 current/companion 角色、focus、selected connection、camera、滚动恢复点。
- ReadingSession：一个网站窗口或 ChatGPT App 实例，拥有 active context、back/forward 栈和 SelectionState。不同窗口、App 实例、对话不覆盖彼此的相机和 current。

同一 Document 可同时出现在多个 ReadingView；同一 Revision 可在不同 view 中分别成为 current 和 companion；同一 Connection 可在多个 view 中产生 BeamInstance。这样持久文档、内容快照、阅读位置和屏幕对象不会混成一个可变对象。

交互动作必须分开：

- open root：从目录/搜索建立新的 active context，把旧 context 入历史；
- follow connection：在同一 context 中加入或定位 companion，保持 current、scene 和 back 栈；
- promote companion：交换 current/companion 角色，旧 current 保留为 companion/外围并入历史；
- close companion：只移除近景 companion/bridge，current 和 Connection 不变；
- back：恢复前一 context 的 current、companion、focus、camera；
- reset camera：只改变 CameraState；
- open revision：明确打开指定 revision，不改写 Connection 端点。

## 4. 空间和操作契约

### 4.1 三层结构

1. 语义层：读取 ReadingView、Anchor、Connection、Question、Revision；不存 DOM 坐标。
2. 空间层：映射到 SlabInstance、PassageHighlight、BeamInstance，计算角色、z-depth、pose。
3. 表现层：text slab 用可选取 HTML/DOM；beam 用 SVG/canvas/DOM overlay；camera 作为共同 transform。无论 CSS 3D 还是 WebGL，current 和 companion 必须可访问、可选取。

### 4.2 默认 line of fire

- current slab：中央、正面、scale 1、opacity 1，标题含 path/title/revision。
- primary companion：右侧；窄屏下方；scale 0.8–0.9，正文仍可读。
- additional companions：左右/后方弧线退后，保留标题、关系和 beam，降低正文密度。
- selected beam：高对比并带 relation label；其他 beams 仍可见但降噪。
- transclusion beam：与普通 link 不同的线宽/颜色/端点 marker，并有来源动作。
- endpoint：使用 passage 的实际渲染矩形或多矩形 union；多行选区不能只取第一行。
- overlay：默认不拦截文字 pointer events；另设透明且可访问的 beam hit target。

### 4.3 相机和阅读动作

| 输入                   | 语义         | 结果                                              |
| ---------------------- | ------------ | ------------------------------------------------- |
| 点 passage             | focus        | 高亮 passage，提亮相关 beams                      |
| 点 beam/关系标签       | follow       | 目标 slab 进入 line of fire，目标 passage 居中    |
| 点 companion 标题/正文 | promote      | companion 成 current，旧 current 保留             |
| 空场景拖动             | orbit/pan    | 只改 CameraState                                  |
| 空场景滚轮/pinch       | zoom         | 改变空间范围，不滚动文字                          |
| slab 正文滚轮          | scroll       | 只滚动该 slab，端点实时跟随                       |
| Escape/Close bridge    | close        | 只关近景关系，不删 Connection                     |
| Reset view             | reset camera | current/focus 不变                                |
| Tab/Shift+Tab          | 键盘导航     | current、companion、beam、close、promote 等均可达 |
| Enter                  | 执行动作     | follow、promote 或打开 source                     |
| reduced motion         | 降级         | 直接到目标 pose，语义不变                         |

文字区域拖选优先于相机拖动；空白 stage 才操作相机。触屏上单指在正文滚动，双指在空场景平移/缩放。原始 viewer 说明“interface uses keystrokes only, except for turning the view”（[viewer 页面](https://xanadu.com/xuspViewer.html)），所以关键动作应保留键盘入口，并提供可发现的按钮、aria-label 和 focus ring。

### 4.4 Passage、提问、连接

- current 或 companion 中选取文字，产生含 revisionId、start、end、quote 的 SelectionState。
- popover 显示标题、版本和 quote 摘要。
- “问 ChatGPT”只保存 Question 并发送到当前对话；不创建 Connection。
- “连接文字”是 two-step：固定第一端，第二端必须在另一个 passage 上选择；顶部显示两端，Escape 可取消。
- 建立 link 后仍停留在原 current；可打开 companion 预览，但不会自动生成 Question/Answer。
- relation 要在创建时可选或至少明确显示默认值。
- Answer 是独立 Document；只有显式 link 才产生 beam。

## 5. 现有实现的静态差距

以下行号以 /workspace/sites/xanadu-sidebranch 为准。

- components/reader/reader.tsx:757-771 只渲染 paper(view.document) 和一个 paper(comparison, true)。其他 connections 仅在下面列表显示，尚无外围多文档 scene。
- reader.tsx:312-334 的 showConnection 只 cat 两个 endpoint revision，设置一个 current 和一个 comparison，尚无 SlabInstance 集合或 line-of-fire scene。
- reader.tsx:503-573 的 paper 是普通 DOM section；reader.css:218-236 的 papers/paper 是 flex 2D 布局。reader.css:383-408 的 gutter 是单个 SVG 曲线和标签；没有 perspective、camera、z-depth 或 slab pose，唯一的 transform 是标签 translateX(-50%)。
- components/reader/connection-lines.tsx:22-45 只取 current 和 comparison 各自第一个 passage-focus，画两条 cubic path；47-55 只观察 resize 和 window resize，没有滚动/相机/多 endpoint/multi-beam 布局。
- reader.tsx:147-156 的 applyView 会同时清空 comparison、activeLink、focus、comparisonFocus、selection；reader.tsx:186-206 的 openDoc 调用它。因此新 view 会删除本地阅读上下文，不能满足 promote/back 语义。
- reader.tsx:381-400 的 createConnection 始终传 relation: reference，没有 relation picker。
- lib/domain/model.ts:73-80 的 Connection 没有 transclusion/source identity；lib/domain/commands.ts:127-129 把 link 定义为独立双向 passage connection。当前 UI 应只叫 link/connection。
- components/reader/passage.tsx:1-156 的 Passage 实际是渲染整个 DocumentRevision 的组件，不是领域 Passage；建议改名 DocumentBody/RevisionText，并将 PassageRef/Anchor 作为独立类型。
- reader.tsx:993-1018 的搜索点击只传 document id，没有把 grep 返回的 start/end 变成 FocusState；不能保证聚焦命中 passage。
- reader.css:846-864 在窄屏把 paired papers 上下堆叠、gutter 变横向 55px；这是 2D 移动端投影的起点，不是 3D 相机降级。

主代理提供的运行基线：1000 节 Markdown 约 15,095 个 DOM 节点；初开约 577ms 长任务；划选/输入后最长约 618ms。空间层的硬约束是：

- camera transform 不触发完整长文档 DOM 重排；
- beam 端点按 scroll/resize/camera/layout 批次更新，不能每个 passage 同步 layout；
- current 和 primary companion 保持完整可读；外围 slab 和非选中 beam 需按需渲染或虚拟化；
- 复测首开长任务、连续 5 秒 camera drag、连续 5 秒正文 scroll、划选和输入响应；加入空间层后不得继续放大 618ms 的已有响应。

## 6. 验收场景

### A1：单文档是空间阅读面

打开有标题、段落和 heading 的文档。预期 current slab 在 line of fire 中央，文字可选取；相机可旋转/平移/缩放并可 reset；相机变化不改 DocumentId、RevisionId、Anchor、Connection；场景有真实深度差异而非只有下方连接列表。

### A2：follow 是 current + companion

A v1 的 A1 与 B v1 的 B1 有 explanation Connection，打开 A 后点击 A1 的 beam。预期 A 仍是 current；B v1 进入旁边并可读；beam 两端贴住 A1/B1 实际文字；label 显示 explanation；关闭 companion 后 A/focus/Connection 不变；promote B 后 A 保留为 companion/外围或可返回历史。

### A3：多个相关文档可见

A 与 B/C/D 各有连接。打开 A 后，场景至少显示 B/C/D 的 slab/title 和对应 beams；一次只把当前 companion 放到 line of fire 近景，其他对象退后；点击 C 后 C 进入 companion，B 不从场景和导航历史消失；多条 beam 可重叠，选中一条不隐藏其他关系。

### A4：两端滚动时 beam 跟随文字

A1/B1 处在长文档不同位置。滚动任一 slab、调整窗口、旋转相机；beam 端点始终贴实际 passage，不能漂移到标题或卡片中心；多行选区不能只取第一行；beam 不拦截文字选择；动画被打断后最终端点仍一致。

### A5：link/transclusion 不混淆

给定一条用户 link 和一段有 source identity 的 transclusion。普通 link 用 relation beam；transclusion 用不同线型/端点 marker，并可打开 source revision/passage；同字符串不得触发 transclusion；没有 source identity 时不显示“来源/原文实时引用”。

### A6：连接创建不切换 current

在 A v1 选 A1，进入连接模式；在 B v1 选 B1，选择 contrast 并确认。预期 two-step UI 显示两端标题/版本/quote；建立后 A 仍是 current，B 可预览；relation 在 beam/详情/辅助文本一致；只创建一个持久 Connection。

### A7：问题、回答、连接独立

选择 A1 提问；保存 Question 后创建 Answer 文档；再显式连接 Answer passage 与 A1。预期提问不自动建 Connection；Answer 仍为独立 Document；只在显式 link 后出现 beam；从 Question、beam、目录打开 Answer 都保留同一 Document identity。

### A8：promote/back/close 保留上下文

A current、B companion，双方有 focus/camera。promote B，再 back，再 close companion，再 follow C。预期 back 恢复 A/B/focus/camera；close 只关 B 的近景；follow C 不因一次 open_document 响应而清掉整个 scene。

### A9：历史端点不静默迁移

A v1/A1 与 B v1/B1 有 link；编辑 A 产生 A v2。打开连接的 A v1，再查看最新版。预期 v1 slab 和 beam 仍指向 v1 exact Anchor；最新版是明确的新 revision；没有明确映射时不得把 beam 画到 A2 相似句；版本号在 slab/beam/history 一致。

### A10：搜索聚焦命中

查询词在文档中出现多次，点第二个结果。预期打开正确 revision，把 match start/end 变为 FocusState 并滚动到命中处；搜索动作保留 back context；历史命中明确显示版本。

### A11：390px 移动端保留关系

390px App frame 执行 A2、A4、A6。预期 current/companion 可按顺序阅读；可滚动、选取、follow、close、promote；3D 降级为 2D vertical projection 时 relation、version、source 语义不消失；控件和 selection popover 不盖住正文。

### A12：键盘和 reduced motion

无鼠标执行 A2、A6、A8。预期 Tab 可达 current、beam、companion、close、promote、reset；Enter 执行；Escape 关 popover/bridge 但不删关系；reduced motion 直接到最终 pose；文字仍是可访问 DOM，不是只有 canvas 像素。

### A13：长文档和多连接性能

当前文档接近上限，至少 100 个相关文档和多条重叠跨文档连接，连续 camera drag/scroll 各 5 秒。预期 current/companion 选择和滚动不被全场景重绘阻塞；外围按需渲染；无明显长任务、旧 beam、错端点或可见跳帧；报告给出目标设备、长任务、帧率/选区输入数据。

## 7. 实施顺序

1. 先定义 Document/Revision、PassageRef/Anchor、Connection、ReadingView、ReadingContext、CameraState、FocusState、SelectionState、SlabInstance、BeamInstance。
2. 先完成 current + companion 的真实 line of fire 和实际端点跟随，再增加外围 slab；不要先做只能旋转的装饰性 3D。
3. 文字保持为可选取 DOM；空间投影和 beam 是派生层；不要将完整正文只画到 canvas。
4. 将 follow/promote/back/close 定义为 context 操作，不用一次 setView 清空全部本地状态。
5. link 和 transclusion 使用独立 visual kind；无 source identity 时只显示普通 link。
6. 优先验收 A2、A4、A5、A8、A11、A13。

## 8. 来源

- [Project Xanadu 首页：Parallel Pages, Visibly Connected](https://xanadu.com/)
- [The Xanadu Universe：1972 mockup、XanaduSpace slabs/tetroids/beams](https://xanadu.com/xUniverse-D6)
- [Back to the Future：reading plane/line of fire、companion page、beams、版本和 folding space](https://www.xanadu.net/XanaduSpace/btf.htm)
- [XanaduSpace viewer：OpenGL、3D viewer 和键盘操作说明](https://xanadu.com/xuspViewer.html)
- [Try Our Sample Xanadoc：follow、移动窗口、关闭 bridge、访问来源](https://xanadu.com/xuSampleXanadoc-D12.html)
- [The Edit Decision List](https://xanadu.com/xuEDL.html)
- [Understanding Xanalinks](https://xanadu.com/xanaLinks.html)
- [Xanalogical Structure, Needed Now More than Ever：Nelson 署名的平行文档、transpointing windows、link/transclusion 和版本说明](https://cs.brown.edu/memex/ACM_HypertextTestbed/papers/60.html)
