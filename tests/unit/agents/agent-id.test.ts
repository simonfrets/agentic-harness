import {
  BUILT_IN_AGENT_IDS,
  agentIdSchema,
  isBuiltInAgentId,
  mapBuiltInAgents,
} from "../../../src/agents/agent-id.js";

describe("BUILT_IN_AGENT_IDS", () => {
  it("names the six pipeline agents exactly once each", () => {
    expect([...BUILT_IN_AGENT_IDS]).toEqual([
      "architect",
      "cleaner",
      "coder",
      "hardener",
      "qa",
      "specifier",
    ]);
    expect(new Set(BUILT_IN_AGENT_IDS).size).toBe(BUILT_IN_AGENT_IDS.length);
  });

  it("is stored in code-unit order so iteration is canonical", () => {
    const sorted = [...BUILT_IN_AGENT_IDS].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    );

    expect([...BUILT_IN_AGENT_IDS]).toEqual(sorted);
  });
});

describe("isBuiltInAgentId", () => {
  it("accepts every built-in agent", () => {
    expect(BUILT_IN_AGENT_IDS).toHaveLength(6);

    for (const agent of BUILT_IN_AGENT_IDS) {
      expect(isBuiltInAgentId(agent)).toBe(true);
    }
  });

  it("rejects an unknown agent and the historical hardender typo", () => {
    expect(isBuiltInAgentId("hardender")).toBe(false);
    expect(isBuiltInAgentId("reviewer")).toBe(false);
    expect(isBuiltInAgentId("")).toBe(false);
  });
});

describe("agentIdSchema", () => {
  it("accepts built-in and custom kebab-case agent identifiers", () => {
    expect(agentIdSchema.parse("coder")).toBe("coder");
    expect(agentIdSchema.parse("release-manager")).toBe("release-manager");
    expect(agentIdSchema.parse("agent2")).toBe("agent2");
  });

  it("rejects identifiers that are not lower-case kebab-case", () => {
    for (const invalid of [
      "",
      "Coder",
      "co der",
      "-coder",
      "coder-",
      "co--der",
      "2agent",
    ]) {
      expect(agentIdSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("mapBuiltInAgents", () => {
  it("builds a total record keyed by every built-in agent", () => {
    const lengths = mapBuiltInAgents((agent) => agent.length);

    expect(Object.keys(lengths).sort()).toEqual([...BUILT_IN_AGENT_IDS]);
    expect(lengths.coder).toBe(5);
    expect(lengths.qa).toBe(2);
  });
});
