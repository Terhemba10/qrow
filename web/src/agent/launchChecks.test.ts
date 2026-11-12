import { describe, expect, it } from "vitest";
import { launchChecks, lookalikeName, lookalikeTicker } from "./launchChecks";

const base = { name: "Paper Lantern", symbol: "LANT", supply: "1000000", creatorPct: "5", description: "gm" };
const lv = (r: ReturnType<typeof launchChecks>, id: string) => r.find((c) => c.id === id)?.level;

describe("launchChecks", () => {
  it("passes a clean launch", () => {
    const r = launchChecks(base, []);
    expect(r.every((c) => c.level === "ok")).toBe(true);
  });

  it("mirrors the on-chain format rules", () => {
    expect(lv(launchChecks({ ...base, name: " Lantern" }, []), "name")).toBe("block");
    expect(lv(launchChecks({ ...base, name: "Paper  Lantern" }, []), "name")).toBe("block");
    expect(lv(launchChecks({ ...base, symbol: "lant" }, []), "symbol")).toBe("block");
    expect(lv(launchChecks({ ...base, supply: "999" }, []), "supply")).toBe("block");
    expect(lv(launchChecks({ ...base, supply: "1000000000001" }, []), "supply")).toBe("block");
    expect(lv(launchChecks({ ...base, creatorPct: "10.5" }, []), "creator")).toBe("block");
    expect(lv(launchChecks({ ...base, creatorPct: "8" }, []), "creator")).toBe("warn");
    expect(lv(launchChecks({ ...base, description: "x".repeat(281) }, []), "desc")).toBe("block");
  });

  it("blocks exact and lookalike impersonation", () => {
    expect(lookalikeName("Baby Bitcoin")).toEqual({ matched: "bitcoin", how: "exact" });
    expect(lookalikeName("B1tc0in Gold")?.how).toBe("spelling");
    expect(lookalikeName("Etherium")).toEqual({ matched: "ether", how: "exact" });
    expect(lookalikeName("Kardano Cat")).toEqual({ matched: "cardano", how: "spelling" });
    expect(lookalikeName("Solanna Cat")?.matched).toBe("solana");
    expect(lookalikeName("Paper Lantern")).toBeUndefined();
    expect(lookalikeName("Ethel")).toBeUndefined();
    expect(lookalikeTicker("WBTC")?.how).toBe("exact");
    expect(lookalikeTicker("B7C")).toEqual({ matched: "BTC", how: "spelling" });
    expect(lookalikeTicker("D0GE")?.matched).toBe("DOGE");
    expect(lookalikeTicker("LANT")).toBeUndefined();
    expect(lv(launchChecks({ ...base, name: "Uniswapp Inu" }, []), "impersonation")).toBe("block");
  });

  it("warns on duplicates, links and profit talk", () => {
    const r = launchChecks(base, [{ name: "paper lantern", symbol: "LANT" }]);
    expect(lv(r, "dupSymbol")).toBe("warn");
    expect(lv(r, "dupName")).toBe("warn");
    expect(lv(launchChecks({ ...base, description: "join t.me/x" }, []), "desc")).toBe("warn");
    expect(lv(launchChecks({ ...base, description: "guaranteed 100x" }, []), "desc")).toBe("warn");
  });
});
