# XanaduSpace 交互证据：2007 年 1.0 与后期 Origins 演示包分开

研究日期：2026-09-19。使用 Exa 搜索与抓取第一手页面；为取得完整原始资料，用官方网页链接和 Internet Archive 下载包补充。仅静态读取文件，没有运行 Windows 程序。本研究没有观看视频画面；视频证据仅来自 Exa 提取的官方视频转录，没有可靠逐句时间戳。

## 版本边界与最重要的结论

1. **2007 年 XanaduSpace 1.0**：xanarama 下载页的内部修订号是 `xanarama-D7 07.06.25`，明确标 `XanaduSpace 1.0`；2007-07-11 论文草稿 `btf-D18` 描述其阅读平面。原始 Windows 安装包也已取得，文件日期集中于 2007-06-17。网页只列出相机指令，不能据此补出所有连接导航按键。[S1][S2][S6]
2. **2013 年 D9y Origins 演示包**：目前官网 xuspViewer 页面实际下载的是 `xuspD9y,2013`；包名和内部声明都写 Version 9y。其 README 是 2012-03-26 版本，技术说明是 2012-02-24 版本。它为连接导航提供精确的 c/e/s/f 按键说明，还提供可读 Python 源码；这些是后期包的直接证据，不应无条件反推 2007 1.0 的逐键行为。[S3][S7][S8][S9]
3. 两者共同支持的核心不是同时读完所有文档，而是**保留周围关联场景，每次把一条连接与其两端带到清楚可读的位置**。切换连接涉及文档自身的位置与形状变化，不能仅实现固定卡片之间的高亮连线。[S2：A SYSTEM OF SIDE-BY-SIDE VIEWING][S8：WHAT IT SHOWS]

## A. 2007 年 1.0 可确认的操作与状态

| 输入或状态 | 原型反应 | 原始证据 | 限制 |
|---|---|---|---|
| 启动 1.0 | 提供十一页示例；前景有两页连接的可读页面 | [S1：DIRECTIONS 前介绍] | “十一页”是该演示的数据，不是系统上限 |
| 当前阅读焦点 | current page/vunit 位于阅读平面中，文字较大；companion 是当前连接另一端的页面，文字较小 | [S2：A SYSTEM OF SIDE-BY-SIDE VIEWING，figs. 4–5] | current 是语义角色，不是泛指鼠标悬停 |
| 选中 current 页的一条 link 或 transclusion | 另一端 vunit 摆动到其旁，成为 companion；选中的连接因此可以清楚阅读 | [S2：同节] | 该文没有给出具体按键、鼠标命中区或同位置多连接的消歧规则 |
| 把注意力转到 companion | companion 成为 current | [S2：同节] | 不等同于实现了浏览器 Back/Forward 历史栈 |
| 没有被选为 current/companion 的页面 | 仍在同一三维场景中可见；读者可以看到哪些页面移入以及哪些并非当前页 | [S2：同节、fig. 4 caption] | 不应推导所有页面必须常驻屏幕内或完全不遮挡 |
| Ctrl+Space | 相机向前 | [S1：DIRECTIONS] | 原网页措辞是 camera；不是字号按钮 |
| Alt+Space | 相机向后 | [S1：DIRECTIONS] | 同上 |
| 四个方向键 | 相机向上、下、左、右平移 | [S1：DIRECTIONS] | 与 D9y README 的前后飞行映射不同，必须分版本 |
| 按住鼠标右键并移动 | 转动相机 | [S1：DIRECTIONS] | 不能据此添加左键点击卡片导航等未经证实的行为 |
| Space-R（保持原文写法） | 重置相机位置 | [S1：DIRECTIONS] | 原网页未澄清同时按下还是前缀键序列；不可擅自改写为单 R |
| 显示 link 与 transclusion | 截图说明中的深色带是 links、红色带是 transclusions；两者可以任意重叠 | [S2：RETURNING TO THE ORIGINAL VIEW] | 论文的配色措辞与后期 README 的灰/粉措辞不同；透明度与截图光照也影响观感 |
| 多种 view | 论文 fig. 3 明确把环状页面视图标为 XanaduSpace | [S2：ANY NUMBER OF VIEWS] | 文本未给出让用户切到环视图的输入方式；不能说 1.0 安装包中的某个键已验证 |

阅读平面 `reading plane / line of fire` 是把当前页及至少一个连接页同时带到近处可读的呈现机制。它与“整个世界相机朝哪看”是两个不同控制层。[S2：A SYSTEM OF SIDE-BY-SIDE VIEWING]

## B. 后期 D9y 演示包：精确操作说明

以下均来自 [S7]，不是把它冒充 2007 1.0 手册。

| 输入或状态 | 原型反应 | 文档小节 | 限制 |
|---|---|---|---|
| 当前连接 | 位于空间中固定的 `Current Line`，但这条参考线没有画出来；对齐的两段粉色段落能帮助识别其位置 | EXPLANATION | “未标出的参考线”是文档直接说明，不应声称原型有中央横线指示器 |
| c | 选择下一个向下的连接；current 页上下移动，将下一连接对到 Current Line，同时另一 companion 摆入 | USER COMMANDS / EXPLANATION | 这是沿连接离散步进，不是滚轮连续滚动 |
| e | 选择上一个向上的连接；同样移动 current 与 companion 对齐 | 同上 | 不说明“按住重复”的定时参数 |
| f | 向右，右边 companion 成为 current | USER COMMANDS | 不是任意选择任意文档 |
| s | 向左，左边 companion 成为 current | USER COMMANDS | 不是历史栈后退；可能沿连接回到原页，但语义不同 |
| 左/右方向键 | 向左右飞行 | USER COMMANDS | 作用于相机 |
| 上/下方向键 | 向前后飞行 | USER COMMANDS | 与 2007 页面中的上下平移冲突；不能合并 |
| 按住右鼠标键移动 | 改变相机方向及飞行方向 | USER COMMANDS | README 的正常阅读操作不包含左键选连接 |
| current / companion 文字 | current 大字，companion 小字 | EXPLANATION | 没有公布字号调节命令 |
| 粉色连接 | transclusion：同一内容在多处出现，显示引文来源 | TWO TYPES OF CONNECTIONS | 不能把每个关系都画成同一种连接 |
| 灰色连接 | xanalinks：有类型的双向或多向连接，表达多种关系 | TWO TYPES OF CONNECTIONS | 作者直接承认这类连接在该 demo 中不如 transclusion 清楚 |

### 后期源码能进一步证明什么

源码文件为 [S9]；只作静态证据，未运行，不据此宣称所有隐藏入口可靠可用。

- `TranslitApplitude2` 维护 `currentstrand` 和 `currentchunk` 两个独立状态（2549–2550 行）。初始 current 是 NelsonIntro 的一个 chunk（2796–2800 行）。因此“当前页”和“页中当前关联片段”不是一个选择状态。
- `e/c` 遍历当前 strand 的前/后 chunk，跳过 `interesting` 不成立的片段；后者检查有入/出 clink 或同一个 chunk 出现于多个 strand（2809–2874、3053–3091 行）。到边界找不到下一项时保留原状态；这一段没有循环回到页首/页尾的代码。
- `s/f` 改变 currentstrand/currentchunk（3093–3111 行）。`prevstrand/nextstrand` 先检查共享内容出现位置，再按连接相应端点找其他 strand（2827–2866 行）。这些函数没有访问历史栈；所以 `s` 是向左连接导航，而不是“撤销上次导航”。
- 默认 mode=3（2557 行），其 build 中 current 的 MakeSlab 比例参数为 1，左右 companion 为 0.7（3330 附近）。这是后期脚本中相对尺度参数，不是已测得的屏幕字号比例。
- 源码还存在 `1/2/3` 视图模式、关系可见性开关和左键文本 hit-test（3007–3052、3113–3169 行），而 README 仅承诺少量正常阅读命令。**不要把源码残留、开发功能或未测试分支列为 1.0 已验证交互。**
- 相机更新与导航状态分开：基础 `Applitude.update` 在 213–217 行响应方向键和右鼠标移动，c/e/s/f 则改 currentstrand/currentchunk 后重建场景。

## C. 视频与回顾说明支持的动画行为

官方 TheTedNelson 视频的转录先描述十一页和大量交叉连接，然后说明 current 大字、companion 小字；演讲者把 Bible 来源页设为 current，再切回原 current 并逐个经过页上的连接。另一端文档通过 `swoop + morph` 移入，当前连接因此变得可读。[S4：转录中 “here we are in zanadu space” 后的演示段]

这能支持“连续可感知的移入和变形”“可以从连接另一端继续阅读”的讲解。**没有观看画面，所以不能从这份转录给出轨迹、缓动曲线、速度、相机角度、逐帧遮挡次序或精确时间戳。**转录里提到约 27 条连接且演讲者自己不确定；后期技术说明明确写 26 条，不能把这个差异悄悄抹掉。[S4][S8：WHAT IT SHOWS]

官方回顾页面进一步说明：页面是三维 slabs；高亮文字段是独立的三维对象 tetroids；它们由 beams 连接；页面、段落对象和 beams 一起 swoop/morph。这说明连接端点和高亮区域要随页面变化保持一致，不是屏幕固定装饰。[S5：XanaduSpace 条目]

## D. 翻页、滚动、连续滚动、返回与自由编辑：证据边界

| 待核实问题 | 当前可作的判断 | 不可声称的内容 |
|---|---|---|
| 按页翻页 | 可确认连接导航改变 current 与 companion；后期程序把内容排版并分为页面 | 不能声称有 PageUp/PageDown、分页按钮或普通电子书的上一页/下一页逻辑 |
| 滚动当前页 | c/e 导航确实使 current 页上下移动，把关联片段对齐到 Current Line | 不能把这种离散对齐称作已实现的自由连续滚动 |
| 滚轮或触控连续滚动 | 本轮第一手说明、转录和已查导航源码中没有确认 | 不新增这种行为后还称其“原型复现”；如项目需要，应标实现选择 |
| 返回原 current | 视频讲解有返回原页；s/f 可按关系在左右页间移动 | 没有证据支持导航历史、面包屑或全局 Back 按钮 |
| 同一片段重叠多连接的顺序 | 原型允许重叠；后期源码有 chunk 与关系遍历次序 | 缺少完整运行结果，不能定义所有多路端点的 UI 排序契约 |
| 文字尺度 | current 与 companion 大小不同；后期脚本有相对尺度 | 没有原始字号设置面板或缩放键证据 |
| 文本编辑、来源文档完整内容 | 后期技术说明说来源已截断并包装进 demo；原本希望加载外部 EDL/ODL 与网络内容，但包里 EDL/ODL 硬编码 | 不能把 demo 当完整编辑器或完整原文阅读器 |
| 音视频、多种非矩形 vunit | 论文明确讨论这些作为一般模型和将来扩展；文字可以原则上有多种形态 | 不宣称该 Windows demo 实现了音视频编辑、字幕同步或所有设想的视图 |

来源分别为 [S1][S2][S4][S7][S8][S9]；“没有确认”指本次已审阅资料的证据不足，不是证明所有历史版本都没有该功能。

## E. 对 Sidebranch 的推导（不是原设计事实）

本轮没有阅读或修改项目。若项目选择实现这一交互，应明确选择目标版本后再定按键，不能把 2007 与 2013 映射拼在一起。

最小可追溯状态至少包括当前文档、当前关联片段/连接、由其端点推导的伴随文档、相机姿态。连接导航应把选中片段对齐到阅读位置，协调改变页面、高亮和连接带；焦点切换应从另一端继续连接导航。相机移动与语义焦点切换应分开。

连续滚动、鼠标点击导航、搜索、返回历史等若需加入，应明确记录为本项目的实现选择。未找到原型依据的细节先列待验证，不用现代 UI 惯例填补。

## 来源与本地证据

- **S1 — 2007 1.0 下载说明**：[2011 存档](https://web.archive.org/web/20110625184656/http:/xanarama.net/)，内部版本 `xanarama-D7 07.06.25`。另核对 [2012 存档](https://web.archive.org/web/20121023041804/http:/xanarama.net/)，相机命令一致。完整原始 HTML：`/tmp/xanarama-2007.html`。
- **S2 — Nelson 与 Smith，Back to the Future**：[作者站点](https://xanadu.com/XanaduSpace/btf.htm)，`btf-D18 07.07.11`。xanadu.net 镜像内容相同，不当成独立来源。完整抓取在 `/tmp/xanadu-interaction-raw0.json` 与 `/tmp/xanadu-interaction-pass2-0.json`。
- **S3 — 官网当前演示介绍**：[xuspViewer](https://xanadu.com/xuspViewer.html)，`xuspViewer-D67 17.05.07`。明确称 stuck demo，除转视角外以按键操作；链接指向 D9y 包。
- **S4 — TheTedNelson 官方视频**：[Ted Nelson Demonstrates XanaduSpace](https://www.youtube.com/watch?v=1yLNGUeHapA)。Exa metadata 给上传日期 2013-07-11；不把上传日期当录制日期。只读取转录；完整文本在 `/tmp/xanadu-interaction-pass2-0.json`。
- **S5 — 官方回顾**：[The Xanadu Universe](https://xanadu.com/xUniverse-D6)，XanaduSpace 条目。用来确认 slabs/tetroids/beams 同时 sworf，以及当时未做到网络获取；未用其中 OpenXanadu 条目推导 1.0。
- **S6 — 原始 1.0 安装包**：[Wayback 二进制](https://web.archive.org/web/20110625184656id_/http://xanarama.net/XanaduSpace_Install_1.0.exe)，本地 `/tmp/XanaduSpace_Install_1.0.exe`。安全解包到 `/tmp/xanaduspace-1.0-extracted`，清单 `/tmp/xanadu-1.0-file-list.txt`。40 个文件，主要时间 2007-06-17；无单独操作 README，可执行脚本是 `.pye`，未解码/执行。不能从包中补出网页未列的按键。
- **S7 — D9y Directions**：[官方 ZIP](https://xanadu.com/xuspD9y%2C2013)，包内 `ReadMe!-Directions,License.txt`，`xuspReadMe-D14 12.03.26`。本地 `/tmp/xanaduspace-original/D9y--XanaduSpaceDemoPack-D9y,2013/ReadMe!-Directions,License.txt`。
- **S8 — D9y Technicalities**：同一 [官方 ZIP](https://xanadu.com/xuspD9y%2C2013)，包内 `Technicalities of This Demo/xuspDemoTech-D8.txt`，`12.02.24`。有 WHAT IT SHOWS、PARADOX OF THE DEMO、QUIRKS OF THE PACKAGING 三节。
- **S9 — D9y 可读源码**：同一 [官方 ZIP](https://xanadu.com/xuspD9y%2C2013)，包内 `Program/scripts/startup.py`；行号来自原始文件的 Python splitlines，不改动源码。仅静态核对。

`sources_reviewed = 9`：按上列独立文档/资料件计数；S1 的两个存档只计一项，S2 两域名镜像只计一项。共审阅五份网页/视频转录来源、一个原始安装包、两份后期随包说明、一份后期源码。排除搜索返回的游戏 Xanadu Next、现代 OpenXanadu 滚动示例以及无法核实的评论。提取工具 7-Zip 官方下载页仅用于解包，不计研究来源。
