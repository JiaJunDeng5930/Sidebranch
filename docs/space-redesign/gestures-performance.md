# 空间输入与有界渲染契约

## 1. 目标与结论

本设计只定义输入归属、空间移动、过渡中断和渲染预算。文档是否属于空间、哪些文档相邻、follow/promote/back 的语义由空间模型和阅读流程决定；这里把这些语义动作映射到可靠的输入，并保证它们不会和读文字争抢手势。

推荐方案有四个核心决定：

1. **先按命中区域分配输入，再识别手势。** 正文从 `pointerdown` 起归浏览器原生文字与滚动；空场景才归相机；按钮、连接标签、折页和表单各自拥有输入。系统不在移动若干像素后把一次文字拖选“改判”为相机拖动。
2. **空间的基本直接操纵是平移，旋转是显式修饰动作，缩放必须从空场景开始。** 阅读面不会因为普通滚轮、正文拖动或单击而旋转。相机有范围，并始终能回到当前文档。
3. **所有过渡都能被下一次输入从当前画面打断。** 新输入不排队，不先跳到旧动画终点；网络响应也不能把用户带回已经离开的目标。
4. **正文 DOM、外围页、连接和每帧工作都有硬上限。** 当前文档与一个主要关联文档保留可读 DOM；其余对象使用纸页壳、折页或叠放摘要。直接操纵只更新合成属性，连接精确测量按重要性在小预算内完成。

这会牺牲自由摆放每张纸页的感觉，也不提供靠猜设备类型工作的“智能滚轮”。收益是文字选择、滚动和空间移动有稳定边界，键盘和触摸能表达相同语义，一百份同等相关文档也不会变成一百棵正文 DOM。

## 2. 输入所有权

### 2.1 命中区域

空间渲染层必须为每个可交互表面提供稳定的 `hitRole`；不要用 CSS 类名或事件冒泡路径临时猜意图。

| `hitRole`             | 例子                                               | 输入所有者       | 可以产生的动作                                 |
| --------------------- | -------------------------------------------------- | ---------------- | ---------------------------------------------- |
| `text`                | current/companion 正文、标题中的可选文字、正文链接 | 浏览器原生文字层 | 选取、复制、上下文菜单、正文滚动、打开正文链接 |
| `control`             | 提问输入框、关系选择器、关闭/提升按钮              | 原生控件         | 控件自己的默认行为                             |
| `scrollbar`           | 正文原生滚动条                                     | 浏览器           | 拖动滚动条；不移动相机                         |
| `relation`            | beam 标签、端点标记、可见的连接命中带              | 阅读流程         | focus/follow；不兼任相机拖动                   |
| `document-affordance` | 折角、叠页露出的标题边、明确的“设为当前”区域       | 空间/阅读流程    | preview、展开叠放或语义激活                    |
| `stage`               | 没有纸页、连接、控件覆盖的背景                     | 相机             | 平移、显式旋转、缩放                           |

优先级固定为：顶层对话框/表单 → 原生正文和滚动条 → 可操作的连接/折页 → 空场景。命中后直到本次指针序列结束都不换所有者。唯一的覆盖手势是用户**先按住 Space 再按下指针**，它在非表单区域明确请求相机平移。

外围纸页的视觉面积不应全部成为不可见的大命中盒；只有露出的纸边、标题和明确动作区域接收事件。beam 的可见线可有较宽透明命中带，但命中带不能跨过正文文字。若线穿过正文，正文拥有这部分像素，连接可从端点、标签或键盘访问。

### 2.2 指针仲裁状态

每个活跃指针只处在一个输入状态：

- `idle`
- `native-text`：浏览器掌握正文选择、链接和滚动。
- `pending-stage`：在空场景按下，尚未超过拖动阈值。
- `camera-pan` / `camera-orbit` / `camera-pinch`
- `semantic-press`：连接、折页、叠页或控件等待 click/activate。
- `cancelled`

鼠标越过 4 CSS px、触摸越过 8 CSS px 后，`pending-stage` 才提交为拖动；在此之前松手只是空场景点击。只有提交为空间手势后才调用 `preventDefault()` 和 `setPointerCapture()`。正文不进入 `pending-stage`，不捕获指针。`pointercancel`、`lostpointercapture`、窗口失焦或页面隐藏都结束手势并保留最后一个已呈现姿态。

一次拖选结束后如果存在非折叠原生 Selection，必须抑制同一次序列派生的 click/follow/promote。悬停只可预览或提亮；悬停永远不改变当前文档，也不写导航历史。

## 3. 各输入设备的完整映射

### 3.1 鼠标

| 用户动作                                  | 起点              | 结果                                                                 |
| ----------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| 左键拖动                                  | 正文              | 原生文字选择；不平移纸页或相机                                       |
| 双击/三击                                 | 正文              | 浏览器原生选词/选段；不提升文档                                      |
| 滚轮                                      | 正文              | 只滚动该文档。到达顶部/底部也不把余量传给相机                        |
| 左键拖动                                  | 空场景            | 平移相机；松手即停，不附加合成惯性                                   |
| Shift + 左键拖动                          | 空场景            | 在安全范围内 orbit；当前阅读面保持可读                               |
| Space + 左键拖动                          | 非表单的任意位置  | 明确平移相机；从正文开始时也不建立选区                               |
| 滚轮                                      | 空场景            | 垂直平移相机；Shift + 滚轮为水平平移                                 |
| Ctrl + 滚轮（含浏览器合成的 pinch wheel） | 已聚焦的空场景    | 以指针位置为中心缩放相机                                             |
| 单击                                      | beam 标签/端点    | 聚焦连接；再次激活行为由 reading-flow 定义                           |
| 单击                                      | 折页/叠页露出区域 | 展开或预览该空间对象，不直接改 current，除非该区域明确标作“设为当前” |
| 右键                                      | 任意正文          | 保留浏览器上下文菜单；产品不占用                                     |

不用右键拖动相机，避免夺走上下文菜单；不用双击作为唯一导航入口，避免与原生选词冲突。主要阅读布局不支持自由拖动单张文档。系统布局拥有 current、companion、外围和折叠位置，用户通过移动相机、展开叠放和语义激活进入空间深处。若未来空间模型加入手动摆放，必须新增可见 grip；不能复用标题或正文拖动。

### 3.2 触控板

浏览器不能可靠地区分物理鼠标滚轮和触控板滚动，所以不根据 `deltaMode`、事件频率或 delta 大小猜设备。映射只看起点和修饰键：

- 两指滚动从正文开始：只滚动该正文，保留操作系统惯性；`overscroll-behavior: contain` 阻止滚动链传到场景。
- 两指滚动从空场景开始：按 delta 平移相机；系统送来的惯性 delta 继续生效，不再叠加产品自己的惯性。
- pinch 从已聚焦的空场景开始：浏览器通常产生带 `ctrlKey` 的 wheel，映射为相机缩放。
- pinch 从正文或表单开始：保留浏览器/系统页面缩放，不改相机。
- Shift + 两指滚动从空场景开始：水平平移，与鼠标 Shift + wheel 完全相同。浏览器事件不能可靠区分触控板与滚轮，因此 orbit 只由空场景 Shift + 拖动触发。

相机 wheel delta 在一帧内累加，一帧只写一次。不能对每个 wheel 事件 dispatch React 状态。

### 3.3 触摸屏

| 用户动作         | 起点                            | 结果                                  |
| ---------------- | ------------------------------- | ------------------------------------- |
| 单指拖动         | 正文                            | 原生纵向滚动                          |
| 长按并拖动选择柄 | 正文                            | 浏览器原生选择、复制和系统菜单        |
| 单指拖动         | 空场景                          | 平移相机                              |
| 双指平移/捏合    | 空场景                          | 同时平移与有界缩放；以两指中心为锚点  |
| 双指手势         | 正文                            | 页面缩放/正文原生行为，不进入相机手势 |
| 点按             | 折页、叠页、beam 标签、明确动作 | 与鼠标/Enter 相同的语义激活           |

窄屏 2D 投影仍遵守同一所有权。页面本身纵向滚动，current/companion 各自的正文滚动只在其正文范围内发生。不能用横向 swipe 作为 back/promote 的唯一入口；这些动作必须有可见按钮和键盘等价操作。

`touch-action` 按区域设置：正文至少允许 `pan-y pinch-zoom`；空场景在启用自定义双指相机时设为 `none`；控件保持浏览器默认。不要在整个 reader 根节点统一设置 `touch-action: none`。

### 3.4 键盘

键盘焦点顺序只包含有语义的对象，不遍历每条装饰 beam 或每张被叠放隐藏的纸：current 阅读区 → current 的可见连接 → primary companion → 已展开的外围/叠放项 → 场景控制。折叠集合是一个焦点项，展开后才把其中当前可见项加入顺序。

| 按键                      | 焦点条件                             | 结果                                                                                                                                                                           |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tab / Shift+Tab           | 任意                                 | 按上述顺序移动焦点                                                                                                                                                             |
| Enter / Space             | relation/document-affordance/control | 执行与点按相同的显式动作                                                                                                                                                       |
| 方向键                    | 正文滚动区                           | 浏览器原生按行滚动；不移动相机                                                                                                                                                 |
| PageUp/PageDown、Home/End | 正文滚动区                           | 浏览器原生文档滚动                                                                                                                                                             |
| 方向键                    | 展开的叠放/外围集合                  | 按空间模型提供的邻接关系移动 roving focus；不臆造排序                                                                                                                          |
| Shift + 方向键            | 场景焦点                             | 小步平移相机                                                                                                                                                                   |
| `+` / `-`                 | 场景焦点                             | 分级缩放                                                                                                                                                                       |
| `0`                       | 场景焦点                             | 相机回到 current 的标准阅读姿态，不改 current/focus                                                                                                                            |
| Alt/⌘ + ← / →             | 非编辑控件                           | 阅读上下文 back/forward                                                                                                                                                        |
| Escape                    | 任意                                 | 调用 reading-flow 的 `dismissTopTransient`：当前菜单/预览 → 未提交选区动作或问题编辑器 → 未完成连接第二端 → 搜索/历史/任务层；活跃空间手势立即取消。旁文只由明确“关闭旁读”收起 |

输入框、textarea、select、contenteditable 内不接管 Space、方向键、Home/End、常用编辑快捷键。`Ctrl/⌘+A/C/X` 对正文保持原生。当前产品的搜索快捷键可继续使用，但浏览器查找和页面缩放必须仍有可达入口。

每个可聚焦空间对象需要可读名称，包括标题、版本、关系类型以及“预览/跟随/设为当前”中的实际动作。仅画在 canvas/SVG 上的 beam 必须有对应的 DOM 控件代理。

## 4. 原生文字选择契约

### 4.1 不可破坏的行为

current 和 primary companion 的文本继续是可选取 HTML。空间变换不得把文字栅格化到 canvas。正文层不得在 `pointerdown/move/up` 上调用 `preventDefault()`，不得捕获指针，也不得把一次普通 click 解释为 promote。选择后仍由现有源码偏移映射产生 `{revisionId, start, end, quote}`；无法精确映射时拒绝创建 Anchor，不能依据渲染字符串猜偏移。

选区动作浮层在 `selectionchange` 后的下一帧读取最终 Range；拖动选择柄期间不反复开关浮层。浮层不得清除 Selection，且不得盖住选区的活动端；滚动、resize 或相机变化时只重新定位浮层。用户点空白、按 Escape 或提交动作后，才按 reading-flow 的规则清除。

正文链接和选区冲突时遵循浏览器惯例：没有拖动且 Selection 折叠才激活链接。非折叠 Selection 存在时，本次 click 不激活链接或文档角色变化。

### 4.2 虚拟化与长选区

现有 4,096 UTF-16 code unit chunk、测量 spacer 和源码偏移映射可继续使用，但选择期间需要一个明确的 **selection corridor**：

1. `pointerdown`/长按落入正文时，固定起点 chunk、当前可见 chunk 和相邻一块。
2. 原生 Selection 的 anchor/focus 穿过 chunk 边界时，保持两端之间的 chunk 连续挂载，避免 spacer 让复制内容缺段。
3. corridor 最多 12 个 chunk（约 48 KiB 源码；实际按 chunk 边界），且全局同时只允许一个原生选区拥有 corridor。
4. 接近上限时停止继续自动扩展，保留最后一个精确可映射范围，并显示“长选区已到本次上限，可分段选择”的非模态提示。不得生成缺失中段的 Anchor。
5. Selection 折叠或动作结束后，在下一次空闲清理中逐步回收额外挂载，不在 `selectionchange` 同一帧同步卸载。

这个上限是资源有界与任意长原生选区之间的明确取舍，需要在桌面和移动浏览器验证。若浏览器在动态加入相邻 chunk 时不能稳定保留 Range，应退回“选区不跨当前连续窗口”的更小能力，而不是暂时挂载整篇长文。

## 5. 相机边界与直接操纵

空间模型提供场景包围盒、current 标准阅读姿态和当前可探索区域；输入层只在这些边界内更新相机：

- zoom 限制为标准阅读缩放的 `0.55×–1.8×`。更远的结构由折页/叠放表达，而不是无限缩小到看不清的点。
- orbit 的 yaw 限制在 ±22°、pitch 限制在 ±10°。文本操作一开始或 current 获得键盘焦点时，不强制归零，但提供一步 reset。
- pan 至少保留 current 或已展开集合的一部分在视口内；越界使用 12% 的阻尼反馈，松手后回到合法边界。
- 不实现无限世界、滚轮加速度或产品自造惯性。操作系统触控板惯性照常输入，任何新 pointerdown 都立即终止剩余 wheel 聚合。

空间坐标和导航状态分开：pan/orbit/zoom 只改 `CameraState`；它们不加载文档、不改变 current、不展开叠放，也不写 Document。相机 reset 只恢复姿态。

### 5.1 实时姿态与语义提交分轨

实现必须有两个不同写入频率和订阅范围的通道，不能把它们都放进 Reader 顶层 React state：

| 通道             | 内容                                                                                 | 写入时机                                               | 订阅者                                       |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------- |
| `LivePoseStore`  | 本帧 camera/slab 呈现矩阵、活跃手势、动画 generation                                 | 每个 rAF，可变且可丢弃                                 | scene world、beam projection、调试 telemetry |
| `ReadingContext` | current/companion/focus、展开的 fold/stack、history entry、settled camera checkpoint | 显式语义动作；相机只在手势结束或最多每 100 ms 写恢复点 | Reader 流程、持久会话、可访问状态            |

pointer/wheel 事件只写输入累加器；rAF 消费 delta 并写 `LivePoseStore`。scene world 通过 CSS custom properties、独立外部 store 或等价的细粒度订阅得到矩阵，Reader、DocumentBody 和 Markdown tree 不订阅逐帧 pose。手势结束时把最终合法 camera pose 写为 checkpoint；这次提交不能重新构造正文或重置 scroll/Selection。

follow/promote/back 是离散的 `ReadingContext` 事务：先提交角色和 history，再由空间模型产出目标 pose，由 `LivePoseStore` 插值呈现。动画每帧姿态不进入 reducer history。这样 back 能恢复一个已结算 checkpoint，又不会记录几十个 pointer-move 中间态。

## 6. 可中断过渡

### 6.1 中断规则

视觉组可以决定 easing 和具体时长，但必须满足以下状态契约：

- 每个 pose 过渡有唯一 generation。新的导航、相机直接操纵、resize 或 reduced-motion 变化会让旧 generation 失效。
- 中断时先在同一动画帧采样**当前呈现姿态**，把它作为新操作起点；不能从旧逻辑起点重算，也不能先完成旧终点。
- 用户直接操纵优先级最高。pointer/wheel 到达后，CSS transition/WAAPI 动画在下一次 paint 前取消，画面立即跟手。
- follow/promote/back 的持久语义可在动作确认时提交；pose 是派生表现。中断 pose 不回滚已经确认的语义动作。
- 相同对象只允许一个 pose writer。React 状态、CSS transition 和 imperative transform 不能同时写同一 transform。
- `prefers-reduced-motion: reduce` 时，语义状态一次提交，pose 在下一帧直接到终点；连接端点仍需在终态重测。

取消动画、pointer capture 丢失或组件卸载后都要删除 rAF/observer/listener，且不得留下 `will-change`。过渡结束以实际 generation 和目标姿态核验，旧 `transitionend` 不能完成新动作。

### 6.2 异步内容

点击外围纸页后可先显示已有元数据和有尺寸的纸页壳；正文、关系页或解析结果异步到达。每次语义请求携带 `{contextId, intentGeneration, targetRevisionId}`：

- 新 intent 用 `AbortController` 取消不再需要的 fetch/解析；不能取消的结果只可进入版本缓存。
- 响应只有在 context、generation 和 revision 都仍匹配时才能改变可见角色或 focus。
- 用户在等待时 pan、scroll、back 或选择别的文档，输入继续有效；加载完成不得夺取焦点或把相机拉回。
- 壳到正文的替换保留已分配尺寸。测得真实高度后只修正该 slab 的布局 epoch，不让整个空间瞬间重排。
- “未加载”必须显示为未知/加载中，不能按“无关系”布局。

## 7. 有界渲染路径

### 7.1 分层与上限

渲染量按“用户当前能感知什么”决定，不按空间中文档总数决定。

| 层                 | 内容                                            |                         桌面硬上限 |                        窄屏硬上限 |
| ------------------ | ----------------------------------------------- | ---------------------------------: | --------------------------------: |
| 可读正文           | current + primary companion                     |                                  2 |                     2（顺序排列） |
| 正文常态 chunk     | 每个正文：可见窗口、上下 overscan、显式 focus   |                       每正文最多 7 |                      每正文最多 6 |
| selection corridor | 全局额外连续 chunk                              |                                 12 |                                10 |
| 独立外围纸页壳     | 标题、版本、关系/状态标记，无正文 token DOM     |                                 40 |                                16 |
| 可绘制 beam        | 选中/聚焦优先，再取可见关系                     |                                 48 |                                16 |
| 精确端点实时测量   | selected beam 两端 + current/companion 可见端点 | 每帧最多 12 个端点且受时间预算约束 | 每帧最多 6 个端点且受时间预算约束 |

超过纸页壳上限的文档必须由空间模型给出的折页/叠放集合表达，并显示实际数量；不能截断后假装不存在。超过 beam 上限的连接仍保留在语义数据和可访问关系列表中，视图显示“另有 N 条”并在聚焦后置换进可绘制集合。selected/focused connection 永不因配额被逐出。

40/16 是渲染器最后防线，不是空间布局应填满的目标。常态直接采用 spatial-model 的更小语义配额：每个距离带最多 8 个 leaf、一个 fan 最多 7 个成员，其余成为一个有真实 count/cursor 的 stack root。stack 中未进入当前 fan 的成员不生成隐藏 DOM。

常态目标是整个 reader 不超过 5,000 个 DOM element、800 个源码 token span；这是实现阶段要用实际 fixture 调整的工程预算，不是允许先挂载 5,000 再隐藏。正文、壳和 beam 分别统计，便于定位回归。

### 7.2 每帧管线

直接操纵期间使用单一 rAF 调度器和四阶段管线：

1. **收集输入**：pointer/wheel handler 只记录最新坐标、累计 delta、dirty reason，目标小于 1 ms，不 dispatch 组件树。
2. **读取**：在统一 read phase 读取本帧真正需要的 rect；禁止写 transform 后再读布局。camera-only 更新不读 DOM。
3. **计算**：约束 camera、投影已有场景坐标、更新选中 beam。若预算将耗尽，其余连接留到下一帧。
4. **写入**：一次写 CSS custom properties / SVG path。React/session 状态在手势结束时提交；为了崩溃恢复可每 100 ms 低频快照，但快照不驱动画面。

正文 scroll 同样只在 rAF 内更新虚拟窗口和高优先级端点。不要让每个 scroll observer、ResizeObserver 和 MutationObserver 各自启动一套测量。所有失效源进入同一个 `layoutEpoch + dirtyReasons` 队列。

### 7.3 连接几何

推荐把 slab、端点和 beam 保存在同一场景坐标系，让 camera transform 统一作用；纯 camera pan/orbit/zoom 不重读文字 rect。需要重测的原因只有正文 scroll、chunk mount/unmount、字体/宽度变化、slab pose/layout 和 endpoint 数据变化。

端点缓存键至少包含 `{slabInstanceId, revisionId, start, end, layoutEpoch}`。一次测量先用现有 `sourceRanges` 找实际多行 rect 并 union；找不到但范围落在虚拟 spacer 时，用文档上/下边缘 marker 表示方向，不能把端点画到纸页中心。

测量按优先级执行：

1. 当前选中/focus connection；
2. current ↔ primary companion 的可见连接；
3. 视口内、端点已挂载的连接；
4. 其余可绘制连接。

每帧 layout read 最多 3 ms；达到预算就停止。直接滚动时一级和二级每帧精确更新，其余 beam 可沿用上次几何并降淡。输入停止后 80 ms 内补齐所有仍可见 beam，失效超过一个 layout epoch 的 beam 不应以“精确连接”样式出现。

用明确的 chunk mount、font ready、ResizeObserver 和滚动事件失效缓存。不要观察整棵正文 subtree 的所有字符变化；不可变 revision 的内容变化应通过 revision/layout epoch 显式报告。

### 7.4 主线程优先级

工作按以下顺序让路：

1. 原生 selection、输入框和当前滚动；
2. camera 直接操纵与 current/companion 变换；
3. selected beam 和可见虚拟 chunk；
4. hover/预览、其他 beam、外围壳；
5. 未展示元数据、预取、缓存回收。

Markdown 对一个 immutable revision 只解析一次，RenderPlan 以 revisionId 缓存。解析大文档、构造搜索索引、关系投影和大数组排序不得发生在 pointer/wheel/scroll handler 或同一同步 React render 中；可放 Worker 的纯计算放 Worker，否则以不超过 4 ms 的分片协作执行。`startTransition` 可以降低 React 更新优先级，但不能作为已经满足帧预算的证据。

动画只改 transform/opacity。拖动期间关闭大面积动态阴影、filter 和 backdrop blur；`will-change` 只加在正在动画的少数层，并在 settled 后移除。文字仍保留正常抗锯齿和可访问 DOM。

## 8. 性能门槛与测量方法

基线已经显示旧实现有 577–618 ms 长任务，v2 的独立 rotation 样本为 33.4 ms p95 frame interval。33 ms 约等于 30 Hz，只说明相对旧版改善，不能作为“60 fps/丝滑”通过线。v3 不能只证明“比旧版好”，应在固定目标设备与浏览器上记录以下暖态 60 Hz 目标：

| 指标                                 |                                    直接操纵/正文滚动目标 |                            稳定后的目标 |
| ------------------------------------ | -------------------------------------------------------: | --------------------------------------: |
| pointer/wheel 同步 handler           |                                   p95 ≤ 1 ms，max ≤ 4 ms |                                    同左 |
| 输入到下一次 pose rAF 写入（单 rAF） |                                 p95 ≤ 20 ms，max ≤ 33 ms |                   键盘/激活同样单独记录 |
| double-rAF paint proxy               | p95 ≤ 40 ms，max ≤ 67 ms；报告中明确它天然跨两个刷新机会 |           不得与单 rAF 延迟混为一个指标 |
| frame interval                       |                                 p95 ≤ 20 ms，p99 ≤ 33 ms |                         无持续 idle rAF |
| Long Task（>50 ms）                  |                                 手势开始后的 5 秒内 0 个 |  内容首次解析单独报告，不与交互样本混算 |
| beam 高优先级端点                    |                                               下一帧更新 | 所有可见 beam 在停止输入后 80 ms 内收敛 |
| DOM/源码 span                        |                                      不超过第 7.1 节上限 |                      回收后回到常态上限 |

`tests/ui-performance.ts` 一类 double-rAF 采样从输入时刻等待两个 rAF callback，结果天然可能接近两个帧间隔；它适合发现长阻塞，但不能被命名成“下一帧延迟”。单 rAF 指标在事件到下一次 pose 写入处打点；double-rAF proxy 单独保留用于与现有基线纵向比较。若云端预览只能得到约 33 ms p95 frame interval，报告必须写“未证明暖态 60 Hz”，不能按较宽云环境门槛包装为通过。

还需在 4× CPU slowdown 或一台代表性中端移动设备上记录相同数据；该项是降级行为验证，不改写上述桌面流畅目标。记录其 input-to-pose、double-rAF、frame interval 和 Long Task 原值。无法满足流畅目标时按固定次序降级：暂停非选中 beam 精确更新 → 减少外围壳 → 取消阴影/透明效果 → 直接结束 pose 动画。不能降级原生选择、current 正文或 selected connection 的正确性，也不能用降级后的宽松数值宣称 60 fps。

冷启动、首次 Markdown 解析、暖缓存空间交互、网络等待分别采样。导入和目录刷新不能混入“纯相机”样本后宣称相机达标，也不能用单元测试或 GPU 层截图替代浏览器 telemetry。

## 9. 必须通过的交互与性能场景

1. **正文拖选对抗相机**：在 current 和 companion 中从普通文字、粗体、inline code、链接文字开始拖选；结果精确映射，camera/角色不变，context menu 和复制可用。
2. **滚动归属**：鼠标滚轮、触控板惯性、触摸单指分别从正文和空场景开始；正文不滚动空间，空间不滚动正文，边界没有 scroll chaining。
3. **中途改意图**：follow 动画未完成时立即 pan，再 back，再选另一文档；每次从当前画面接手，没有跳到旧终点，旧响应不夺焦点。
4. **选择中虚拟化**：在 1,000 节文档中滚动、跨 chunk 选择、拖动系统选择柄；Selection 不因卸载折叠，超 corridor 时明确停止，不生成错误 Anchor。
5. **多输入等价**：同一 follow/promote/展开叠放/close 流程分别用鼠标、触摸、键盘完成；悬停不是完成流程的必要条件。
6. **100 相关文档**：当前长文档、primary companion、100 个同等相关文档、80+ connection；超过上限由带真实计数的叠放表达，focus 后对象可置换进可见集合。
7. **5 秒压力**：连续 camera pan/orbit/zoom 5 秒，再连续正文 scroll 5 秒；记录 handler、input-to-paint、frame interval、Long Task、DOM/span、beam 收敛时间。
8. **取消与系统事件**：pointercancel、失去 capture、切 tab、resize、字体完成加载、reduced-motion 动态变化；最终状态可操作，无悬挂 rAF/observer，无旧 beam。
9. **390 px 触摸**：正文长按选取、滚动、折页展开、connection 激活、current/companion 顺序阅读；浏览器页面缩放仍可用，选区浮层不遮挡选择柄。

自动化应覆盖仲裁状态机、generation 失效和配额置换这些 DOM 静态类型无法保证的风险。帧率/Long Task/Selection 要用真实浏览器场景测量；不要写与 reducer/常量一一镜像的测试。

## 10. 跨组契约

### 需要 spatial-model.md 提供

- current 标准姿态、场景包围盒、可探索边界和窄屏投影；输入层据此 clamp camera，不自行定义语义距离。
- 外围纸页与叠放集合的 `slabInstanceId`、真实 count、可见成员、展开状态和键盘邻接图。
- 重要性排序的语义输入（current、primary companion、focused relation、visible aggregate），而不是要求输入层猜关系远近。
- 未加载关系的 `unknown` 状态；渲染层不会把它当成零关系。

### 需要 reading-flow.md 提供

- `preview`、`focus relation`、`follow`、`promote`、`close preview`、`back/forward` 的唯一语义命令和历史规则。
- Escape 的临时层栈，以及 selection popover/连接创建模式何时保留或清除 Selection。
- 折页/叠放首次点按是 preview 还是展开；输入层只映射激活，不自行切换 current。

### 需要 visual-motion.md 提供

- 各语义 pose 的终态、easing 和持续时间，满足本文 generation/中断/reduced-motion 契约。
- beam 失效时的降淡样式、外围壳与详细正文的视觉交接；不能靠扩大命中盒解决可发现性。
- 动态阴影和透明效果在压力降级时可被安全关闭。

### 实现共享状态

建议共享最小状态为：`InputOwner`、`ActiveGesture`、`CameraState`、`PoseGeneration`、`LayoutEpoch`、`DirtyReasons`、`VisibleRenderBudget`、`SelectionCorridor`。这些是会话/表现状态，不写入 Document、Revision、Connection，也不替代空间模型的 current/companion/fold 状态。

## 11. 需要验证的假设

1. 各目标浏览器在 selection corridor 逐块扩展时能保留原生 Range 和选择柄；这是风险最高的实现假设。
2. 空场景 pinch 产生的事件能在 reader 聚焦条件下与正文/页面缩放稳定区分，尤其是 iOS WebView 与 ChatGPT App 容器。
3. 同一场景坐标系可让 camera-only 更新不重测 beam；若最终视觉层把 beam 放在屏幕 overlay，需要用等价的矩阵投影保持“零 layout read”。
4. 40/16 个外围壳足以让空间模型表达位置与叠放，不会让一百文档退化成不可理解的计数。该数量需用真实标题长度和视口验证。
5. 每帧 3 ms 几何读取与 12/6 个端点配额足以让 selected/current beams 跟随滚动；需在 80+ connections fixture 上测量。
6. 当前实现按每次 pointer move dispatch React、camera 变化重测 beam、广域 MutationObserver 的路径需要替换为统一 rAF/epoch 调度，否则本文预算无法达成。
