import OpenAI from "openai";
import { z } from "zod";
import type {
  CompanionRequest, CompanionResponse, DecisionRequest, DecisionResponse, DiscoverResponse, GameGuideResponse, SourceLink,
} from "../src/types.js";

const sourceSchema = z.object({ title: z.string(), url: z.string().url() });
const gameSchema = z.object({
  id: z.string(), title: z.string(), year: z.number(), genres: z.array(z.string()), tags: z.array(z.string()),
  platforms: z.array(z.string()), match: z.number(), playtime: z.string(), why: z.string(), watchOut: z.string(), sourceUrl: z.string(), officialUrl: z.string().optional(), imageUrl: z.string().optional(),
});
const decisionGameSchema = gameSchema.extend({
  verdict: z.string(), fitSignals: z.array(z.string()), tradeoffs: z.array(z.string()),
  tonightPlan: z.array(z.string()), availabilitySummary: z.string(),
});
const decisionSchema = z.object({
  headline: z.string(), rationale: z.string(), confidence: z.number(), primary: decisionGameSchema,
  alternatives: z.array(decisionGameSchema), rejected: z.array(z.object({ title: z.string(), reason: z.string() })),
  interpretedContext: z.array(z.string()), sources: z.array(sourceSchema), note: z.string(),
});
const companionSchema = z.object({
  game: z.string(), sessionTitle: z.string(), stateSummary: z.string(), nextSessionMinutes: z.number(),
  steps: z.array(z.object({ minuteRange: z.string(), action: z.string(), why: z.string(), fallback: z.string() })),
  avoidNow: z.array(z.string()), checkpoint: z.string(), questionsToTrack: z.array(z.string()), sources: z.array(sourceSchema), note: z.string(),
});
const discoverSchema = z.object({ summary: z.string(), interpretedPreferences: z.array(z.string()), games: z.array(gameSchema), sources: z.array(sourceSchema), note: z.string() });
const guideSchema = z.object({
  game: z.string(), overview: z.string(), difficulty: z.string(), estimatedMastery: z.string(),
  coreLoop: z.array(z.string()), firstSession: z.array(z.string()),
  phases: z.array(z.object({ title: z.string(), goal: z.string(), steps: z.array(z.string()) })),
  builds: z.array(z.object({ name: z.string(), bestFor: z.string(), priorities: z.array(z.string()) })),
  practicePlan: z.array(z.string()), mistakes: z.array(z.string()), checklist: z.array(z.string()), sources: z.array(sourceSchema), note: z.string(),
});

const apiKey = () => process.env.OPENAI_API_KEY?.trim() || "";
const model = () => process.env.OPENAI_MODEL?.trim() || "gpt-5.6-sol";
const baseUrl = () => process.env.OPENAI_BASE_URL?.trim() || process.env.OPENAI_BASEURL?.trim() || process.env.BASE_URL?.trim() || process.env["Base url"]?.trim() || "";
const timeoutMs = () => {
  const configured = Number(process.env.OPENAI_TIMEOUT_MS || 300000);
  return Number.isFinite(configured) ? Math.max(30000, configured) : 300000;
};

const stringArray = { type: "array", items: { type: "string" } };
const sourceJson = { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, required: ["title", "url"], additionalProperties: false } };
const gameJson = {
  type: "object", properties: {
    id: { type: "string" }, title: { type: "string" }, year: { type: "number" }, genres: stringArray, tags: stringArray,
    platforms: stringArray, match: { type: "number" }, playtime: { type: "string" }, why: { type: "string" },
    watchOut: { type: "string" }, sourceUrl: { type: "string" }, officialUrl: { type: "string" }, imageUrl: { type: "string" },
  }, required: ["id", "title", "year", "genres", "tags", "platforms", "match", "playtime", "why", "watchOut", "sourceUrl", "officialUrl", "imageUrl"], additionalProperties: false,
};
const decisionGameJson = {
  ...gameJson, properties: {
    ...gameJson.properties, verdict: { type: "string" }, fitSignals: stringArray, tradeoffs: stringArray,
    tonightPlan: stringArray, availabilitySummary: { type: "string" },
  }, required: [...gameJson.required, "verdict", "fitSignals", "tradeoffs", "tonightPlan", "availabilitySummary"],
};
const decisionJson = {
  type: "object", properties: {
    headline: { type: "string" }, rationale: { type: "string" }, confidence: { type: "number" }, primary: decisionGameJson,
    alternatives: { type: "array", minItems: 2, maxItems: 2, items: decisionGameJson },
    rejected: { type: "array", minItems: 2, maxItems: 2, items: { type: "object", properties: { title: { type: "string" }, reason: { type: "string" } }, required: ["title", "reason"], additionalProperties: false } },
    interpretedContext: stringArray, sources: sourceJson, note: { type: "string" },
  }, required: ["headline", "rationale", "confidence", "primary", "alternatives", "rejected", "interpretedContext", "sources", "note"], additionalProperties: false,
};
const companionJson = {
  type: "object", properties: {
    game: { type: "string" }, sessionTitle: { type: "string" }, stateSummary: { type: "string" }, nextSessionMinutes: { type: "number" },
    steps: { type: "array", minItems: 3, maxItems: 6, items: { type: "object", properties: { minuteRange: { type: "string" }, action: { type: "string" }, why: { type: "string" }, fallback: { type: "string" } }, required: ["minuteRange", "action", "why", "fallback"], additionalProperties: false } },
    avoidNow: stringArray, checkpoint: { type: "string" }, questionsToTrack: stringArray, sources: sourceJson, note: { type: "string" },
  }, required: ["game", "sessionTitle", "stateSummary", "nextSessionMinutes", "steps", "avoidNow", "checkpoint", "questionsToTrack", "sources", "note"], additionalProperties: false,
};
const discoverJson = { type: "object", properties: { summary: { type: "string" }, interpretedPreferences: stringArray, games: { type: "array", items: gameJson }, sources: sourceJson, note: { type: "string" } }, required: ["summary", "interpretedPreferences", "games", "sources", "note"], additionalProperties: false };
const guideJson = { type: "object", properties: { game: { type: "string" }, overview: { type: "string" }, difficulty: { type: "string" }, estimatedMastery: { type: "string" }, coreLoop: stringArray, firstSession: stringArray, phases: { type: "array", items: { type: "object", properties: { title: { type: "string" }, goal: { type: "string" }, steps: stringArray }, required: ["title", "goal", "steps"], additionalProperties: false } }, builds: { type: "array", items: { type: "object", properties: { name: { type: "string" }, bestFor: { type: "string" }, priorities: stringArray }, required: ["name", "bestFor", "priorities"], additionalProperties: false } }, practicePlan: stringArray, mistakes: stringArray, checklist: stringArray, sources: sourceJson, note: { type: "string" } }, required: ["game", "overview", "difficulty", "estimatedMastery", "coreLoop", "firstSession", "phases", "builds", "practicePlan", "mistakes", "checklist", "sources", "note"], additionalProperties: false };

export function getApiStatus() {
  const configured = Boolean(apiKey());
  return { liveResearch: configured, model: model(), apiKeyConfigured: configured, baseUrlConfigured: Boolean(baseUrl()) };
}

function sourcesFromResponse(response: any): SourceLink[] {
  const result: SourceLink[] = [];
  for (const item of response?.output || []) {
    for (const source of item?.action?.sources || []) if (source?.url) result.push({ title: source.title || source.url, url: source.url });
    for (const content of item?.content || []) for (const annotation of content?.annotations || []) if (annotation?.url) result.push({ title: annotation.title || annotation.url, url: annotation.url });
  }
  return dedupeSources(result);
}

function dedupeSources(sources: SourceLink[], limit = 16) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.url) return false;
    let key = source.url;
    try {
      const url = new URL(source.url);
      for (const parameter of ["curator_clanid", "l", "mobile-app", "pxdate", "theme", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"]) url.searchParams.delete(parameter);
      url.hash = "";
      key = url.toString().replace(/\/$/, "");
    } catch { /* Keep the original URL as the dedupe key. */ }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function jsonFrom(response: any) { return JSON.parse(String(response?.output_text || "").trim()); }

async function callResearch(instructions: string, input: string, schema: object) {
  const client = new OpenAI({ apiKey: apiKey(), baseURL: baseUrl() || undefined, timeout: timeoutMs(), maxRetries: 1 });
  const tool = process.env.OPENAI_WEB_SEARCH_TOOL?.trim() || "web_search";
  return client.responses.create({
    model: model(), tools: [{ type: tool }], include: ["web_search_call.action.sources"], instructions, input,
    text: { format: { type: "json_schema", name: "atlas_play_result", strict: true, schema } },
  } as any);
}

export async function decideLive(request: DecisionRequest): Promise<DecisionResponse> {
  const response = await callResearch(
    "你是 Atlas Play 的游戏决策引擎。你的任务不是罗列游戏，而是结合玩家设备、订阅、预算、时间、偏好和历史反馈，跨全平台联网研究后做出一个明确决定。检索 PC、PlayStation、Xbox、Nintendo、移动端、云游戏平台与订阅服务；合并同一游戏的多平台信息。优先官方商店、发行商和可靠评测。只推荐真实存在且当前可玩的游戏。主推荐只能有一个，必须解释取舍；另外提供两个用途不同的备选和两个被淘汰候选。不要编造 URL。只输出严格 JSON。",
    JSON.stringify({ task: "决定玩家下一款最该玩的游戏", currentSituation: request.situation, playerProfile: request.profile, recentFeedback: request.feedback.slice(-30), excludedThisRound: (request.excludeTitles || []).slice(-30), outputRules: ["primary 是唯一主选择", "alternatives 恰好两个", "rejected 恰好两个", "match 为 0-100", "tonightPlan 给出本次开玩即可执行的 3-5 步", "sourceUrl 优先官方游戏页或平台商店页"] }),
    decisionJson,
  );
  const data = decisionSchema.parse(jsonFrom(response));
  const confidence = data.confidence <= 1 ? data.confidence * 100 : data.confidence;
  return { ...data, mode: "live", generatedAt: new Date().toISOString(), confidence: Math.round(Math.max(0, Math.min(100, confidence))), sources: dedupeSources([...data.sources, ...sourcesFromResponse(response)]), note: `${data.note} 决策已结合玩家档案、反馈记忆与全平台联网来源。` };
}

export async function companionLive(request: CompanionRequest): Promise<CompanionResponse> {
  const response = await callResearch(
    "你是 Atlas Play 的正在游玩执行伴侣。根据玩家的准确进度、平台、版本、可用时间和卡点，研究当前可靠资料，产出一次可以立刻照做的游玩计划。严格控制剧透：不得泄露玩家所述进度之后的剧情、Boss、地点或奖励；如果进度模糊，采取更保守的无剧透方案。版本敏感信息必须联网核实，无法核实就明确写未核实。只输出严格 JSON。",
    JSON.stringify({ ...request, task: "为下一次游玩制定分段执行计划", outputRules: ["steps 3-6 步且分钟总量不超过 sessionMinutes", "每步包含失败时的 fallback", "checkpoint 是本次停止点", "建议具体但不越过玩家当前剧情进度"] }),
    companionJson,
  );
  const data = companionSchema.parse(jsonFrom(response));
  return { ...data, mode: "live", nextSessionMinutes: request.sessionMinutes, sources: dedupeSources([...data.sources, ...sourcesFromResponse(response)]), note: `${data.note} 版本与机制信息已联网研究；仍请以游戏内当前版本为准。` };
}

export type DiscoverSearchOptions = { page?: number; limit?: number; excludeIds?: string[]; excludeTitles?: string[] };
export async function discoverLive(prompt: string, options: DiscoverSearchOptions = {}): Promise<DiscoverResponse> {
  const page = options.page || 1;
  const limit = Math.max(1, Math.min(6, options.limit || 6));
  const excluded = [...(options.excludeIds || []), ...(options.excludeTitles || [])].filter(Boolean);
  const response = await callResearch(
    "你是 Atlas Play 的全平台游戏研究员。根据用户偏好研究真实存在、当前仍可玩的电子游戏。必须跨平台检索，不要只搜索 Steam。覆盖 PC、PlayStation、Xbox、Nintendo、移动端、云游戏和订阅服务。优先官方来源和高质量评测。只输出严格 JSON。每个游戏都必须返回 imageUrl 和 officialUrl 字段：如果联网资料中能核实可靠的直接封面图或 header 图片地址就填写；如果能核实游戏官网或发行商的该游戏官方产品页就填写 officialUrl；无法核实就返回空字符串，绝对不要编造链接或图片地址。",
    `用户偏好：${prompt}。当前是第 ${page} 批。返回最多 ${limit} 个新游戏，不要返回：${excluded.slice(0, 80).join("、") || "无"}。每个游戏包含完整字段。sourceUrl 必须是用户实际可以前往游玩或购买该游戏的游戏平台/商店详情页，不要返回通用帮助页；officialUrl 只能填写已核实的游戏官网或发行商官方产品页，没有或无法确认时填空字符串，不要把百科、新闻、社区、论坛或攻略页当作官网；imageUrl 无法核实时必须填空字符串。`,
    discoverJson,
  );
  const data = discoverSchema.parse(jsonFrom(response));
  return { ...data, mode: "live", page, hasMore: true, sources: dedupeSources([...data.sources, ...sourcesFromResponse(response)]), note: `${data.note} 已通过全平台联网研究生成。` };
}

export async function guideLive(game: string, goal?: string): Promise<GameGuideResponse> {
  const response = await callResearch(
    "你是 Atlas Play 的新手到熟练攻略教练。研究指定游戏的当前版本、通用核心机制和可靠的实战方法，优先官方资料与高质量攻略来源。不编造未经核实的补丁专属数字，不把推测写成事实，也不要剧透关键剧情。攻略必须具体、可执行，帮助完全没听过或没玩过这款游戏的人先理解核心循环，再建立稳定打法，最后知道如何继续进阶。只输出严格 JSON。",
    `游戏：${game}。用户目标：${goal || "从零开始顺利入门并建立自己的玩法"}。请返回一份完整、可执行、层次清晰的攻略，不要只写摘要：先用 4-6 条解释核心循环，再用 6-10 条写“第一次打开游戏到第一小时”的行动清单；随后按“前几次游玩、形成稳定打法、继续进阶”的顺序组织 3-5 个阶段，每阶段 4-8 个具体步骤；提供 2-4 个适合不同目标的起步方案、5-8 条练习计划、5-8 个常见错误和 6-10 条入门检查清单。每一条都要具体到操作、判断或复盘方式，不要泛泛而谈；不剧透关键剧情，版本敏感信息要注明核查范围。`,
    guideJson,
  );
  const data = guideSchema.parse(jsonFrom(response));
  return { ...data, mode: "live", sources: dedupeSources([...data.sources, ...sourcesFromResponse(response)]), note: `${data.note} 已通过联网研究生成。` };
}
