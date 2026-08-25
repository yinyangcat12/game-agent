export type ResearchMode = "live" | "online" | "demo";

export interface SourceLink { title: string; url: string; }

export interface PlayerProfile {
  platforms: string[];
  subscriptions: string[];
  region: string;
  language: string;
  sessionMinutes: number;
  budget: string;
  preferredGenres: string[];
  avoid: string;
  ownedGames: string;
}

export type FeedbackAction = "play" | "save" | "skip" | "played" | "dropped";
export interface DecisionFeedback { gameId: string; title: string; action: FeedbackAction; reason: string; createdAt: string; }

export interface GameRecommendation {
  id: string; title: string; year: number; genres: string[]; tags: string[]; platforms: string[];
  match: number; playtime: string; shortMatch?: boolean; why: string; watchOut: string;
  sourceUrl: string; officialUrl?: string; imageUrl?: string;
}

export interface DecisionGame extends GameRecommendation {
  verdict: string;
  fitSignals: string[];
  tradeoffs: string[];
  tonightPlan: string[];
  availabilitySummary: string;
}

export interface DecisionRequest {
  situation: string;
  profile: PlayerProfile;
  feedback: DecisionFeedback[];
  excludeTitles?: string[];
}

export interface DecisionResponse {
  mode: ResearchMode;
  generatedAt: string;
  headline: string;
  rationale: string;
  confidence: number;
  primary: DecisionGame;
  alternatives: DecisionGame[];
  rejected: Array<{ title: string; reason: string }>;
  interpretedContext: string[];
  sources: SourceLink[];
  note: string;
}

export interface CompanionRequest {
  game: string; platform: string; version: string; progress: string;
  sessionMinutes: number; goal: string; problem: string;
}
export interface CompanionStep { minuteRange: string; action: string; why: string; fallback: string; }
export interface CompanionResponse {
  mode: ResearchMode; game: string; sessionTitle: string; stateSummary: string; nextSessionMinutes: number;
  steps: CompanionStep[]; avoidNow: string[]; checkpoint: string; questionsToTrack: string[];
  sources: SourceLink[]; note: string;
}

// Legacy contracts remain available for compatibility with the previous API.
export interface DiscoverOptions { page?: number; limit?: number; excludeIds?: string[]; excludeTitles?: string[]; }
export interface DiscoverResponse { mode: ResearchMode; provider?: string; summary: string; interpretedPreferences: string[]; games: GameRecommendation[]; sources: SourceLink[]; note: string; page?: number; hasMore?: boolean; }
export interface GuidePhase { title: string; goal: string; steps: string[]; }
export interface GuideBuild { name: string; bestFor: string; priorities: string[]; }
export interface GameGuideResponse {
  mode: ResearchMode;
  game: string;
  overview: string;
  difficulty: string;
  estimatedMastery: string;
  coreLoop: string[];
  firstSession: string[];
  phases: GuidePhase[];
  builds: GuideBuild[];
  practicePlan: string[];
  mistakes: string[];
  checklist: string[];
  sources: SourceLink[];
  note: string;
}

export interface ApiStatus {
  liveResearch: boolean; model: string; apiKeyConfigured?: boolean; baseUrlConfigured?: boolean;
  onlineDiscovery?: boolean; guideOnline?: boolean;
  features?: { discovery: boolean; guide: boolean };
}
