# 空间阅读实施记录入口

2026-09-19：早期实施契约已撤销，历史内容可在提交 `1493527` 中查阅。其独立连接选择、从当前文档单端跟随和窄屏顺序双页规则，不能用于约束本轮修正。

实现中的概念及公开接口由源码定义；不在文档中复制可从类型、组件和状态转换恢复的架构。跨模块决策的原因记录在[阅读意图与视口边缘](../adr/0001-reading-intents-and-viewport-edges.md)和[范围阅读与共同呈现](../adr/0002-range-reading-and-coordinated-presentation.md)。后者取代前者中与连接导航方向相关的旧约束，异步所有权与边缘可达性的要求继续成立。

[研究差距表](../research/xanadu/project-gaps.md)保留修正前的证据和操作验收要求，不作为当前实现状态报告。服务端身份、文档版本、问题、答案及关系的持久边界继续独立于空间的渲染方式。

后续决策见[先保证阅读可用性](../adr/0003-reading-usability-before-spatial-detail.md)、[空间视图与纸页位置](../adr/0004-spatial-view-and-paper-placement.md)和[阅读器语义颜色](../adr/0005-semantic-reader-colors.md)。自由安排是直接操作产生的视图状态，不要求用户先切换到另一种工作模式；它取代早期禁止纸页拖动和窄屏空间输入的限制。
