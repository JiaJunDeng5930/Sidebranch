# Xanadu 原设计：视觉结构与内容语义证据

只读研究；未读取或修改 Sidebranch 实现。使用 Exa Search 技能，审阅 4 份 Nelson 一手文献；它们具有共同作者及设计谱系，不能当作 4 个独立意见。所有图形说明来自作者正文或图注，**本报告没有亲自观察图像**，不把文字解析结果冒充视觉观察。以下区分概念要求、原型表现及对 Sidebranch 的推导。

## 核心发现

Xanadu 的可见连接属于写作结构：它连接文档中的实际内容，供人并排阅读、比较、评论及追溯来源。其基本区分是 content link 连接不同内容，transclusion 让具有相同身份的内容在不同上下文中的出现可被识别。三维空间、颜色、带宽和线型都是需要按版本核实的表现；它们不能取代内容身份与范围。[The Xanadu Universe，开篇及 PAGE AND DOCUMENT LOGIC](https://xanadu.com/xUniverse-D6)；[Xanalogical Structure，A LITERARY STRUCTURE WITH TWO FUNDAMENTALLY DIFFERENT FORMS OF CONNECTION](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)。

## 原设计不变量与直接证据

| 主题 | 原作者明确陈述及准确边界 | 一手出处与小节 |
|---|---|---|
| 内容身份 | Transclusion 表示同一内容可知、可见地出现在多个位置。文中不是把任意相似文本、相关段落或一般关系都叫 transclusion。实现可使用缓存或别名，重要的是保持可识别的内容身份。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，A LITERARY STRUCTURE WITH TWO FUNDAMENTALLY DIFFERENT FORMS OF CONNECTION；USE IN PLACE: REFERENTIAL FLUID MEDIA |
| link 与 transclusion | 两种连接相互独立：link 表达不同内容之间的关系；transclusion 表达同一内容的复用。被链接内容可以被复用，连接本身亦可作为独立内容复用。因此不能靠统一的“关系”类别抹平两者。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，A LITERARY STRUCTURE…；THE CONTENT LINK |
| 具体范围 | 评论例子明确连接两端的整个字符范围，不只是一个代表点。xu88 的两端各自可以是内容列表；Transliterature 的 from-set、to-set 都可以包含多个 span，允许一条评论关联多个片段。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，THE CONTENT LINK，Fig.12–13；[Transliterature](https://web.archive.org/web/20130718151249/http:/transliterature.org/)，LESS-SIMPLE CLINKS |
| “不是点”的边界 | 不能把上述结论夸大成所有 link 都禁止指向单字符。Transliterature 在段落表示的讨论中允许指向首字符，也允许覆盖全段；这是特定 structural/decorative clink 的选择。重要的是保留实际声明的范围与关系语义。 | [Transliterature](https://web.archive.org/web/20130718151249/http:/transliterature.org/)，CLINK TYPES. Example 1: THE HANDLING OF PARAGRAPHS |
| 窗口不是语义端点 | 1972 transpointing windows 的描述是一个窗口内实际内容连接另一窗口内实际内容，窗口滚动或移动时仍附着该内容。窗口边框、页面中心和三维卡片位置因此不是这个连接的语义定义。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，PARALLEL DOCUMENTS AND TRANSPOINTING WINDOWS，Fig.2–4 |
| 注释和连接分离 | Barker 的评论文字属于文档 B；表示该评论关系的 link 是独立、可寻址的实体。它不是埋在被评论文章内部的标记。任何人可以为已发布内容添加关系，多个评论和连接可以重叠。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，CONTENT LINKS, AND HOW THEY SURVIVE；THE CONTENT LINK，Fig.12–15 |
| 双向追踪与方向 | Transliterature 用 from-set/left side 和 to-set/right side 区分评论及被评论内容；甚至其单向指向的 weblink clink 也规定可从两侧追踪。所以语义角色有方向与可双向导航是两件事。字体、段落等 clink 不是普通可跟随链接，规范明确有些 clink 不可跟随。 | [Transliterature](https://web.archive.org/web/20130718151249/http:/transliterature.org/)，LESS-SIMPLE CLINKS；CLINK TYPES IN GENERAL；INTERACTION |
| 来源与其他出现 | Transpathic stepping 要能从当前内容到原始上下文，也能到当前驻留的另一份共享内容文档。2005/2007 规范默认维护一层“引用→原始来源”，并通过相同来源地址发现其他在内存中文档的共享内容。这不是保证任何时刻都穷尽全网的所有出现。 | [Transliterature](https://web.archive.org/web/20130718151249/http:/transliterature.org/)，INTERACTION；3. Transliterary Connections；FOLLOWING CLINKS TO OTHER THAN ORIGINAL CONTEXT |
| 版本比较 | 原作者把并排比较、显示旧草稿中哪些内容进入新版、哪些被留下列为核心使用方式。共享内容通过稳定地址比较发现；不是靠文字相似度猜测。原图 Fig.20 特别说明两端共享内容长度相等，指内容长度，不能直接解释为屏幕上等高。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，USES OF THIS VISUALIZATION，Fig.6；FINDING TRANSCLUSIONS，Fig.20 |
| 版本改变后的 link | 插入内容后 link 仍连到原有字符，可在新版分裂为多个范围；删除一部分后仍附着剩余字符。若当前版本不再有对应字符，可回到尚有该内容的旧版。Nelson 称其为意义的推定继承，没有声称字节幸存就自动证明原评论仍语义正确。 | [Xanalogical Structure](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)，HOW LINKS DON'T BREAK；MECHANICS OF LINK DISPLAY；POWERS OF THE CONTENT LINK |
| 可读且可追踪 | XanaduSpace 的 reading plane 同时显示可读的当前页与相关 companion page；选中连接后另一端进入并排位置，用户可将注意转到另一页。它保留周围页面和连接以解释当前上下文。原文针对“可见但数量很多仍难跟随”的问题提出这个机制。 | [Back to the Future](https://www.xanadu.net/XanaduSpace/btf.htm)，A SYSTEM OF SIDE-BY-SIDE VIEWING，Fig.4–5 |
| 多视图共同契约 | Transliterature 要求始终可取得 parallel tracks 视图。三维、飞行、滚动等表现都是可选的多种视图；其中的内容仍应支持连接和 transclusion 追踪。 | [Transliterature](https://web.archive.org/web/20130718151249/http:/transliterature.org/)，NEW FORMS OF RENDERING AND INTERACTION；INTERACTION |

## 不同原型和图示的可变细节

本表全部属于**原作者文字／图注证据**，不是直接看图得出的结论。

| 原型／材料 | 文字证据 | 不能外推的结论 |
|---|---|---|
| 1965 示意图，2000 ACM 文中的 Fig.1 | Braided lines 表示相同内容的 transclusion；dotted lines 表示仅链接。矩形是段落样条目的序列，预期按列并排。见 [PARALLEL DOCUMENTS AND TRANSPOINTING WINDOWS](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)。 | 不等于所有年代都必须使用编织线或虚线。 |
| 1965 图在 Back to the Future 中的 Fig.1 | 该文解释 light lines 是一个或多个 links，heavy lines 是一个或多个 transclusions。见 [RETURNING TO THE ORIGINAL VIEW](https://www.xanadu.net/XanaduSpace/btf.htm)。 | 不应自行把两文的线型措辞合成一份像素规范；应看对应原图确定表现。 |
| XanaduSpace，Back to the Future 的截图 | 明确写 dark bands 是 links，red bands 是 transclusions；两者可以任意多次重叠。见 [RETURNING TO THE ORIGINAL VIEW，Fig.2](https://www.xanadu.net/XanaduSpace/btf.htm)。 | 不能将全部连接都说成彩色 transclusion，也不能因另一原型用了其他颜色而否认这里的 dark/red 区分。 |
| Transliterature 的抽象图示 | 两条垂直条之间单线连接表示 clink，双线连接表示 transclusion，双线表示两端相同。见 [3. Transliterary Connections，Visualizing Transclusion](https://web.archive.org/web/20130718151249/http:/transliterature.org/)。 | 这是语义示意，不是规定所有用户界面只能画单／双线。 |
| 1999 PYXI 的《独立宣言》版本对比 | Fig.5 用颜色突显 transclusions 与 differences；正文未在本段给出每种颜色的固定含义。见 [PARALLEL DOCUMENTS…，Fig.5](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)。 | 不能从“有颜色”推断和 XanaduSpace dark/red 一致。 |
| 重叠连接的表现 | ACM 文明确把颜色、透明度、缩减为线列为可能的界面办法。见 [POWERS OF THE CONTENT LINK](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)。 | 不能声称固定颜色、必须实体宽带或永远显示全部连接是普遍原则。 |
| XanaduSpace 2007 的物体组织 | 页面是 3D slabs，高亮文本区域是独立 tetroids，以 beams 连接，页面、文本块及连接一起移动变形。见 [The Xanadu Universe，A PARALLEL LITERATURE OF INTERCONNECTED DOCUMENTS](https://xanadu.com/xUniverse-D6)。 | 不能将页面平板之间任意连接等同于精确文本范围之间的 beams。 |
| OpenXanadu 2014 的能力范围 | Nelson 的概述只把该原型已显示关系称为引用来源 transclusions，认为 xanalinks 可以添加。见 [同上 OpenXanadu 段](https://xanadu.com/xUniverse-D6)。 | 不能把该原型的展示范围当成整个 Xanadu 只存在 transclusion 的证据。此处不涉及操作研究。 |

## 对 Sidebranch 的约束（推导，不冒充官方规格）

1. 先定义关系表达什么，再选择形状。若只是评论、解释、分支生成或语义关联，应作为相应 link 或项目自己的关系；没有共享内容身份的依据不能命名为 transclusion。
2. 每个可见关系应能回答两端实际是哪段内容。端点范围要在文本上可辨；连到页面边缘可以是裁切或布线表现，但必须能定位到实际内容，不能把卡片中心当作语义端点。
3. 滚动、换行、窗口移动和重新布局后，连接应继续指向同一内容。跨版本表现应依据保留的内容身份，而不是把旧像素坐标或段落序号当作身份。
4. 双向导航应保留关系角色：从评论找到原文、从原文找到评论，并让用户知道当前查看哪一侧。来源关系也应保留“原始上下文”和“其他共享出现”的区别。
5. 若复现 XanaduSpace 的视觉语法，就明确使用该版本的 dark link/red transclusion 规则；若建立 Sidebranch 自己的配色，应明确这是项目方案，并提供稳定可读的区分方式。不能从“彩带很好看”反推每条彩带都代表同一类关系。
6. 三维鸟瞰之后必须有实际阅读和跟随范围的能力。并排阅读、选定关系、看到另一端及上下文应是可验证任务；只显示页面群和关联大轮廓不足以达到原设计的使用目的。
7. 对许多重叠连接，应提供选择、逐项查看或过滤等机制，保持可追踪；原规范没有要求把所有关系永远铺满屏幕。
8. 版本比较的“相同”应能解释为共享身份的内容；替换／改写后的相似片段可有 correspondence link，不能继续假称同一 transclusion。这个 distinction 在 Transliterature 的 CLINK TYPES IN GENERAL 中有明确依据：correspondence clink 可用于被替换的原 transcluded sections。

## 未能确认与研究边界

- 未亲自观察原始图片；具体色值、透明度、带边界、锚定几何、箭头与空间遮挡必须由原图观察补齐。
- 没有找到跨所有 Xanadu 原型统一固定的色谱或“每一种关系一个固定颜色”的总规范；已确认的是各篇明确描述的个别表现。
- 没有把双向追踪解读为无方向关系，也没有找到“每条连接都必须带箭头”的普遍要求。
- 此处没有核实屏外端点的精确显示规则、用户选择范围的鼠标／键盘手势、XanaduSpace 1.0 的具体输入及 OpenXanadu 操作。
- Transliterature 当前站点直接抓取超时，采用 Internet Archive 的 2013-07-18 存档；文首是 2007-06-17 修订提示与 2005-10-22 正文标识，且自称 agenda/sketch。不能称其为已经实现所有条目的最终规范。

## 审阅资料

- `sources_reviewed: 4`（4 个去重的一手文献；Exa 搜索候选未通读者不计入）
- `images_personally_viewed: 0`
- [The Xanadu Universe，xUniverse-D6 15.10.16](https://xanadu.com/xUniverse-D6)
- [Xanalogical Structure, Needed Now More than Ever: Parallel Documents, Deep Links to Content, Deep Versioning, and Deep Re-Use](https://xanadu.com/XUarchive/ACMpiece/XuDation-D18.html)
- [Back to the Future](https://www.xanadu.net/XanaduSpace/btf.htm)
- [Transliterature, A Humanist Format for Re-Usable Documents and Media（2013 存档）](https://web.archive.org/web/20130718151249/http:/transliterature.org/)
- 原始抓取文本：`/tmp/xanadu-primary-0.txt`（前三篇及第四篇抓取失败记录）；`/tmp/xanadu-transliterature-0.txt`（存档规范）。
