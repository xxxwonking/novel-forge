/**
 * rules.yaml 的加载校验 + **代码里没有数字**的源码扫描。
 *
 * 后者是这个文件存在的主要理由。§10.1 的"没有硬编码常量"是设计约束，
 * 但它在代码评审里极易回退 —— 加一条规则时顺手写个字面量最省事。
 * 所以用测试挡住：扫描 beat/ gate/ text/ 三个目录，出现字数量级的数字即失败。
 */

import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRules, loadRules, parseRules, RulesError } from "../src/rules/load.js";
import { THRESHOLD_KEYS } from "../src/rules/schema.js";
import { parse } from "yaml";

const YAML_PATH = new URL("../rules.yaml", import.meta.url);
const yamlText = readFileSync(YAML_PATH, "utf8");

describe("rules.yaml 加载", () => {
  it("仓库里的 rules.yaml 能完整加载", () => {
    const rules = loadRules();
    expect(rules.version).toBe("r1");
    expect(rules.platform.fanqie.base).toBe(2200);
    expect(rules.typeFactor.climax).toEqual([1.25, 1.85]);
    expect(rules.tier.climax).toBe("strict");
  });

  it("同一进程内复用同一份对象（不重复解析）", () => {
    expect(loadRules()).toBe(loadRules());
  });

  it("产物被冻结 —— 运行期改系数改不动", () => {
    const rules = loadRules();
    expect(Object.isFrozen(rules)).toBe(true);
    expect(Object.isFrozen(rules.platform)).toBe(true);
    expect(() => {
      (rules as { version: string }).version = "hacked";
    }).toThrow();
  });

  it("五种章节类型的因子与密度区间都齐全", () => {
    const rules = loadRules();
    for (const t of ["transition", "setup", "event", "payoff", "climax"] as const) {
      expect(rules.typeFactor[t][0]).toBeGreaterThan(0);
      expect(rules.densityRange[t][1]).toBeGreaterThan(rules.densityRange[t][0]);
      expect(rules.tier[t]).toMatch(/^(fast|standard|strict)$/u);
    }
  });

  it("四个 densityRules key 与 THRESHOLD_KEYS 常量对齐", () => {
    const keys = loadRules().densityRules.map((r) => r.key);
    for (const k of Object.values(THRESHOLD_KEYS)) {
      expect(keys).toContain(k);
    }
  });

  it("零容忍规则的正则可编译，scope 合法", () => {
    const { metaLeak, endingCliche } = loadRules().zeroTolerance;
    expect(() => new RegExp(metaLeak.pattern, "u")).not.toThrow();
    expect(metaLeak.scope).toBe("speech_and_thought");
    expect(endingCliche.scope).toBe("last_paragraphs");
    expect(endingCliche.lastParagraphs).toBe(3);
  });

  it("scope 非 last_paragraphs 时不带 lastParagraphs 字段", () => {
    // exactOptionalPropertyTypes 下多余的 undefined 字段会破坏结构相等，
    // 而这个对象要参与缓存前缀的稳定性判断。
    expect("lastParagraphs" in loadRules().zeroTolerance.metaLeak).toBe(false);
  });
});

describe("rules.yaml 校验（缺字段就抛，不静默产 NaN）", () => {
  const mutate = (fn: (root: Record<string, unknown>) => void): (() => unknown) => {
    const root = parse(yamlText) as Record<string, unknown>;
    fn(root);
    return () => buildRules(root);
  };

  it("缺 version", () => {
    expect(mutate((r) => delete r["version"])).toThrow(RulesError);
  });

  it("缺一个平台", () => {
    expect(
      mutate((r) => {
        delete (r["platform"] as Record<string, unknown>)["qidian"];
      }),
    ).toThrow(/platform\.qidian\.base/u);
  });

  it("缺一个章节类型的因子", () => {
    expect(
      mutate((r) => {
        delete (r["typeFactor"] as Record<string, unknown>)["setup"];
      }),
    ).toThrow(/typeFactor\.setup/u);
  });

  it("区间写反（下限 > 上限）", () => {
    expect(
      mutate((r) => {
        (r["typeFactor"] as Record<string, unknown>)["event"] = [1.5, 0.9];
      }),
    ).toThrow(/下限 1.5 大于上限 0.9/u);
  });

  it("区间不是两元数组", () => {
    expect(
      mutate((r) => {
        (r["resolveCost"] as Record<string, unknown>)["main"] = [600];
      }),
    ).toThrow(/两元数组/u);
  });

  it("数值字段被写成字符串", () => {
    expect(
      mutate((r) => {
        r["partialRatio"] = "0.6";
      }),
    ).toThrow(/必须是有限数字/u);
  });

  it("densityRules 的 key 重复", () => {
    expect(
      mutate((r) => {
        const rules = r["densityRules"] as Record<string, unknown>[];
        rules.push({ ...rules[0] });
      }),
    ).toThrow(/key 重复/u);
  });

  it("genreMul 引用了不存在的 densityRules key —— 拼错会静默失效，所以直接抛", () => {
    expect(
      mutate((r) => {
        (r["genreMul"] as Record<string, Record<string, number>>)["xuanhuan"] = { 比喩: 1.3 };
      }),
    ).toThrow(/不是任何 densityRules 的 key/u);
  });

  it("非法的 tier 值", () => {
    expect(
      mutate((r) => {
        (r["tier"] as Record<string, unknown>)["climax"] = "paranoid";
      }),
    ).toThrow(/fast \| standard \| strict/u);
  });

  it("非法的正则", () => {
    expect(
      mutate((r) => {
        ((r["zeroTolerance"] as Record<string, Record<string, unknown>>)["metaLeak"] ?? {})["pattern"] =
          "(未闭合";
      }),
    ).toThrow(/不是合法正则/u);
  });

  it("缺一个人物档位的消失阈值", () => {
    expect(
      mutate((r) => {
        delete ((r["crossChapter"] as Record<string, Record<string, unknown>>)["characterAbsent"] ?? {})[
          "minor"
        ];
      }),
    ).toThrow(/characterAbsent\.minor/u);
  });

  it("根节点不是映射", () => {
    expect(() => parseRules("- 1\n- 2\n")).toThrow(/根节点必须是映射/u);
  });

  it("fatigueWords 缺 common 即抛，题材档可缺", () => {
    expect(
      mutate((r) => {
        delete (r["fatigueWords"] as Record<string, unknown>)["common"];
      }),
    ).toThrow(/fatigueWords\.common/u);

    const rules = mutate((r) => {
      delete (r["fatigueWords"] as Record<string, unknown>)["scifi"];
    })() as ReturnType<typeof buildRules>;
    expect(rules.fatigueWords["scifi"]).toBeUndefined();
    expect(rules.fatigueWords["common"]?.length).toBeGreaterThan(0);
  });
});

describe("代码里没有数字（§10.1 的回退防线）", () => {
  /**
   * 扫描四个"只做算术、不持有系数"的目录。
   *
   * 白名单只放数学与索引意义上的数字（0/1/2/4/100/1000）。任何阈值、字数、
   * 系数出现在这些文件里都视为回退 —— §10.1 的核心原则是所有阈值都是
   * f(章节类型, 内容负载, 题材, 平台) 的输出，写死一个就破一个。
   *
   * store/ 也在扫描范围内：断线阈值曾经写死在 project.ts 里，那份拷贝与
   * gate/cross-chapter.ts 读的 rules 会静默分歧。
   */
  const SCANNED = [
    "src/beat",
    "src/gate",
    "src/text",
    "src/store",
    // M3 新增。告警的 impact / decay / 方向系数 / 疲劳因子全是数字，
    // §12.6.4 那批系数已进 rules.yaml 的 alerts 段，这三个目录只做算术。
    "src/alerts",
    "src/anchor",
    "src/view",
  ];
  const ALLOWED = new Set(["0", "1", "2", "4", "100", "1000"]);

  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const files = SCANNED.flatMap((dir) => globSync(`${dir}/**/*.ts`, { cwd: repoRoot }));

  /**
   * 去掉注释、字符串与正则字面量，保留行数。
   *
   * 保留行数的理由：报出行号才能直接跳过去改。所以剔除时用等量换行替换，
   * 而不是删掉整段。
   */
  function stripNonCode(src: string): string {
    const blanked = (s: string): string => s.replace(/[^\n]/gu, " ");
    return src
      .replace(/\/\*[\s\S]*?\*\//gu, blanked) // 块注释（含 JSDoc）
      .replace(/\/\/[^\n]*/gu, blanked) // 行注释
      .replace(/`(?:[^`\\]|\\[\s\S])*`/gu, blanked) // 模板串
      .replace(/"(?:[^"\\]|\\[\s\S])*"/gu, blanked) // 双引号串
      .replace(/'(?:[^'\\]|\\[\s\S])*'/gu, blanked) // 单引号串
      .replace(/(?<=[=(,:[]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[a-z]*/gu, blanked);
  }

  it("扫到了文件（防止 glob 写错导致测试空转）", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`${file} 不含硬编码的阈值/字数常量`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const lines = src.split("\n");
      const offenders: string[] = [];

      stripNonCode(src)
        .split("\n")
        .forEach((code, i) => {
          for (const m of code.matchAll(/\b\d+(?:\.\d+)?\b/gu)) {
            const raw = m[0];
            if (ALLOWED.has(raw)) continue;
            offenders.push(`${i + 1}: ${raw} — ${(lines[i] ?? "").trim()}`);
          }
        });

      expect(offenders, `把这些数字移进 rules.yaml：\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});
