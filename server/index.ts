import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guideFromCatalog } from "./catalog.js";
import type { CompanionRequest, DecisionFeedback, PlayerProfile } from "../src/types.js";
import type { DiscoverSearchOptions } from "./openai.js";
import { companionLive, decideLive, discoverLive, getApiStatus, guideLive } from "./openai.js";
import { resolveGameCover } from "./cover.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const jobTtlMs = 20 * 60 * 1000;

type ResearchJob = {
  status: "queued" | "running" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
};

const researchJobs = new Map<string, ResearchJob>();

function researchErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("aborted")) return "联网研究超过模型端允许时长。任务已安全结束，请缩短需求后重试；如果频繁发生，请检查请求地址的超时限制。";
  if (message.includes("429") || message.includes("rate limit")) return "模型服务当前请求过多，请稍等片刻再试。";
  if (message.includes("401") || message.includes("403") || message.includes("unauthorized") || message.includes("forbidden")) return "模型服务拒绝了请求，请检查 API Key、模型权限和请求地址。";
  return "联网模型请求失败，请检查 API Key、模型权限、请求地址和网络连接后重试。";
}

function enqueueResearch(res: express.Response, task: () => Promise<unknown>) {
  const jobId = randomUUID();
  const now = Date.now();
  researchJobs.set(jobId, { status: "queued", createdAt: now, updatedAt: now });

  void Promise.resolve().then(async () => {
    const job = researchJobs.get(jobId);
    if (!job) return;
    job.status = "running";
    job.updatedAt = Date.now();
    try {
      job.result = await task();
      job.status = "completed";
    } catch (error) {
      console.error(`research job ${jobId} failed`, error);
      job.error = researchErrorMessage(error);
      job.status = "failed";
    } finally {
      job.updatedAt = Date.now();
    }
  });

  return res.status(202).json({ jobId, status: "queued", pollAfterMs: 1200 });
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - jobTtlMs;
  for (const [jobId, job] of researchJobs) {
    if ((job.status === "completed" || job.status === "failed") && job.updatedAt < cutoff) researchJobs.delete(jobId);
  }
}, 60_000);
cleanupTimer.unref();

function requireLive(res: express.Response) {
  if (getApiStatus().liveResearch) return true;
  res.status(503).json({ error: "此功能需要启用联网模型。请先在 .env 中配置 API Key 与请求地址。" });
  return false;
}

function cleanStrings(value: unknown, limit = 30) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit) : [];
}

function cleanProfile(value: any): PlayerProfile {
  return {
    platforms: cleanStrings(value?.platforms), subscriptions: cleanStrings(value?.subscriptions),
    region: typeof value?.region === "string" ? value.region.slice(0, 80) : "中国大陆",
    language: typeof value?.language === "string" ? value.language.slice(0, 80) : "简体中文",
    sessionMinutes: Math.max(15, Math.min(480, Number(value?.sessionMinutes) || 90)),
    budget: typeof value?.budget === "string" ? value.budget.slice(0, 100) : "",
    preferredGenres: cleanStrings(value?.preferredGenres), avoid: typeof value?.avoid === "string" ? value.avoid.slice(0, 1000) : "",
    ownedGames: typeof value?.ownedGames === "string" ? value.ownedGames.slice(0, 3000) : "",
  };
}

app.use(express.json({ limit: "1mb" }));

app.get("/api/status", (_req, res) => {
  const status = getApiStatus();
  res.json({ ...status, onlineDiscovery: status.liveResearch, guideOnline: status.liveResearch, features: { discovery: status.liveResearch, guide: true } });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "atlas-play" });
});

app.get("/api/game-cover", async (req, res) => {
  const sourceUrl = typeof req.query.sourceUrl === "string" ? req.query.sourceUrl.slice(0, 2000) : "";
  const imageUrl = typeof req.query.imageUrl === "string" ? req.query.imageUrl.slice(0, 2000) : "";
  const id = typeof req.query.id === "string" ? req.query.id.slice(0, 200) : "";
  if (!sourceUrl && !imageUrl) return res.status(400).json({ error: "缺少游戏来源或图片地址。" });
  const result = await resolveGameCover(sourceUrl, imageUrl, id);
  res.setHeader("Cache-Control", "public, max-age=1800");
  return res.json(result);
});

app.get("/api/research-jobs/:jobId", (req, res) => {
  const job = researchJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "没有找到这次联网研究，可能是服务重启或任务已过期。" });
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    jobId: req.params.jobId,
    status: job.status,
    pollAfterMs: job.status === "running" ? 1500 : 1000,
    ...(job.status === "completed" ? { result: job.result } : {}),
    ...(job.status === "failed" ? { error: job.error } : {}),
  });
});

app.post("/api/decide", (req, res) => {
  const situation = typeof req.body?.situation === "string" ? req.body.situation.trim().slice(0, 3000) : "";
  if (!situation) return res.status(400).json({ error: "请先告诉我你今晚的状态和想玩的感觉。" });
  if (!requireLive(res)) return;
  const feedback: DecisionFeedback[] = Array.isArray(req.body?.feedback) ? req.body.feedback.slice(-30).filter((item: any) => item && typeof item.title === "string") : [];
  return enqueueResearch(res, () => decideLive({ situation, profile: cleanProfile(req.body?.profile), feedback, excludeTitles: cleanStrings(req.body?.excludeTitles) }));
});

app.post("/api/companion", (req, res) => {
  const game = typeof req.body?.game === "string" ? req.body.game.trim().slice(0, 200) : "";
  if (!game) return res.status(400).json({ error: "请先输入正在玩的游戏。" });
  if (!requireLive(res)) return;
  const request: CompanionRequest = {
    game, platform: typeof req.body?.platform === "string" ? req.body.platform.slice(0, 100) : "未说明",
    version: typeof req.body?.version === "string" ? req.body.version.slice(0, 100) : "当前公开版本",
    progress: typeof req.body?.progress === "string" ? req.body.progress.slice(0, 1500) : "刚开始",
    sessionMinutes: Math.max(15, Math.min(480, Number(req.body?.sessionMinutes) || 60)),
    goal: typeof req.body?.goal === "string" ? req.body.goal.slice(0, 1000) : "稳步推进",
    problem: typeof req.body?.problem === "string" ? req.body.problem.slice(0, 1000) : "",
  };
  return enqueueResearch(res, () => companionLive(request));
});

app.post("/api/discover", (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "请先描述你的偏好。" });
  if (!requireLive(res)) return;
  const options: DiscoverSearchOptions = {
    page: Number.isInteger(req.body?.page) && req.body.page > 0 ? req.body.page : 1,
    limit: Number.isInteger(req.body?.limit) && req.body.limit > 0 ? Math.min(6, req.body.limit) : 6,
    excludeIds: cleanStrings(req.body?.excludeIds, 80), excludeTitles: cleanStrings(req.body?.excludeTitles, 80),
  };
  return enqueueResearch(res, () => discoverLive(prompt, options));
});

app.post("/api/guide", async (req, res) => {
  const game = typeof req.body?.game === "string" ? req.body.game.trim() : "";
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!game) return res.status(400).json({ error: "请先输入游戏名。" });
  if (getApiStatus().liveResearch) {
    return enqueueResearch(res, () => guideLive(game, goal));
  }
  return res.json(guideFromCatalog(game, goal));
});

const dist = path.resolve(here, "../dist");
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, "index.html"), (error) => {
  if (error) res.status(404).json({ error: "Atlas Play server is running." });
}));
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => console.log(`Atlas Play server listening on ${host}:${port}`));
