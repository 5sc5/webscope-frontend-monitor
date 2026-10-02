# WebScope API

Koa + TypeScript + Prisma + SQLite 的本地监控数据服务。默认监听 `127.0.0.1:3301`，可通过 `PORT` 和 `HOST` 调整。默认数据库为 `prisma/dev.db`。

在项目根目录安装依赖后：

```powershell
npm run db:setup --workspace @webscope/server
npm run dev --workspace @webscope/server
```

`db:setup` 生成 Prisma Client、同步表结构并注册 `playground` 和 `survey-platform` 两个应用，保留已有数据，不生成虚构监控事件。可使用 `DATABASE_URL` 指定其他 SQLite 文件。

在 Windows 上重新执行 `db:setup` 前先停止开发服务，避免正在使用的 Prisma 原生引擎被系统锁定。

## 数据接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| GET / POST | `/api/applications` | 查询 / 注册应用 |
| POST | `/api/events` | 批量接收 `{appId, events}` |
| GET | `/api/events` | 分页查询事件 |
| GET | `/api/events/:id` | 查询事件详情 |
| GET | `/api/issues` | 查询同类错误聚合 |
| GET | `/api/overview` | 查询性能和异常统计 |

事件查询支持 `appId`、`type`、`issueId`、`keyword`、`from`、`to`、`page`、`pageSize`；时间支持 ISO 字符串或毫秒时间戳。分页默认每页 20 条，最大 100 条。事件和问题查询不指定时间时查询全部历史数据；总览不指定时间时查询最近 24 小时。

`POST /api/events` 最多 100 条、请求体最多 256 KB，单条 `detail` 和 `breadcrumbs` 各最多 16 KB；所有事件先校验再写入。事件 ID 为幂等键，重试不会增加重复记录，响应为 `{accepted, duplicates}`。SDK 与服务端均应限制采集范围；服务端额外清理密码、Token、Authorization、Cookie 等字段及敏感 URL 参数。

## 指标口径

- `errorCount`：JS、Promise、资源和主动上报的自定义错误数量。
- `errorRate`：失败请求数 / 请求数 × 100；失败指状态为 0 或 HTTP 状态 ≥ 400，无请求时为 0。
- `slowRequestCount`：耗时超过 1000 ms 的请求数量。
- 性能统计使用近邻秩 P75，样本为空时返回 `p75: null`、`rating: null`，不伪造 0。
- 错误聚合按照应用、错误类型、标准化消息和首个堆栈位置生成 SHA-256 指纹；数字仅规范化三位及以上连续整数，避免无条件删除全部上下文。此基础实现没有 Source Map 还原功能。

`/api/test/success`、`/api/test/failure`、`/api/test/slow` 分别提供真实 200、500、约 1200 ms 延迟响应，供验证台检测网络采集。

## 验证

```powershell
npm run build --workspace @webscope/server
npm run test --workspace @webscope/server
```

集成测试创建临时 SQLite 数据库，覆盖批量校验、并发去重、敏感信息清理、时间筛选、P75 和失败率计算、问题聚合、持久化及请求验证端点；不会修改开发数据库。
