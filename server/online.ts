import type { DiscoverResponse, GameRecommendation } from "../src/types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type SteamSearchItem = {
  type?: string;
  name?: string;
  id?: number;
  tiny_image?: string;
  tagMatch?: boolean;
  matchedTagIds?: string[];
};

type SteamDetails = {
  type?: string;
  name?: string;
  short_description?: string;
  detailed_description?: string;
  header_image?: string;
  developers?: string[];
  publishers?: string[];
  genres?: Array<{ description?: string }>;
  categories?: Array<{ description?: string }>;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  release_date?: { date?: string; coming_soon?: boolean };
};

type Candidate = { item: SteamSearchItem; details?: SteamDetails };

const execFileAsync = promisify(execFile);

const STEAM_SEARCH = "https://store.steampowered.com/api/storesearch/";
const STEAM_RESULTS = "https://store.steampowered.com/search/results/";
const STEAM_DETAILS = "https://store.steampowered.com/api/appdetails";

const queryMap: Array<[RegExp, string[]]> = [
  [/探索|未知|开放世界|冒险/, ["exploration", "open world"]],
  [/剧情|故事|叙事|角色|选择/, ["story rich", "narrative"]],
  [/短|不长|太长|太久|短流程|单次|碎片|短局/, ["short", "bite-sized"]],
  [/策略|经营|规划|资源|建造/, ["strategy", "management"]],
  [/肉鸽|肉鸽|重玩|roguelike|roguelite/, ["roguelike", "replayable"]],
  [/恐怖|克苏鲁|惊悚|压迫/, ["horror", "atmospheric"]],
  [/科幻|宇宙|太空/, ["sci-fi", "space"]],
  [/治愈|轻松|放松|种田|生活/, ["cozy", "relaxing"]],
  [/动作|挑战|高难度|boss/, ["action", "challenging"]],
  [/卡牌|构筑|牌组/, ["deckbuilding", "card game"]],
  [/合作|联机|多人|朋友/, ["co-op", "multiplayer"]],
  [/rpg|角色扮演/i, ["RPG"]],
];

const steamTagMap: Array<[RegExp, string]> = [
  [/探索|未知|开放世界|冒险/, "3834"], // Exploration
  [/剧情|故事|叙事|角色|选择/, "1742"], // Story Rich
  [/短|不长|太长|太久|短流程|单次|碎片|短局/, "4234"], // Short
  [/策略|经营|规划|资源|建造/, "9"], // Strategy
  [/肉鸽|重玩|roguelike|roguelite/i, "1716"], // Roguelike
  [/动作|挑战|高难度|boss/i, "19"], // Action
];

export function buildSteamTagIds(prompt: string) {
  return Array.from(new Set(steamTagMap.filter(([pattern]) => pattern.test(prompt)).map(([, tag]) => tag))).slice(0, 3);
}

const queryTerms = [
  ["探索", "exploration"], ["未知", "exploration"], ["开放世界", "open world"], ["剧情", "story rich"],
  ["叙事", "narrative"], ["短流程", "short"], ["短局", "short"], ["策略", "strategy"], ["经营", "management"],
  ["肉鸽", "roguelike"], ["恐怖", "horror"], ["克苏鲁", "horror"], ["科幻", "sci-fi"], ["治愈", "cozy"],
  ["动作", "action"], ["高难度", "challenging"], ["卡牌", "deckbuilding"], ["合作", "co-op"],
] as const;

function compact(value: string) {
  return decodeHtml(value).toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function buildSteamQueries(prompt: string) {
  const queries = new Set<string>();
  for (const [pattern, terms] of queryMap) if (pattern.test(prompt)) terms.forEach((term) => queries.add(term));
  const direct = queryTerms.filter(([term]) => prompt.includes(term)).map(([, english]) => english);
  if (direct.length >= 2) queries.add(direct.slice(0, 3).join(" "));
  if (!queries.size) queries.add("indie game");
  return Array.from(queries).slice(0, 5);
}

async function fetchJson<T>(url: string, timeoutMs = 7000): Promise<T> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "AtlasPlay/0.2" } });
    if (!response.ok) throw new Error(`Steam request failed with ${response.status}`);
    return await response.json() as T;
  } catch (fetchError) {
    // Some Windows network environments allow system curl while Node fetch times out.
    try {
      const executable = process.platform === "win32" ? "curl.exe" : "curl";
      const seconds = Math.max(3, Math.ceil(timeoutMs / 1000));
      const result = await execFileAsync(executable, ["-sS", "-L", "--max-time", String(seconds), "-A", "AtlasPlay/0.2", url], { maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(result.stdout) as T;
    } catch {
      throw fetchError;
    }
  }
}

async function searchSteam(term: string, tagIds: string[] = []) {
  try {
    // Steam search results are ranked by reviews and understand tags as well as names.
    const params = new URLSearchParams({
      query: tagIds.length ? "" : term, start: "0", count: "40", dynamic_data: "",
      tags: tagIds.join(","),
      sort_by: "Reviews_DESC", infinite: "1", cc: "us", l: "english",
    });
    const data = await fetchJson<{ results_html?: string }>(`${STEAM_RESULTS}?${params}`, 9000);
    const html = data.results_html || "";
    const items: SteamSearchItem[] = [];
    const rowPattern = /<a[^>]+data-ds-appid="(\d+)"[\s\S]*?<span class="title">([\s\S]*?)<\/span>[\s\S]*?<\/a>/g;
    for (const match of html.matchAll(rowPattern)) {
      const row = match[0];
      const image = row.match(/<div class="search_capsule"><img src="([^"]+)/)?.[1];
      items.push({ type: "app", id: Number(match[1]), name: decodeHtml(match[2]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), tiny_image: image, tagMatch: tagIds.length > 0, matchedTagIds: [...tagIds] });
    }
    if (items.length) return items.filter((item) => item.id && item.name);
  } catch {
    // Fall through to the public JSON endpoint when the HTML search endpoint is unavailable.
  }

  const url = `${STEAM_SEARCH}?term=${encodeURIComponent(term)}&l=english&cc=us`;
  const data = await fetchJson<{ items?: SteamSearchItem[] }>(url, 9000);
  return (data.items || []).filter((item) => item.type === "app" && item.id && item.name);
}

async function getDetails(appId: number) {
  const data = await fetchJson<Record<string, { success?: boolean; data?: SteamDetails }>>(`${STEAM_DETAILS}?appids=${appId}&l=english&cc=us`, 6000);
  const entry = data[String(appId)];
  return entry?.success ? entry.data : undefined;
}

function platforms(details?: SteamDetails, item?: SteamSearchItem) {
  const values = details?.platforms;
  if (!values) return item?.tiny_image ? ["PC"] : ["Steam"];
  const result: string[] = [];
  if (values.windows) result.push("PC");
  if (values.mac) result.push("Mac");
  if (values.linux) result.push("Linux");
  return result.length ? result : ["Steam"];
}

function candidateText(candidate: Candidate) {
  const details = candidate.details;
  return compact([
    candidate.item.name || "", details?.name || "", details?.short_description || "", details?.detailed_description || "",
    ...(details?.genres || []).map((item) => item.description || ""),
    ...(details?.categories || []).map((item) => item.description || ""),
  ].join(" "));
}

function competitiveSignal(text: string) {
  return /\bpvp\b|competitive|battle royale|moba|esports|arena shooter|ranked matchmaking/.test(text);
}

function scoreCandidate(candidate: Candidate, prompt: string) {
  const haystack = candidateText(candidate);
  const requested = queryTerms.filter(([term]) => prompt.includes(term));
  const matchedTerms = requested.filter(([, english]) => haystack.includes(english)).length;
  const englishMatches = buildSteamQueries(prompt).filter((term) => haystack.includes(term.toLowerCase())).length;
  const dislikesCompetitive = /(不|不要|不想|避免|讨厌|不太想)[^。！？,，；;]{0,16}(纯竞技|竞技|pvp|联机对战|多人对战|competitive|battle royale)/i.test(prompt)
    || (/(不|不要|不想|避免|讨厌|不太想)/i.test(prompt) && /纯竞技|竞技|pvp|competitive|battle royale/i.test(prompt));
  const competitive = competitiveSignal(haystack);
  const matchedTags = candidate.item.matchedTagIds?.length || (candidate.item.tagMatch ? 1 : 0);
  let match = 48 + matchedTags * 14;
  match += matchedTerms * 9 + englishMatches * 4;
  if (!candidate.details) match -= 10;
  if (dislikesCompetitive && competitive) match -= 38;
  return { match: Math.max(20, Math.min(96, match)), haystack, competitive, dislikesCompetitive };
}

function yearFrom(details?: SteamDetails) {
  const match = details?.release_date?.date?.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function tagsFor(candidate: Candidate, prompt: string) {
  const details = candidate.details;
  const source = compact([
    details?.short_description || "", ...(details?.genres || []).map((item) => item.description || ""),
    ...(details?.categories || []).map((item) => item.description || ""), candidate.item.name || "",
  ].join(" "));
  const labels: Array<[string, RegExp]> = [
    ["探索", /explor|open world|adventure/], ["剧情", /story|narrative|choice|character/], ["动作", /action|combat/],
    ["策略", /strategy|management|simulation/], ["恐怖", /horror|dark|atmospheric/], ["科幻", /sci-fi|space|science fiction/],
    ["肉鸽", /rogue|replayable/], ["卡牌", /card|deck/], ["合作", /co-op|cooperative|multiplayer/], ["独立游戏", /indie/],
  ];
  const tags = labels.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  if (/短|不长|太长|太久|短流程|短局/.test(prompt) && !tags.includes("短流程")) tags.push("待核实流程");
  return tags.slice(0, 4).length ? tags.slice(0, 4) : ["Steam 在线结果"];
}

function toRecommendation(candidate: Candidate, prompt: string): GameRecommendation {
  const details = candidate.details;
  const item = candidate.item;
  const title = details?.name || item.name || "Unknown game";
  const { match } = scoreCandidate(candidate, prompt);
  const shortMatch = candidate.item.matchedTagIds?.includes("4234") || false;
  const genres = (details?.genres || []).map((genre) => genre.description || "").filter(Boolean).slice(0, 4);
  const platformList = platforms(details, item);
  const description = compact(details?.short_description || "");
  return {
    id: String(item.id), title, year: yearFrom(details), genres, tags: tagsFor(candidate, prompt), platforms: platformList,
    match, shortMatch, playtime: shortMatch ? "Steam 短流程标签命中；具体时长以商店页为准" : /短|不长|太长|太久|短流程|短局/.test(prompt) ? "短流程要求未命中，建议核实" : "时长以商店与玩家资料为准",
    why: description ? `网上资料显示：${description.slice(0, 150)}${description.length > 150 ? "…" : ""}` : "根据 Steam 实时搜索结果与标签匹配。",
    watchOut: details?.release_date?.coming_soon ? "尚未正式发售，内容和发布日期可能变化。" : "这是实时商店结果，建议打开来源页确认版本、平台和评价。",
    sourceUrl: `https://store.steampowered.com/app/${item.id}/`,
    imageUrl: details?.header_image || item.tiny_image,
  };
}

function onlineLabels(prompt: string) {
  const labels: string[] = [];
  if (/探索|未知|开放世界|冒险/i.test(prompt)) labels.push("探索未知");
  if (/剧情|故事|叙事|角色|选择/i.test(prompt)) labels.push("剧情与叙事");
  if (/短|不长|太长|太久|短流程|单次|碎片|短局/i.test(prompt)) labels.push("短流程");
  if (/策略|经营|规划|资源|建造/i.test(prompt)) labels.push("策略经营");
  if (/肉鸽|重玩|roguelike|roguelite/i.test(prompt)) labels.push("肉鸽重玩");
  if (/恐怖|克苏鲁|惊悚|压迫/i.test(prompt)) labels.push("恐怖氛围");
  if (/治愈|轻松|放松|种田|生活/i.test(prompt)) labels.push("治愈放松");
  if (/(不|不要|不想|避免|讨厌|不太想)[^。！？,，；;]{0,16}(纯竞技|竞技|pvp|联机对战|多人对战|competitive|battle royale)/i.test(prompt) || (/(不|不要|不想|避免|讨厌|不太想)/i.test(prompt) && /纯竞技|竞技|pvp|competitive|battle royale/i.test(prompt))) labels.push("排除纯竞技");
  return labels;
}

export type OnlineDiscoverOptions = { page?: number; excludeIds?: string[]; excludeTitles?: string[] };

export async function discoverOnline(prompt: string, options: OnlineDiscoverOptions = {}): Promise<DiscoverResponse> {
  const page = options.page || 1;
  const excludedIds = new Set((options.excludeIds || []).map(String));
  const excludedTitles = new Set((options.excludeTitles || []).map((title) => title.trim().toLowerCase()));
  const tagIds = buildSteamTagIds(prompt);
  const queries = buildSteamQueries(prompt);
  // Steam 的多标签交集接口可能返回空集；分别搜索每个要求标签，再合并标签命中数。
  const batches = tagIds.length
    ? await Promise.all(tagIds.map((tagId) => searchSteam("", [tagId])))
    : [await searchSteam(queries[0])];
  const unique = new Map<number, SteamSearchItem>();
  batches.flat().forEach((item) => {
    if (!item.id) return;
    const current = unique.get(item.id);
    const matchedTagIds = Array.from(new Set([...(current?.matchedTagIds || []), ...(item.matchedTagIds || [])]));
    unique.set(item.id, { ...current, ...item, tagMatch: matchedTagIds.length > 0, matchedTagIds });
  });
  const candidates = Array.from(unique.values())
    .sort((a, b) => (b.matchedTagIds?.length || 0) - (a.matchedTagIds?.length || 0))
    .slice(0, 40);
  if (!candidates.length) throw new Error("Steam 没有返回可用的游戏结果，请稍后重试。");

  const detailed: Candidate[] = await Promise.all(candidates.map(async (item) => {
    try { return { item, details: await getDetails(item.id!) }; } catch { return { item }; }
  }));
  const usable = detailed.filter((candidate) => !candidate.details || (candidate.details.type === "game" && !candidate.details.release_date?.coming_soon));
  const preliminary = usable.map((candidate) => ({ candidate, score: scoreCandidate(candidate, prompt) }));
  const excludesCompetitive = preliminary.some(({ score }) => score.dislikesCompetitive && score.competitive);
  const filtered = excludesCompetitive ? preliminary.filter(({ score }) => !score.competitive).map(({ candidate }) => candidate) : usable;
  const wantsShort = /短|不长|太长|太久|短流程|单次|碎片|短局/i.test(prompt);
  const shortFiltered = wantsShort ? filtered.filter((candidate) => candidate.item.matchedTagIds?.includes("4234")) : filtered;
  const available = shortFiltered
    .map((candidate) => toRecommendation(candidate, prompt))
    .filter((game) => !excludedIds.has(game.id) && !excludedTitles.has(game.title.trim().toLowerCase()));
  const games = available
    .sort((x, y) => y.match - x.match || y.year - x.year)
    .slice(0, 6);
  if (!games.length) throw new Error("实时结果中没有满足你排除条件的游戏，请放宽条件后重试。");
  return {
    mode: "online", provider: "steam", page, hasMore: available.length > games.length, summary: "已根据“" + prompt + "”搜索 Steam 实时结果，并先按需求筛选，再按匹配度整理。",
    interpretedPreferences: [...onlineLabels(prompt), "Steam 实时搜索"].slice(0, 7), games,
    sources: games.map((game) => ({ title: game.title + " · Steam 商店页", url: game.sourceUrl })),
    note: page > 1 ? "这是第" + page + "批实时结果；候选全部来自 Steam 实时搜索与商店详情，并已排除前面展示过的游戏。" : "本次候选全部来自 Steam 实时搜索与商店详情，不使用内置测试目录；流程时长、版本和平台信息请以来源页为准。",
  };
}
