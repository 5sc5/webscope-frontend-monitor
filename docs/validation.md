# 本地验证记录

验证日期：2026-10-02。环境：Windows、Node.js v26.0.0、Codex 内置 Chromium 浏览器。所有事件由 SDK 验证台真实触发，不是预置统计数据。

## 自动化验证

- `npm test`：20 项通过，SDK 13 项、服务端 7 项。
- `npm run build`：SDK、API、监控看板、验证台均通过。
- `npm audit --audit-level=high`：0 漏洞。

## 浏览器操作验证

- JS / Promise / 图片错误、Fetch 200 / 500 / 慢请求 / 中断、XHR 均能触发并入库。
- 50 条同类自定义异常聚合为 1 个问题、发生次数 50；可切换唯一事件样本并查看堆栈及 Breadcrumb。
- 事件类型、关键字筛选和分页可用；`GET failed` 搜索返回 2 条失败请求。
- 模拟慢接口设置 1,200 ms，一次实际请求约 1,236 ms；取消请求记录状态 0、耗时 103.3 ms。这里只验证采集准确性，不是优化前后对比。
- 敏感字段验证通过，演示 password / token / authorization / cookie 值未保留，普通字段 `public-note` 保留。
- 暂停 SDK 后 Fetch / XHR 仍返回 200，监控队列与发送计数没有因这些业务操作增加；恢复后请求和路由事件正常上报。
- 应用创建、自动切换、配置复制、新应用空状态、Escape 关闭弹窗均通过。本机验证库保留一个 `ui-validation` 应用作为验证结果；数据库不随仓库上传，克隆后初始化的库不包含该应用及本次验证数据。
- 桌面及约 390 px 手机布局已检查；修复表格辅助文本导致的页面溢出，手机宽度与页面滚动宽度均为 390 px，宽表格仅在内部滚动。
- 监控看板控制台未发现 error / warn；验证台主动制造的异常属于测试场景。

一次浏览器检查中的 Web Vitals P75 为 LCP 1.31 s、INP 56 ms、CLS 0.008、FCP 1.31 s、TTFB 52 ms。这些是本机开发验证页的少量样本，刷新、交互、HMR 和设备会影响结果，不能作为生产表现或性能优化收益。

## 可复现基准

详见 [benchmark.json](./benchmark.json)。SDK 构建产物 gzip 7,065 字节；1,000 条事件逐条发送需 1,000 次请求，按 10 条批量需 100 次，减少 90%，两组丢弃数均为 0。该实验使用 Node + JSDOM 和内存响应，不衡量真实网络延迟或页面渲染时间。

## 截图

- [监控总览](./images/overview.jpg)
- [验证台手机布局](./images/playground-mobile.jpg)
- [问卷平台请求采集](./images/survey-request.jpg)
