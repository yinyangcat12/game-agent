# Atlas Play

Atlas Play 是一个全平台联网游戏发现助手。主界面根据玩家的平台、语言、预算、游玩时长、偏好类型和避雷项，实时搜索符合需求的真实游戏。

## 核心工作流

### 发现游戏

- 使用下拉选项和标签选择游戏平台、偏好语言、预算、游玩时长、类型和明确避开的内容。
- 联网搜索 PC、PlayStation、Xbox、Nintendo、移动端和云游戏平台，不局限于 Steam。
- 第一批返回最多 6 款游戏；用户可以继续搜索，下一批会排除已经展示的结果。
- 每款游戏提供推荐理由、注意事项、平台、匹配度和可核查来源链接。
- 不绑定 Steam 账号，不读取个人游戏库，也不提供购买管家或购买检查功能。

## 技术实现

- 前端：React、TypeScript、Vite。
- 服务端：Express。
- 联网研究：OpenAI Responses API、`web_search`、严格结构化 JSON 输出。
- 默认模型：`gpt-5.6-sol`，支持通过环境变量配置兼容请求地址。
- API Key 只在服务端读取，不会发送到浏览器。

## 配置

复制 `.env.example` 为 `.env`，配置：

- `OPENAI_API_KEY`：服务端 API Key。
- `OPENAI_BASE_URL`：可选的兼容请求地址。
- `OPENAI_MODEL`：可选，默认 `gpt-5.6-sol`。
- `OPENAI_WEB_SEARCH_TOOL`：可选，默认 `web_search`。
- `OPENAI_TIMEOUT_MS`：可选，单次模型研究超时，默认 `300000`（5 分钟）。
- `PORT`：可选，生产服务默认 `8787`。

耗时的联网功能使用后台研究任务：提交后立即返回任务编号，前端通过短轮询获取状态和最终结果。这样不会让浏览器维持一个可能被代理或网关中断的长请求。

## 启动与检查

```powershell
pnpm install
pnpm dev
```

生产模式：

```powershell
pnpm build
pnpm start
```

检查：

```powershell
pnpm test
pnpm build
```

## API

- `GET /api/status`：联网模型与发现功能状态。
- `GET /api/research-jobs/:jobId`：读取后台联网研究状态与结果。
- `POST /api/discover`：按偏好实时发现全平台游戏。
- `POST /api/guide`：按游戏名生成联网攻略（保留接口能力）。

## 关键文件

- `src/App.tsx`：发现游戏主界面与结果展示。
- `src/styles.css`：响应式视觉系统。
- `src/types.ts`：结构化业务类型。
- `src/api.ts`：前端 API 客户端。
- `server/openai.ts`：联网研究、提示词、结构化输出校验。
- `server/index.ts`：HTTP API 与静态资源服务。
