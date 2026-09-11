import { describe, expect, it } from "vitest";
import { EXPECTED_MAIN_AGENT_TOOL_ORDER, MAIN_AGENT_TOOLS } from "../src/agent/tools.js";

describe("MAIN_AGENT_TOOLS", () => {
  it("顺序与 EXPECTED_MAIN_AGENT_TOOL_ORDER 逐位一致", () => {
    expect(MAIN_AGENT_TOOLS.map((t) => t.name)).toEqual([...EXPECTED_MAIN_AGENT_TOOL_ORDER]);
  });

  it("每个工具都是 object schema 且带 required 数组", () => {
    for (const t of MAIN_AGENT_TOOLS) {
      expect(t.input_schema.type).toBe("object");
      expect(Array.isArray((t.input_schema as { required?: unknown }).required)).toBe(true);
    }
  });

  it("工具名唯一", () => {
    const names = MAIN_AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
