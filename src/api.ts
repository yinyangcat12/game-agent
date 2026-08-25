import type {
  ApiStatus, CompanionRequest, CompanionResponse, DecisionRequest, DecisionResponse, DiscoverOptions, DiscoverResponse, GameGuideResponse,
} from "./types";

type ResearchJob<T> = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  pollAfterMs?: number;
  result?: T;
  error?: string;
};

class ResearchJobFailed extends Error {}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function readJson(response: Response) {
  try { return await response.json(); }
  catch { throw new Error(`服务返回了无法解析的响应（HTTP ${response.status}）。`); }
}

async function pollResearchJob<T>(job: ResearchJob<T>): Promise<T> {
  let pollAfterMs = Math.max(800, job.pollAfterMs || 1200);
  let transientFailures = 0;

  while (true) {
    await wait(pollAfterMs);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`/api/research-jobs/${encodeURIComponent(job.jobId)}`, { signal: controller.signal });
      const data = await readJson(response) as ResearchJob<T> & { error?: string };
      if (response.status === 404) throw new ResearchJobFailed(data.error || "这次联网研究已经失效，请重新提交。");
      if (!response.ok) throw new Error(data.error || "无法读取联网研究进度。");
      transientFailures = 0;

      if (data.status === "completed") {
        if (data.result === undefined) throw new Error("联网研究已完成，但没有返回结果。");
        return data.result;
      }
      if (data.status === "failed") throw new ResearchJobFailed(data.error || "联网研究失败，请重试。");
      pollAfterMs = Math.max(800, data.pollAfterMs || pollAfterMs);
    } catch (error) {
      if (error instanceof ResearchJobFailed) throw error;
      transientFailures += 1;
      if (transientFailures >= 4) {
        if (error instanceof DOMException && error.name === "AbortError") throw new Error("读取研究进度多次超时，请确认本地服务仍在运行后重试。");
        throw error;
      }
      pollAfterMs = Math.min(5000, pollAfterMs + 800);
    } finally {
      window.clearTimeout(timer);
    }
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试。");
  if (response.status === 202 && data?.jobId) return pollResearchJob<T>(data as ResearchJob<T>);
  return data as T;
}

export const api = {
  status: () => fetch("/api/status").then((response) => response.json() as Promise<ApiStatus>),
  cover: (sourceUrl: string, imageUrl = "", id = "") => {
    const params = new URLSearchParams({ sourceUrl, imageUrl, id });
    return fetch(`/api/game-cover?${params.toString()}`).then(async (response) => {
      const data = await readJson(response) as { imageUrl?: string; source?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "无法获取游戏封面。");
      return data;
    });
  },
  decide: (request: DecisionRequest) => post<DecisionResponse>("/api/decide", request),
  companion: (request: CompanionRequest) => post<CompanionResponse>("/api/companion", request),
  discover: (prompt: string, options: DiscoverOptions = {}) => post<DiscoverResponse>("/api/discover", { prompt, ...options }),
  guide: (game: string, goal: string) => post<GameGuideResponse>("/api/guide", { game, goal }),
};
