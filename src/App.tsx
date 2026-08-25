import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Clock3, Compass,
  ExternalLink, Gamepad2, Globe2, GraduationCap, Lightbulb, ListChecks, LoaderCircle, Store,
  RefreshCw, Search, ShieldAlert, SlidersHorizontal, Target, Wifi,
} from "lucide-react";
import { api } from "./api";
import type { ApiStatus, DiscoverResponse, GameGuideResponse, GameRecommendation } from "./types";

type Choice = { label: string; value: string };
type DiscoveryProfile = {
  language: string;
  budget: string;
  session: string;
  platforms: string[];
  genres: string[];
  avoid: string[];
  extra: string;
};

const languages: Choice[] = [
  { label: "简体中文优先", value: "简体中文" },
  { label: "繁体中文也可以", value: "简体中文或繁体中文" },
  { label: "英文也可以", value: "中文或英文" },
  { label: "不限制语言", value: "不限制语言" },
];
const budgets: Choice[] = [
  { label: "免费 / 低成本优先", value: "免费或低成本优先" },
  { label: "100 元以内", value: "100 元以内" },
  { label: "300 元以内", value: "300 元以内" },
  { label: "预算不限", value: "预算不限" },
];
const sessionLengths: Choice[] = [
  { label: "15–30 分钟，随时能停", value: "15-30 分钟短时游玩" },
  { label: "1 小时左右", value: "约 1 小时一局或一段" },
  { label: "2–3 小时沉浸", value: "2-3 小时沉浸式游玩" },
  { label: "不限制时长", value: "不限制游玩时长" },
];
const platforms = ["PC", "PlayStation", "Xbox", "Nintendo Switch", "手机 / 平板", "云游戏"];
const genres = [
  "动作", "冒险", "角色扮演", "策略", "模拟", "独立", "休闲", "体育", "竞速",
  "恐怖", "解谜", "叙事丰富", "开放世界", "合作", "本地多人", "单人", "肉鸽", "建造经营",
];
const avoidTags = ["纯 PvP 竞技", "恐怖压迫", "魂类高难度", "复杂经营", "大量刷取", "长流程", "强制联机", "抽卡付费"];
const defaultProfile: DiscoveryProfile = {
  language: languages[3].value,
  budget: budgets[3].value,
  session: sessionLengths[3].value,
  platforms: [],
  genres: [],
  avoid: [],
  extra: "",
};

const profileStorageKey = "atlas-discovery-profile-v2";

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function toggle(items: string[], item: string) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function mergeDiscoverResults(previous: DiscoverResponse, next: DiscoverResponse): DiscoverResponse {
  const games = [...previous.games, ...next.games].filter((game, index, all) =>
    all.findIndex((candidate) => candidate.id === game.id || candidate.title.trim().toLowerCase() === game.title.trim().toLowerCase()) === index,
  );
  const sources = [...previous.sources, ...next.sources].filter((source, index, all) =>
    all.findIndex((candidate) => candidate.url === source.url) === index,
  );
  return {
    ...next,
    summary: previous.summary,
    games,
    sources,
    interpretedPreferences: [...new Set([...previous.interpretedPreferences, ...next.interpretedPreferences])],
  };
}

const guideCache = new Map<string, Promise<GameGuideResponse>>();
const guidePrefetchQueued = new Set<string>();
let guidePrefetchChain: Promise<unknown> = Promise.resolve();

function guideCacheKey(game: GameRecommendation) {
  return game.id || game.title.trim().toLowerCase();
}

function guideGoal(game: GameRecommendation) {
  const platformHint = game.platforms.length > 0 ? "优先结合这些平台说明：" + game.platforms.join("、") + "。" : "请覆盖主要平台差异。";
  return "我是完全没接触过这款游戏的新手。" + platformHint + "请给我一条不剧透、从第一小时开始的详细快速上手路线，目标是先能稳定游玩，再逐步形成有效打法；不要承诺短时间内真正达到顶尖水平。";
}

function getGuide(game: GameRecommendation) {
  const key = guideCacheKey(game);
  const cached = guideCache.get(key);
  if (cached) return cached;
  const request = api.guide(game.title, guideGoal(game)).catch((error) => {
    guideCache.delete(key);
    throw error;
  });
  guideCache.set(key, request);
  return request;
}

function queueGuidePrefetch(games: GameRecommendation[]) {
  games.forEach((game) => {
    const key = guideCacheKey(game);
    if (guideCache.has(key) || guidePrefetchQueued.has(key)) return;
    guidePrefetchQueued.add(key);
    guidePrefetchChain = guidePrefetchChain.then(() => getGuide(game).catch(() => undefined)).finally(() => guidePrefetchQueued.delete(key));
  });
}

function buildPrompt(profile: DiscoveryProfile) {
  const lines = [
    "我想找下一款要玩的游戏。偏好语言：" + profile.language + "。预算倾向：" + profile.budget + "。单次游玩时间：" + profile.session + "。",
    "可玩的平台：" + (profile.platforms.join("、") || "不限平台") + "。喜欢的类型和标签：" + (profile.genres.join("、") || "请根据其他要求推断") + "。",
    "明确避开：" + (profile.avoid.join("、") || "无") + "。",
  ];
  if (profile.extra.trim()) lines.push("补充要求：" + profile.extra.trim());
  if (profile.platforms.length === 0 && profile.genres.length === 0 && profile.avoid.length === 0) {
    lines.push("用户没有指定平台、类型或避开项。请最大化覆盖范围，不要自行缩窄候选集：同时考虑 PC 各主要商店、PlayStation、Xbox、Nintendo、手机、云游戏、免费游戏、买断制、订阅可玩、独立游戏、3A 游戏和不同年代的优秀作品，再按可玩性与信息可靠度排序。");
  }
  lines.push("请搜索全平台真实存在且目前仍可玩的游戏，先按我的要求筛选，再给出最多 6 个候选。不要使用预先写好的测试数据。优先给出官方游戏页或平台商店页链接，并说明推荐理由和需要注意的地方；如果用户没有明确偏好，宁可扩大探索范围，也不要用默认类型替用户做决定。");
  return lines.join("\n");
}

export default function App() {
  const [profile, setProfile] = useState(() => readStored(profileStorageKey, defaultProfile));
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [status, setStatus] = useState<ApiStatus | null>(null);
 const [showAdvanced, setShowAdvanced] = useState(false);
 const [guideGame, setGuideGame] = useState<GameRecommendation | null>(null);
  const [pendingMode, setPendingMode] = useState<"initial" | "refresh" | "append" | null>(null);
  const [retryPage, setRetryPage] = useState<number | null>(null);

  useEffect(() => { localStorage.setItem(profileStorageKey, JSON.stringify(profile)); }, [profile]);
 useEffect(() => { api.status().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { if (result?.games.length) queueGuidePrefetch(result.games); }, [result?.games]);
 const promptPreview = useMemo(() => buildPrompt(profile), [profile]);

 const searchGames = async (nextPage = 1) => {
   if (busy) return;
    const append = nextPage > 1 && Boolean(result);
    let workingResult: DiscoverResponse | null = append ? result : null;
    let workingExcluded = append ? [...excluded] : [];
    const requestCount = 6;
   setBusy(true);
   setError("");
    setPendingMode(append ? "append" : result ? "refresh" : "initial");
    setRetryPage(null);
   try {
      for (let index = 0; index < requestCount; index += 1) {
        const response = await api.discover(promptPreview, {
          page: append ? nextPage : index + 1,
          limit: 1,
          excludeIds: workingExcluded,
          excludeTitles: workingResult?.games.map((game) => game.title) || [],
        });
        if (response.games.length === 0) continue;
        workingResult = workingResult ? mergeDiscoverResults(workingResult, response) : response;
        workingExcluded = [...new Set([...workingExcluded, ...response.games.map((game) => game.id)])];
        setResult(workingResult);
        setPage(append ? nextPage : 1);
        setExcluded(workingExcluded);
        queueGuidePrefetch(response.games);
        if (!append && index === 0) window.scrollTo({ top: 0, behavior: "smooth" });
      }
      if (!workingResult?.games.length) throw new Error("联网研究没有返回可核实的游戏，请换一种描述后重试。");
   } catch (cause) {
      setRetryPage(append ? nextPage : 1);
     setError(cause instanceof Error ? cause.message : "联网搜索失败，请稍后重试。");
   } finally {
     setBusy(false);
      setPendingMode(null);
   }
 };

  const reset = () => {
    setProfile(defaultProfile);
    setResult(null);
    setError("");
    setPage(1);
    setExcluded([]);
   setGuideGame(null);
    setPendingMode(null);
    setRetryPage(null);
  };

  return (
    <div className="discovery-app">
        <main className="discovery-page">
          <header className="page-topline">
            <div className="topline-copy"><div className="wordmark"><span className="wordmark-icon"><Gamepad2 size={15} /></span><span>ATLAS PLAY</span><small>全平台游戏发现</small></div><span className="discovery-eyebrow">LIVE GAME RESEARCH</span><h1>发现下一款游戏</h1><p>告诉我你现在想玩什么，我会联网搜索真实存在、符合条件的游戏。</p></div>
            <div className={"status-pill " + (status?.liveResearch ? "online" : "")}><span /><strong>{status?.liveResearch ? "联网搜索已启用" : "等待联网模型"}</strong><small>{status?.model || "gpt-5.6-sol"}</small></div>
          </header>

          {guideGame ? <GuideWorkspace game={guideGame} onBack={() => setGuideGame(null)} /> : <>
          <section className="discovery-console search-console">
            <div className="console-heading"><div><span className="discovery-eyebrow">ASK ATLAS</span><h2>你想玩什么？</h2><p className="console-subtitle">可以直接描述场景、心情、平台或避雷项，越自然越好。</p></div><button className="reset-button" onClick={reset}><RefreshCw size={14} />重置偏好</button></div>
            <div className="search-row">
              <label className="search-box" htmlFor="extra-request"><Search size={18} /><textarea id="extra-request" value={profile.extra} onChange={(event) => setProfile((current) => ({ ...current, extra: event.target.value }))} placeholder="例如：想找一款能单人玩的探索游戏，节奏不要太紧张，最好支持中文……不填写也可以，系统会尽量扩大搜索范围。" /></label>
              <button className="discover-button search-submit" disabled={busy || !status?.liveResearch} onClick={() => searchGames(1)}>{busy ? <><LoaderCircle className="spin" size={16} />正在搜索</> : <><span>开始搜索</span><ArrowRight size={17} /></>}</button>
            </div>
            <div className="search-hint"><Wifi size={13} /><span>联网检索全平台公开信息，结果会附带来源链接，不使用预置测试候选。</span></div><div className="quick-prompts"><span>试试：</span>{["适合周末沉浸的单人冒险", "轻松不肝、支持中文", "适合朋友本地合作"].map((prompt) => <button key={prompt} onClick={() => setProfile((current) => ({ ...current, extra: prompt }))}>{prompt}</button>)}</div>
            <div className="discovery-selects">
              <SelectField label="偏好语言" value={profile.language} options={languages} onChange={(value) => setProfile((current) => ({ ...current, language: value }))} />
              <SelectField label="预算倾向" value={profile.budget} options={budgets} onChange={(value) => setProfile((current) => ({ ...current, budget: value }))} />
              <SelectField label="一次想玩多久" value={profile.session} options={sessionLengths} onChange={(value) => setProfile((current) => ({ ...current, session: value }))} />
            </div>
            <div className="filter-summary"><span>基础条件</span><b>{profile.platforms.length} 个平台</b><b>{profile.genres.length} 个类型</b><b>{profile.avoid.length} 个避开项</b><button className="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "收起筛选" : "更多筛选"}<ChevronDown size={14} className={showAdvanced ? "turned" : ""} /></button></div>
            {showAdvanced && <div className="advanced-fields">
              <ChoiceGroup label="我能在哪些平台玩" items={platforms} selected={profile.platforms} onToggle={(value) => setProfile((current) => ({ ...current, platforms: toggle(current.platforms, value) }))} />
              <ChoiceGroup label="我喜欢的类型 / 标签" items={genres} selected={profile.genres} onToggle={(value) => setProfile((current) => ({ ...current, genres: toggle(current.genres, value) }))} />
              <ChoiceGroup label="明确避开" items={avoidTags} selected={profile.avoid} onToggle={(value) => setProfile((current) => ({ ...current, avoid: toggle(current.avoid, value) }))} danger />
            </div>}
          </section>

          {busy && !result && <section className="discovery-loading"><div className="loading-orbit"><Globe2 size={25} /></div><div><span className="discovery-eyebrow">LIVE RESEARCH IN PROGRESS</span><h2>正在搜索全平台候选……</h2><p>正在核对游戏页面、平台信息和你的偏好匹配度。</p></div><span className="loading-page">第 {page} 批</span></section>}
          {busy && result && <div className="append-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={15} /><span>{pendingMode === "append" ? "正在追加候选，已有 " + result.games.length + " 个结果仍可继续查看。" : "正在更新搜索，已有 " + result.games.length + " 个结果仍可继续查看。"}</span></div>}
          {error && <section className={"discovery-error " + (result ? "has-existing-results" : "")}><strong>{pendingMode === "append" || (retryPage !== null && retryPage > 1) ? "追加搜索没有完成" : "这次搜索没有完成"}</strong><p>{error}{result ? " 原有搜索结果已保留。" : ""}</p><button onClick={() => searchGames(retryPage ?? (result ? page + 1 : 1))}>再试一次<RefreshCw size={14} /></button></section>}
          {!result && !busy && !error && <section className="search-empty"><div className="empty-orbit"><Search size={24} /></div><div><strong>从上面的搜索框开始</strong><p>一句话描述需求，再用“更多筛选”补充平台、类型和避雷项。</p></div></section>}
          {result && <Results result={result} page={page} busy={busy} onMore={() => searchGames(page + 1)} onReset={reset} onGuide={setGuideGame} />}
          </>}
        </main>
      </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Choice[]; onChange: (value: string) => void }) {
  return <label className="discovery-field"><span>{label}</span><div><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></div></label>;
}

function ChoiceGroup({ label, items, selected, onToggle, danger = false }: { label: string; items: string[]; selected: string[]; onToggle: (value: string) => void; danger?: boolean }) {
  return <div className={"choice-group " + (danger ? "danger" : "")}><span>{label}</span><div>{items.map((item) => <button key={item} className={selected.includes(item) ? "selected" : ""} onClick={() => onToggle(item)}>{selected.includes(item) && <Check size={12} />}{item}</button>)}</div></div>;
}

function Results({ result, page, busy, onMore, onReset, onGuide }: { result: DiscoverResponse; page: number; busy: boolean; onMore: () => void; onReset: () => void; onGuide: (game: GameRecommendation) => void }) {
  return <section className="results-section"><div className="results-heading"><div><span className="discovery-eyebrow">02 / CURATED FOR YOU</span><h2>{page === 1 ? "这几款，值得你先看看" : "继续为你添加候选"}</h2><p>{result.summary}</p></div><div className="result-actions"><span className="result-count">已保留 {result.games.length} 个结果</span><button className="small-outline" onClick={onReset}><SlidersHorizontal size={13} />修改偏好</button></div></div>{result.interpretedPreferences.length > 0 && <div className="interpreted"><span>已理解</span>{result.interpretedPreferences.map((item) => <b key={item}>{item}</b>)}</div>}{page > 1 && <div className="append-notice"><Check size={14} /><span>上一轮结果已保留；继续搜索会在下面追加新的候选。</span></div>}<div className="game-grid">{result.games.map((game, index) => <GameCard key={game.id + "-" + index} game={game} rank={index + 1} onGuide={onGuide} />)}</div><div className="more-results"><div><strong>还没找到对的？</strong><span>继续搜索，新的游戏会添加到现有结果后面。</span></div><button className="discover-button compact" disabled={busy} onClick={onMore}>{busy ? <><LoaderCircle className="spin" size={15} />正在追加</> : <><RefreshCw size={15} />继续添加一批</>}</button></div><Sources result={result} /></section>;
}

function GameCover({ game, rank }: { game: GameRecommendation; rank: number }) {
  const [imageUrl, setImageUrl] = useState(game.imageUrl || "");
  const [coverLoading, setCoverLoading] = useState(!game.imageUrl);

  useEffect(() => {
    let active = true;
    setImageUrl(game.imageUrl || "");
    setCoverLoading(!game.imageUrl);
    if (game.imageUrl) return () => { active = false; };
    api.cover(game.sourceUrl, game.imageUrl, game.id)
      .then((cover) => { if (active) setImageUrl(cover.imageUrl || ""); })
      .catch(() => { if (active) setImageUrl(""); })
      .finally(() => { if (active) setCoverLoading(false); });
    return () => { active = false; };
  }, [game.id, game.imageUrl, game.sourceUrl]);

  return <div className="game-cover">{imageUrl ? <img src={imageUrl} alt={game.title + " 游戏配图"} loading="lazy" onError={() => { setImageUrl(""); setCoverLoading(false); }} /> : <div className="game-cover-fallback"><Gamepad2 size={32} /><span>{String(rank).padStart(2, "0")}</span><small>{coverLoading ? "正在获取封面" : "暂无可核实配图"}</small></div>}<span className="match-badge">{game.match}% 匹配</span></div>;
}

function platformLabel(url: string, platforms: string[]) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("steampowered")) return "Steam";
    if (host.includes("playstation")) return "PlayStation Store";
    if (host.includes("xbox")) return "Xbox Store";
    if (host.includes("nintendo")) return "Nintendo eShop";
    if (host.includes("epicgames")) return "Epic Games Store";
    if (host.includes("gog")) return "GOG";
    if (host.includes("itch.io")) return "itch.io";
  } catch {
    // 链接异常时仍然显示模型返回的平台信息。
  }
  return platforms.slice(0, 2).join(" / ") || "游戏平台";
}

function GameCard({ game, rank, onGuide }: { game: GameRecommendation; rank: number; onGuide: (game: GameRecommendation) => void }) {
  return <article className="game-card">
    <GameCover game={game} rank={rank} />
    <div className="game-card-body">
      <div className="game-card-top"><span>{game.year || "近期"} · {game.platforms.slice(0, 3).join(" / ")}</span></div>
      <h3>{game.title}</h3>
      <div className="tag-line">{game.genres.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <div className="game-meta"><Clock3 size={15} /><span><small>预计流程</small><b>{game.playtime}</b></span></div>
      <details className="game-collapsible"><summary><span>游戏介绍</span><ChevronDown size={15} /></summary><p className="game-why">{game.why}</p></details>
      <details className="game-collapsible game-warning"><summary><span>需要注意</span><ChevronDown size={15} /></summary><p>{game.watchOut || "打开来源页确认当前平台与版本信息。"}</p></details>
      <button className="guide-launch" onClick={() => onGuide(game)} aria-label={"查看 " + game.title + " 的独立新手攻略"}><span className="guide-launch-icon"><BookOpen size={16} /></span><span className="guide-launch-copy"><b>查看新手攻略</b><small>联网整理 · 点击进入独立攻略页</small></span><ArrowRight size={16} /></button>
      <div className="game-links" aria-label={game.title + " 的外部链接"}>
        <a href={game.sourceUrl} target="_blank" rel="noreferrer">
          <span><Store size={14} /><b>前往游戏平台</b><small>{platformLabel(game.sourceUrl, game.platforms)}</small></span>
          <ExternalLink size={13} />
        </a>
        {game.officialUrl ? (
          <a href={game.officialUrl} target="_blank" rel="noreferrer">
            <span><Globe2 size={14} /><b>游戏官网</b><small>已核实的官方站点</small></span>
            <ExternalLink size={13} />
          </a>
        ) : (
          <div className="game-link-disabled">
            <span><Globe2 size={14} /><b>游戏官网</b><small>暂无已核实官网</small></span>
          </div>
        )}
      </div>
    </div>
  </article>;
}

function GuideWorkspace({ game, onBack }: { game: GameRecommendation; onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState<GameGuideResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setGuide(null);
    getGuide(game)
      .then((data) => { if (active) setGuide(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "攻略联网整理失败，请稍后重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, game.id, game.platforms, game.title]);

  return <section className="guide-workspace">
    <div className="guide-toolbar"><button className="guide-back" onClick={onBack}><ArrowLeft size={15} />返回游戏发现</button><span><BookOpen size={14} />独立攻略工作区 · 联网研究</span></div>
    {loading && <div className="guide-loading-screen"><div className="loading-orbit"><BookOpen size={25} /></div><div><span className="discovery-eyebrow">GUIDE RESEARCH IN PROGRESS</span><h2>正在整理 {game.title} 的详细攻略……</h2><p>正在核对核心机制、上手路线、练习重点和可靠来源。</p></div></div>}
    {!loading && error && <div className="guide-error-screen"><ShieldAlert size={22} /><div><strong>攻略暂时没有生成</strong><p>{error}</p></div><button className="small-outline" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={14} />重新整理</button></div>}
    {!loading && !error && guide && <>
      <header className="guide-hero"><div className="guide-hero-cover"><GameCover game={game} rank={1} /></div><div className="guide-hero-copy"><span className="discovery-eyebrow">FROM ZERO TO STABLE PLAY</span><div className="guide-title-row"><div><h2>{guide.game}</h2><p>{game.year || "近期"} · {game.platforms.join(" / ") || "全平台"}</p></div><a className="guide-source-link" href={game.sourceUrl} target="_blank" rel="noreferrer">打开游戏来源<ExternalLink size={13} /></a></div><details className="guide-overview-fold"><summary><span>快速了解这款游戏</span><ChevronDown size={15} /></summary><p className="guide-hero-summary">{guide.overview}</p></details><div className="guide-stat-grid"><div className="guide-stat"><span>上手难度</span><b>{guide.difficulty}</b></div><div className="guide-stat"><span>形成稳定打法</span><b>{guide.estimatedMastery}</b></div><div className="guide-stat"><span>攻略状态</span><b>{guide.mode === "live" ? "联网研究" : "备用经验"}</b></div></div></div></header>
      <div className="guide-layout"><main className="guide-main"><GuideSection icon={Compass} kicker="01 / 先理解再操作" title="这款游戏到底在玩什么？"><GuideList items={guide.coreLoop || []} /></GuideSection><GuideSection icon={Clock3} kicker="02 / 第一次打开" title="第一小时行动清单"><GuideList items={guide.firstSession || []} /></GuideSection><GuideSection icon={Target} kicker="03 / 从会玩到玩稳" title="分阶段上手路线"><div className="guide-timeline">{guide.phases.map((phase, index) => <details className="guide-timeline-item" key={phase.title + index}><summary className="guide-timeline-summary"><div className="guide-timeline-marker">{String(index + 1).padStart(2, "0")}</div><div><span className="guide-phase-kicker">阶段 {index + 1}</span><h3>{phase.title}</h3><p className="guide-phase-goal">{phase.goal}</p></div><ChevronDown size={16} /></summary><div className="guide-timeline-content"><ol>{phase.steps.map((step, stepIndex) => <li key={step + stepIndex}><span>{stepIndex + 1}</span><p>{step}</p></li>)}</ol></div></details>)}</div></GuideSection><GuideSection icon={GraduationCap} kicker="04 / 选择你的起步方式" title="新手起步方案"><div className="guide-build-grid">{guide.builds.map((build) => <details className="guide-build-card" key={build.name}><summary><h3>{build.name}</h3><ChevronDown size={15} /></summary><p>{build.bestFor}</p><ul>{build.priorities.map((priority) => <li key={priority}><CheckCircle2 size={14} />{priority}</li>)}</ul></details>)}</div></GuideSection><GuideSection icon={Lightbulb} kicker="05 / 继续进阶" title="练习与复盘计划"><GuideList items={guide.practicePlan || []} /></GuideSection><GuideSection icon={ShieldAlert} kicker="06 / 先避开这些坑" title="常见错误"><ul className="guide-bullet-list">{guide.mistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul></GuideSection></main><aside className="guide-side"><details className="guide-side-card guide-checklist-card"><summary className="guide-side-heading"><ListChecks size={17} /><div><span>入门自检</span><h3>我真的开始会玩了吗？</h3></div><ChevronDown size={16} /></summary><ul className="guide-checklist">{guide.checklist.map((item) => <li key={item}><Check size={14} />{item}</li>)}</ul></details><details className="guide-side-card"><summary className="guide-side-heading"><Globe2 size={17} /><div><span>证据来源</span><h3>这份攻略参考了什么？</h3></div><ChevronDown size={16} /></summary><div className="guide-source-list">{guide.sources.map((source) => <a href={source.url} key={source.title + source.url} target="_blank" rel="noreferrer"><span>{source.title}</span><ExternalLink size={12} /></a>)}</div><p className="guide-note">{guide.note}</p></details></aside></div>
    </>}
  </section>;
}

function GuideSection({ icon: Icon, kicker, title, children }: { icon: typeof Compass; kicker: string; title: string; children: ReactNode }) {
  return <details className="guide-section"><summary className="guide-section-heading"><div className="guide-section-icon"><Icon size={17} /></div><div><span>{kicker}</span><h2>{title}</h2><small>点击展开查看</small></div><ChevronDown className="guide-section-chevron" size={17} /></summary><div className="guide-section-content">{children}</div></details>;
}

function GuideList({ items }: { items: string[] }) {
  return <ol className="guide-number-list">{items.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol>;
}

function Sources({ result }: { result: DiscoverResponse }) {
  return <details className="sources-details"><summary><Globe2 size={14} />查看本次搜索来源 <span>{result.sources.length} 个</span><ChevronDown size={14} /></summary><div>{result.sources.slice(0, 12).map((source) => <a href={source.url} key={source.title + source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={12} /></a>)}</div><p>{result.note}</p></details>;
}
