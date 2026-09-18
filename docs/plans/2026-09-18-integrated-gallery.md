# Memos 图库：Lifemory 复用与清理记录

2026-09-18。本轮在已有的未提交图库实现上完成前端收敛；Lifemory 源代码未改动。本文替代旧版实施描述，历史跨站同步草案不是当前部署方案。

## 分析结论

图库继续作为 Memo / Attachment 的视图。Memos 已有的权限、附件地址和分享足够承载图库；需要复用的是 Lifemory 的浏览布局、信息呈现和成熟布局库。整套 Lifemory SPA 依赖静态 manifest、Jotai、站点上下文及 Builder，直接嵌入会产生两套数据与路由状态，不能直接带入 Memos。

本次使用 `afilmory-web-design` 对照 Lifemory `DESIGN.md`，使用 `ponytail-review` 审查重复实现与无调用的扩展参数。设计规范适用于图库局部；Memos 的 Lucide、Base UI、React Query 和翻译机制继续复用。

| 功能 | 来源 / 最终实现 |
| --- | --- |
| 瀑布流 | 与 Lifemory 相同的 `masonic@4.1.0`；4px 间距，移动端最小列宽 150px、桌面 250px，最多 8 列，按元数据预留图片高度 |
| 顶部浮层 | 移植 `packages/ui/src/progressive-blur/index.tsx` 的顶部渐进模糊配方，48px 页头 |
| 照片详情 | `/gallery/photos/:uid` 直接打开唯一查看器，不再额外叠加另一套详情大图 |
| 图像显示 | 沿用已有缩略图到原图的加载与 Memos Motion Photo 播放；保留 Lifemory `ContainedImageFrame` 的等比容纳逻辑 |
| 颜色 | 移植 `apps/web/src/lib/color.ts` 的对比度约束；背景和 Inspector 使用照片色彩，低对比照片不会让强调色消失 |
| 专业信息 | 移植 Inspector 的密集 Row / Section 结构，继续复用 `buildMediaMetadataDisplay`；影调和直方图公式来源于 Lifemory Builder |
| 说明、标签 | `GalleryMemoDetails` 复用 Memos 内容组件；信息面板关闭时卸载，图库不显示或加载评论 |
| 分享 / 可见性 | `GallerySharePanel` 复用 Lifemory 的标题、链接和缩略图布局，复用 `MemoShareLinks`、`useUpdateMemo` 和原有授权；公开永久链接和笔记范围授权分享保留 |

## 已清理和修正

- `GalleryGrid.tsx`: native: CSS 分栏及自行计算列数改为 `masonic`；分页、重排或删除结果时重置布局缓存，避免错位。
- `GalleryPageHeader.tsx`: shrink: 桌面按钮组、手机菜单和两套标签表单合并为一个筛选浮层；筛选写 URL 并 replace 历史。
- `GalleryPhotoView.tsx`: delete: 删除第二套大图、工具条、详情键盘监听及 `viewer=1` 开关。逐张浏览 replace 当前照片记录，关闭时返回原图库历史项，允许 ScrollRestoration 恢复滚动位置。
- `GalleryPhotoInspector.tsx`: delete: 删除调试 JSON 和重复元数据说明；删除桌面 / 内嵌查看器变体。桌面与手机均有可用关闭入口。
- `GalleryProgressiveImage.tsx`: delete: 删除额外 `new Image()` 预加载、无调用的 `isCurrent` / `enableZoom` / `onVisualReadyChange` 参数。原图失败后保留有名称的缩略图；缩放时两层图像共同移动。
- `PreviewImageDialog.tsx`: delete: 删除已无业务调用的图库外部导航、初始详情和自定义详情面板参数，保留普通附件预览功能。
- `GalleryThumbnailStrip.tsx` / `GalleryExifSection.tsx`: delete: 删除无调用的显示开关、导出和 RowGroup；统一预览地址解析。
- `gallery.css` / `RootLayout.tsx`: delete: 删除失效页头、移动页头、CSS 分栏规则及重复主题包裹；图库不再挂载隐藏的桌面侧栏。
- 文案：删除宣传描述、评论归属常驻说明、元数据设置常驻提示及调试 JSON 说明；可见性影响范围只在确认框说明，分享范围只在分享面板说明。直方图旁保留简短“基于预览图取样”，避免误认原始数据。
- 分享按钮仅对作者或普通公开照片读者出现；分享 token 读者不会看到无法使用的分享或编辑操作。
- `GalleryComments.tsx`: delete: 按用户要求删除图库评论入口、组件、加载逻辑及失效中英文文案；笔记页面的评论功能不变。
- `GallerySharePanel.tsx`: 复用 Lifemory 分享面板布局，显示当前附件缩略图，等比容纳竖图，支持加载失败重试，采用照片色彩和半透明面板。公开读者也先查看预览，作者才挂载链接管理查询。普通笔记与图库共用 `MemoShareLinks`，没有第二套分享接口或权限实现。
- 快捷键只在查看器作用域处理，缩放、输入控件、信息面板和嵌套弹窗不会触发误翻页。Escape 先关闭面板，再退出照片。

所有复用来源、版本和修改说明见 `web/src/components/Gallery/NOTICE.md`，上游许可证保存于同目录 `LICENSE`。按用户要求删除页面底部的 Powered by / Source / License 文本，源码中的来源记录保留。

## 数据链路审查

- `server/gallery/gallery.go` 的 List / Get 在进程内复用已有 MemoService / AttachmentService，照片使用 attachment UID，没有新增照片发布状态或权限表。
- `server/router/frontend/gallery.go` 为 JSON 与 HTML 提供请求身份、权限调用、no-store 和分享 token 处理；Go 提供照片 HTML 与 OG 信息，无 Next.js 服务。
- `useGalleryQueries.ts` 使用 protobuf JSON 解码和按用户隔离的 React Query 缓存；无图片笔记页仍按 nextPageToken 继续分页，查询错误不显示旧照片。
- 照片可见性跟随整篇笔记；修改入口继续确认整篇笔记和全部附件受影响。分享 token 仍按笔记范围授权，不获得其他笔记或评论权限。
- 上传、原图保真与专业字段提取沿用工作区已有实现，本轮未重写 Go / proto / 存储。

## 实现边界

没有新增 Builder、Webhook、同步数据库、定时任务、远端 manifest 或 Lifemory 运行时。该复用范围是 Memos 图库的浏览布局、查看器和摄影信息呈现；不声称完整移植 Lifemory 的 WebGL/WebGPU、HDR 解码、Thumbhash、FLIP 入场、全页地图或所有筛选能力。格式和专业字段仍以 Memos 附件元数据与浏览器实际支持为准。

## 验证

- TypeScript 与本次修改文件 Biome 检查通过；全量 Biome 关闭 formatter 后规则检查通过。
- 前端完整测试：129 个文件、928 项通过；pnpm build 与 pnpm release 均成功。
- 实际浏览器检查使用隔离复制的本地 SQLite 测试数据与当前 Vite 源码：桌面和 390×844 窄屏的网格、筛选、照片查看、信息面板、分享弹窗、关闭返回均正常；浏览器控制台无 error。
- 测试覆盖无图页继续分页、层级标签、权限刷新移除旧图、笔记可见性确认、分享读者限制、公开永久链接、缩放时禁止翻页、照片导航返回原图库历史项及 Escape 分层关闭。
- 本轮分享调整补充验证缩略图失败重试、公开读者不请求作者链接、现有分享 token 保留照片路由、创建和撤销复用原接口、普通笔记分享不回归。桌面与 390×844 实际浏览器中图片加载成功，分享面板无横向溢出，图库页脚与评论入口已移除。
- `pnpm lint` 的全量格式检查仍受到工作区既有 CRLF 换行差异阻塞，未批量改写无关文件；生产构建保留已有大 chunk 警告。

本轮未访问真实 R2、未部署线上实例、未创建提交。开发预览使用本地测试数据，不能替代线上上传验收。
