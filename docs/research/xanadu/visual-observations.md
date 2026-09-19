# 原始界面的直接视觉观察

2026-09-19，通过 Codex 内置浏览器打开原作者论文中的原始图片，并抽查作者视频。以下只记录实际看到的画面；不把静态截图当成动态交互或精确数值证据。

## XanaduSpace

- [Back to the Future 图 2，全景](https://www.xanadu.net/XanaduSpace/btf_files/fwDemoOrigins-panorama2.png)：多张不等高的长文本条围成带透视的空间布局；半透明红色连接面具有可辨的上下边界，接到文本上的高亮范围。它们不是页面中心之间的细线。部分连接横穿画面，存在覆盖与重叠。图中可见浅色连接；其类型应依正文图注而非凭截图猜测。不能从这一帧确定透明度数值或遮挡算法。
- [图 4，reading plane](https://www.xanadu.net/XanaduSpace/btf_files/xusp-LineOfFire.png)：右侧近景为较大的当前页和较小的旁读页；其余页在更远处缩小，仍显示文本条和连接。近景与远景之间是尺度、位置及透视的共同差别，不是把两张等宽卡片放在静态网格里。
- [图 5，transclusion](https://www.xanadu.net/XanaduSpace/btf_files/fwDemoOrigins-I_WillNotLieBelow.png)：同一引用在左右两个不同字号、不同上下文的文本页中高亮，长度相同的文本在屏幕上可以占不同高度。可见高亮从实际文字范围开始/结束，并非整段统一矩形框；右侧其余远页仍在。截图不能证明每一种换行/滚动情况的实现。
- [作者演示视频](https://www.youtube.com/watch?v=1yLNGUeHapA)：实际打开播放器并抽查了 4:52、5:07。可见近景长页与远处较小页同时存在，连接在阅读布局中呈现。未完整逐帧观看，未测动画时长/曲线，不能从视频推定鼠标悬停行为。键位和状态流转以原包 README/input 源码研究为准。

## OpenXanadu 2014

- [官方截图](https://xanadu.com/oxuShot.png)：中央宽正文，两边来源是窄而长的文本条；正文与来源上的同色范围通过有面积的多边形连接。可见多种半透明颜色、明确的首末行范围边界以及来源条的完整上下文。这是另一种布局，不应冒充 XanaduSpace 的三维 reading plane。
- 实际打开 [2014 演示](https://xanadu.com/xanademos/MoeJusteOrigins.html) 时，仅出现左上 X 图标，没有正文或可操作控件。因此本轮没有完成其运行时交互验证；后续报告的点击和键盘行为来自官方原始 JavaScript，须保留该证据等级。
- 官方指向的 `http://perma.pub/xanaviewer3/` 在当前浏览器返回 `ERR_EMPTY_RESPONSE`。未把该演示当作已经实测。

## 与当前 Sidebranch 的直接对照

本轮修改前，在本地真实 Reader 的 1280px 视口里，两张约等宽的正文并排；选中连接是一条青色曲线，从左文字范围中部跨过正文至右文字范围，其他连接还使用虚线。这与上面实际截图中的范围连接面和主次阅读尺度都有可见差异。这里只记录差异，不据此直接推定完整修复方案。

用户要求的屏幕边缘折页、无侧栏、AI 选文提问、编辑与 App UI 仍是项目约束。上述图片不能证明这些功能已存在于原型，亦不应拿原型的旧限制取消它们。
