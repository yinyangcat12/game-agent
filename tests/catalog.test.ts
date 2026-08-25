import { describe, expect, it } from "vitest";
import { discoverFromCatalog, findCatalogGame, guideFromCatalog, interpretPrompt } from "../server/catalog.js";

describe("offline game research", () => {
  it("interprets multiple preference dimensions", () => {
    expect(interpretPrompt("剧情、探索未知、短局高重玩")).toEqual(expect.arrayContaining(["剧情与角色", "探索未知", "短局高重玩"]));
  });
  it("ranks DREDGE highly for short cosmic-horror management", () => {
    const result = discoverFromCatalog("克苏鲁氛围、轻度经营、流程不要太长");
    expect(result.games[0].title).toBe("DREDGE");
    expect(result.mode).toBe("demo");
  });
  it("recognizes common Chinese and English game names", () => {
    expect(findCatalogGame("艾尔登法环")?.title).toBe("Elden Ring");
    expect(findCatalogGame("Hades")?.title).toBe("Hades");
  });
  it("builds a phased guide with actionable checks", () => {
    const result = guideFromCatalog("Elden Ring", "两小时内熟悉战斗和升级");
    expect(result.phases).toHaveLength(3);
    expect(result.phases[2].steps.at(-1)).toContain("两小时内熟悉战斗和升级");
    expect(result.checklist.length).toBeGreaterThan(1);
  });
});
