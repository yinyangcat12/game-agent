# Atlas Play 公网部署

这个项目是 React 前端 + Express 服务端，不能只部署 `dist` 静态目录；模型 API Key 必须配置在服务端环境变量中。

## Vercel 部署（最方便）

项目已经包含 Vercel 可识别的 Express 根入口 `app.ts`。Vercel 构建时，Vite 会把前端输出到 `public`，API 与页面使用同一个域名。

1. 在 Vercel 选择 **Add New → Project**，导入 GitHub 仓库 `yinyangcat12/game-agent`。
2. 保持以下设置：
   - Framework Preset：`Other`；
   - Root Directory：留空，使用仓库根目录；
   - Build Command：`pnpm build`，也可以留给 Vercel 自动识别；
   - Output Directory：不要手动填写；
   - Install Command：`pnpm install --frozen-lockfile`，也可以留给 Vercel 自动识别。
3. 在 **Environment Variables** 中逐项添加：
   - `OPENAI_API_KEY`：你的真实服务端 API Key；
   - `OPENAI_BASE_URL`：你 `.env` 中正在使用的请求地址；
   - `OPENAI_MODEL`：`gpt-5.6-sol`；
   - `OPENAI_WEB_SEARCH_TOOL`：`web_search`；
   - `OPENAI_TIMEOUT_MS`：`270000`。
4. 每个变量都勾选 Production、Preview 和 Development，点击 **Deploy**。
5. 部署完成后，Vercel 会给出类似 `https://game-agent-xxx.vercel.app` 的公开网址。任何人都可以直接打开该链接，无需 GitHub 账号。

如果项目已经在 Vercel 创建：进入项目的 **Settings → Environment Variables** 添加以上变量，然后到 **Deployments** 对最新部署选择 **Redeploy**。

验证地址：

```text
https://你的域名.vercel.app/healthz
```

成功时会返回 `{"ok":true,"service":"atlas-play"}`。

## Render 部署（推荐）

1. 将整个项目上传到 GitHub/GitLab 仓库，确认 `.env` 没有被提交。
2. 在 Render 创建 Web Service，连接这个仓库，或使用仓库中的 `render.yaml`。
3. Render 会使用以下命令构建和启动：

```text
corepack enable && pnpm install --frozen-lockfile && pnpm build
pnpm start
```

4. 在 Render 的 Environment Variables 中填写：
   - `OPENAI_API_KEY`：你的模型 API Key；
   - `OPENAI_BASE_URL`：你的请求地址；
   - `OPENAI_MODEL`：`gpt-5.6-sol`；
   - `OPENAI_WEB_SEARCH_TOOL`：`web_search`；
   - `OPENAI_TIMEOUT_MS`：`300000`。
5. 部署完成后访问 Render 分配的 `onrender.com` 地址。

## Docker 部署

项目已包含 `Dockerfile`，可使用：

```powershell
docker build -t atlas-play .
docker run --env-file .env -p 8787:8787 atlas-play
```

生产环境不要把 `.env` 打包进镜像或提交到代码仓库。

## 健康检查

服务提供 `GET /healthz`，成功时返回：

```json
{"ok":true,"service":"atlas-play"}
```

## 重要说明

研究任务目前保存在进程内存中。单实例部署适合当前版本；如果以后扩展到多个实例，需要把任务队列迁移到 Redis 或数据库。
