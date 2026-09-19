# OpenXanadu 与后续 xanaviewer：原始设计证据

研究日期：2026-09-19。只读研究，未修改 Sidebranch。使用 Exa Search，随后读取官网演示自身引用的原始 HTML、JavaScript、CSS；没有采用第三方解释为结论依据。

## 证据与版本边界

- **2014 OpenXanadu**：[官方演示](https://xanadu.com/xanademos/MoeJusteOrigins.html)，页面标题为 `OpenXanadu (sources only)`。Ted Nelson 的[作者说明](https://xanadu.com/xUniverse-D6)中 `OpenXanadu™, Nelson with Nicholas Levin, 2014` 段（下载 HTML 第119–129行）说明：这是浏览器实现，以中央文章和缩小的原文显示引用来源，左列甚至装入整部 Old Testament；仅显示 transclusions，xanalinks 尚未加入，作者当时认为不值得继续此实现路线。[该段官方截图](https://xanadu.com/oxuShot.png)。**不能与 XanaduSpace 1.0 的三维交互混为同一个界面。**
- **2016 xanaviewer1 及后续 xanaviewer3**：[官方演示说明](https://xanadu.com/xuDemoPage.html)，页面日期对应 2016 Future of Text 演示；正文列出 [xanaviewer1](http://perma.pub/xanaviewer1/)，顶部后来推荐 [xanaviewer3](http://perma.pub/xanaviewer3/)。后者并不证明 2016 操作步骤在新版完全相同。
- **实测状态**：主代理在当前浏览器打开 2014 演示，只见左上 X 图标及空白正文，未获得可交互文档。因此下列 2014 行为均为**官网实际源码证据**，不是“当前浏览器实测通过”。本代理尝试抓取 perma.pub：Exa 超时，HTTP curl 返回 Empty reply from server，不能声称新版本实际加载成功。

## 官方截图可直接观察的视觉事实

已查看 [oxuShot.png](https://xanadu.com/oxuShot.png)，本地 `/tmp/openxanadu-official-screenshot.png`：中央是可读大字正文，左右来源是保留整页文本形态的窄长条；正文内引用背景的色块直接延续成外部桥带；蓝色范围从一行句末之后开始，紫色范围在末行中部结束，色带不是简单套住整段的矩形。右侧多条桥带可以交叉、重叠，并没有统一避让。正文顶部显示文档类型Xanadoc和Source路径，正文内部可见滚动条。**这是官方历史截图，截图中的具体比例不应用来声称和当前下载源码是同一个精确版本。**

## 2014：范围、来源条带和连接几何

### 色带绑定什么

**实际源码**：[EDLTransformer.js](https://xanadu.com/xanademos/Data/Transformer/EDLTransformer.js) `assembleXanadocTextAndXanalinkSet` 第123–176行，用 `sourceDocText.substr(location,length)` 依序组装正文，同时保存原文 `sourceLocation/sourceLength/sourceURLReference` 和正文 `destinationLocation/destinationLength/destinationURLReference`。[TransclusionTransformer.js](https://xanadu.com/xanademos/Data/Transformer/TransclusionTransformer.js) 第4–40行按起始字符位置和 `location + length` 插入左右文档的起止标记。

所以范围可以从一行中间开始，到另一行中间结束，**不是以整个段落、卡片或文档中心点为连接端点**。这里源码内部名称出现 `xanalinkSet`，不能据此宣称支持任意 xanalink；EDL 的 xanalink 解析在同文件第100–110行被注释掉。作者的[数据说明](https://xanadu.com/PurpData-D16.txt) `THE TWO FILE TYPES` 段也明确当时链接未实现，当前 OpenXanadu 只拉取内容并显示来源。

### 颜色与重叠

**实际源码**：[TransclusionTransformer.js](https://xanadu.com/xanademos/Data/Transformer/TransclusionTransformer.js) 第44–76、108–139行：每个文档对的 `transclusionInfoMap` 保存一个 `transclusionHue`，多个引用范围累积入 `transclusionUniqueIDArray`，因此同一对文档的多个范围共享色调。并不是每个段落固定一种语义色。[UniqueVariableGenerators.js](https://xanadu.com/xanademos/ExtendedJS/UniqueVariableGenerators.js) 第18–26行由200度开始，每次加18度，超过360回绕；这是实现的配色生成规则，不是 Xanadu 的通用本体规则。

**实际源码**：[TransclusionOverlayView.js](https://xanadu.com/xanademos/Views/TransclusionOverlayView.js) 第145–159行：填充为 `hsla(hue,100%,50%,0.50)`；当前选中桥使用更暗、不透明的描边，其他桥只填充。[CanvasUtility.js](https://xanadu.com/xanademos/ExtendedJS/CanvasUtility.js) 第19–76行描边宽2px。所有桥逐一绘制；代码未做交叉避让、桥间裁剪或“只显示最前方桥”的处理。由此可推断交叉区会呈现半透明叠色，但**当前运行表现未实测**。

### 桥的宽度和端点

**实际源码**：[CanvasUtility.js](https://xanadu.com/xanademos/ExtendedJS/CanvasUtility.js) `drawCanvasFullTransclusionPaths` 第251行起：读取文档与起止字符标记的 `getBoundingClientRect()`，将范围在正文内的首行/末行部分和中间行区域描成多边形，再从文档边缘向外延伸10px的短段，连接两端。上下边是直线；不是通用曲线细线。桥口高度由文字范围实际高度决定，两端缩放不同，桥宽会不同。[TransclusionOverlayView.js](https://xanadu.com/xanademos/Views/TransclusionOverlayView.js) 第13行定义 `stubOffset = 10.0`。

**裁剪边界**：[OpenXanadu.css](https://xanadu.com/xanademos/OpenXanadu.css) 第56–100行：外围容器 overflow hidden，Canvas 占整个可视区；上下层容器可横向滚动。文档正文第101–112行禁止横向溢出、可纵向滚动。Canvas 的多边形算法没有针对每个文档可视矩形的 `clip()`；因此不能把它描述成已实现精细的“文档边界范围裁剪”。其视觉越界是否产生瑕疵需要可运行环境确认。

### 来源条带布局

**实际源码**：[ViewLayout.js](https://xanadu.com/xanademos/ViewLayout/ViewLayout.js) 第22–63、87–117行：中央文档 left=30%，CSS 宽40%；两侧来源沿各自方向以6.66%视口宽为步距排列。来源用 `zoomIn(3)`；[DocumentView.js](https://xanadu.com/xanademos/Views/DocumentView.js) 第206–242行算出缩放 `1 / 2^3 = 1/8`，先保留宽40%的排版，再缩成约5%视口宽的来源条带。高度同时放大到800%再缩放，标题/来源头部移到不可见位置，正文从顶部开始，尽可能在高条带中呈现长文。

左右分配由 [TransclusionTransformer.js](https://xanadu.com/xanademos/Data/Transformer/TransclusionTransformer.js) 第101–155行首次遇到新文档时切换左右标记，已有文档对复用原标记。该处注释说所有来源放右侧，但**实际代码会切换左右**，不能只按注释解释。来源条带不是浏览器窗口、叠放卡片或任意拖动的3D平面；此版按布局函数重排。左侧溢出时整体平移并调整横向滚动位置（ViewLayout 第117–130行）。

## 2014：输入、导航、恢复

| 操作 | 源码明确行为 | 一手定位 |
|---|---|---|
| hover | 已审阅主事件注册和文档视图，没有 mouseover/mousemove/pointerenter 处理；没有找到 hover 高亮或预览的证据。 | [OpenXanaduMain.js](https://xanadu.com/xanademos/OpenXanaduMain.js) 事件注册；[DocumentView.js](https://xanadu.com/xanademos/Views/DocumentView.js) |
| 点击桥 | 在文档外的覆盖区域对实际桥形状做 hit-test，选中桥，切到双文档，并把两侧目标范围移到各自窗口中部。交叉桥命中会在遍历中覆盖命中ID，没有单独的选择菜单。 | Main 第113–142行；[Overlay](https://xanadu.com/xanademos/Views/TransclusionOverlayView.js) 第195–236行；[Navigation](https://xanadu.com/xanademos/Navigation/TransclusionNavigation.js) 第162–167、253–278行 |
| 点击来源条带或并排文档 | 该文档成为中央阅读文档，恢复它相连的来源/引用文档布局，并对当前选中的范围定位。 | Main 第143–174行 |
| 双文档布局 | 两文档恢复原始字号；左右分别 left=0 和 calc(60% - 4px)，各40%宽；中部留约20%的桥区，其余文档隐藏。只保留当前选定桥。 | [ViewLayout](https://xanadu.com/xanademos/ViewLayout/ViewLayout.js) 第156–205行 |
| 滚动 | 文档各自具有 scrollTop；每次滚动、缩放窗口或焦点变化，清空Canvas并重新画桥，使端点跟着正文位置变化。普通滚动未见强制同步所有文档；明确跳转到transclusion才同时对齐两侧范围。 | Main 第52–68、91、101–109行；Navigation 第253–278行 |
| Space+上下 | 在当前文档内选择上/下一个transclusion；导航逻辑按显示位置寻找邻近范围。 | Main 第179–210行；Navigation 第18–160行 |
| Space+左右 | 朝所连文档方向：中央文档 → 双文档桥 → 对侧文档居中；在双文档中往回可回中央模式。 | Main 第212–268行；Navigation 第191–250行 |
| Shift+Space | 在 Lonesome View（单文档）、Stub View（仅短桥头）、All Bridges 三种显示模式循环；双文档状态不允许这样切换。默认是All Bridges。 | Main 第271–315行；[Focus.js](https://xanadu.com/xanademos/Focus/Focus.js) 第42–68行；ViewLayout 第67–141行 |
| 关闭/恢复 | 没找到独立关闭按钮、撤销导航或浏览历史控件。可通过点击文档或方向导航退出双文档；单文档模式隐藏其他文档。`DocumentView.hide/display` 保存位置并移到屏幕下方，再恢复。此隐藏方式是性能绕过措施，不能当作用户应复制的交互规范。 | DocumentView 第123–203行；Main 第143–174行 |

### 路径、复用与版本的边界

来源追踪是**同一材料的原文范围与组装后范围之间可往返的直接连接**，不是把若干网页访问历史串成轨迹。原文条带可以放大居中，也能继续看引用范围外的上下文。[EDLTransformer](https://xanadu.com/xanademos/Data/Transformer/EDLTransformer.js) 第143–169行表明其依据是同一URL及字符范围。不能把任意语义相似内容画成同一种transclusion。

没有在上述实现中发现版本选择、版本时间线、跨版本对比或独立导航历史的数据/控件。这里只能说**本原型未发现**，不能推成 Xanadu 理论不支持版本。也不能把2014里所有连接解释成双向可编辑同步：源码实现的是从网络来源取片段，再显示联系。

### 原型特例

- [handleSource.js](https://xanadu.com/xanademos/handleSource.js) 第1–15行默认加载 `SampleContent/Xanadox/MoeJuste/1-zxcvb.xanadoc`，可用URL查询参数 `url` 替换。这是样例入口，不是通用的首页设计。
- [DocumentView.js](https://xanadu.com/xanademos/Views/DocumentView.js) 第201–205行注释说明把来源限制在1/8缩放，是当时 Firefox/Chrome 的表现限制，不能当成视觉设计不可改变的常量。
- [EDLRemoteSource.js](https://xanadu.com/xanademos/Data/RemoteSource/EDLRemoteSource.js) 第5–10行作者注释尚缺下载失败错误报告；当前只见loading标志并不证明引用关系为空。
- [Focus.js](https://xanadu.com/xanademos/Focus/Focus.js) 第3–5行注明当前内容URL在应用生命周期内只更新一次（截至2014-05-05），这不是成熟多文档工作区。

## 2016：xanaviewer 文档式演示

**作者说明**：[New Game in Town](https://www.youtube.com/watch?v=72M5kcnAL-4)，TheTedNelson，2016-08-29。视频解释蓝色框线是xanalinks，橙色框线是从别处带入的内容；点击让另一文档和可见桥出现，另一文档可滚动，再点击关闭；作者明确说这只是可能界面之一。Exa返回转录没有可靠时间戳，定位为谈及 `outlined in blue`、`outlined in Orange` 的连续段落。

**官方操作说明**：[TRY OUR SAMPLE XANADOC](https://xanadu.com/xuSampleXanadoc-D12.html)，2016-09-13：

1. 将样例EDL粘贴到viewer，按 `fulfill document` 并等待生成文档。
2. 把生成的文档窗口移到EDL窗口上，遮住EDL。这是原型界面整理步骤，并非通用“必须遮挡编辑器”的设计。
3. 点击蓝色区域跟随xanalink。链接页面打开后要向右移，桥才看得清楚；再次点击蓝色区域关闭桥。
4. 滚动原文档，点击橙色内容查看live sources/transclusions。来源窗在右侧出现，但连接可能拖向右下；官方要求继续滚动右侧来源窗，让对应片段进入可见位置。再次点击原区域关闭桥。

这份说明确证：**打开联系并不意味着替换当前阅读页；原文和关联文档同时留在场上，可以对照和滚动上下文。**它同时确证当时原型存在布局/定位问题，不能把“必须手动滚到桥端”拔高为理想设计。

颜色语义也不能倒灌进2014：2014颜色随文档对分配，2016蓝/橙明确区分link/transclusion。

[Understanding EDL](https://xanadu.com/xuEDL.html) 的 `WHAT'S IN THE EDL` 段：EDL包含 spans 和 xanalinks；[XANALINKS](https://xanadu.com/xanaLinks.html) 的 `A TABLE OF CONNECTIONS` 段：xanalink是独立连接表，可以连接一个或多个跨度/页面/文档，同一xanalink能被多个EDL复用且保持身份；带有特定意义的facets不在当前演示。这里证明的是数据模型及作者说明，不能据此补画演示中没显示的高级导航控件。

[Making Your Own Xanadoc](https://xanadu.com/YourXanadoc.html) 第2、4、5节说明内容先上传为稳定文本，给字符固定地址；span可连网络文本span、sourcedoc或xanadoc；还提供hide_new.xanalink.txt隐藏新写内容的来源显示。因此不是每一种材料都被强制永久画成来源条带。

## 检索覆盖与未知

`sources_reviewed = 25` 个成功审阅的一手URL（含1张官方图片）：oxuShot.png、官网首页、2014演示、xUniverse-D6、PurpData-D16、xuDemoPage、xuSampleXanadoc-D12、xuEDL、xanaLinks、YourXanadoc、TheTedNelson视频，加14个官方脚本/样式：OpenXanaduMain、OpenXanadu.css、DocumentView、TransclusionOverlayView、ViewLayout、TransclusionNavigation、Focus、KeyboardHandler、handleSource、TransclusionTransformer、CanvasUtility、UniqueVariableGenerators、EDLRemoteSource、EDLTransformer。两次perma.pub抓取失败不计入成功审阅。第三方结果只用于找线索，不作证据，也不计入该数字。

原始下载可回查：`/tmp/openxanadu-source/`；2014 HTML `/tmp/openxanadu-2014.html`；2016目录HTML `/tmp/openxanadu-demo-page.html`；作者说明 `/tmp/xUniverse-D6.html`。源码引用行号均对应2026-09-19从官方站点下载的文件。

没有确认到官方GitHub仓库；直接从官方演示引用的文件获取源码足以追溯该演示实现，不能因此把第三方fork称作官方。新版perma.pub的精确HTML/JS、hover、关闭后状态保持、版本显示目前未知；以后若取得实际浏览器结果，应另加证据，勿用2014填空。
