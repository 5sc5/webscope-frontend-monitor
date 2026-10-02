# 开发与验证

需要 Node.js 22.12+，首次安装使用 `npm ci`，初始化使用 `npm run db:setup`。本项目采用 npm workspaces，提交时应保留根 `package-lock.json`。

## 修改约定

- SDK 改动应覆盖业务原有调用语义、事件字段、脱敏、队列上限、重试和销毁行为。
- API 改动应覆盖输入校验、事件去重、聚合、性能统计和数据持久化。
- 看板与验证台改动需检查桌面和手机布局，以及空数据、加载和错误状态。
- 不提交数据库、真实事件、凭据、`.env`、运行日志或构建缓存。需要说明配置时修改 `.env.example`。
- 测量结果需说明环境和样本范围，不将合成实验写成生产性能提升。

## 提交前检查

```sh
npm test
npm run build
npm audit --audit-level=high
git diff --check
```

涉及上报性能时另运行 `npm run benchmark`，并检查生成的 JSON。耗时因环境波动，不设置固定毫秒数作为通过条件。

服务端测试使用独立临时数据库，不依赖开发库已有事件。Windows 下重新执行数据库初始化前先停止开发 API，避免 Prisma 引擎文件锁；不要为了测试清空业务数据库。

提交问题时附上环境、复现步骤和脱敏后的错误信息。安全问题按 [SECURITY.md](SECURITY.md) 处理。
