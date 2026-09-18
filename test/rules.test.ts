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
   * 扫描「只做算术、不持有系数」的目录。
   *
   * 白名单只放数学与索引意义上的数字（0/1/2/4/100/1000）。任何阈值、字数、系数
   * 出现在这些文件里都视为回退 —— §10.1 的核心原则是所有阈值都是 f(章节类型,
   * 内容负载, 题材, 平台) 的输出，写死一个就破一个。
   *
   * store/ 也在扫描范围内：断线阈值曾经写死在 project.ts 里，那份拷贝与
   * gate/cross-chapter.ts 读的 rules 会静默分歧。
   *
   * context/ metrics/ types/ 是后加的：`DUE_SOON_WINDOW = 5` 曾在 build-l2.ts 里
   * 与 rules.yaml 的 crossChapter.foreshadowDueSoon 各执一值 —— 那条防线漏掉它，
   * 只是因为这三个目录当时不在名单里。
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
    "src/context",
    "src/metrics",
    "src/types",
  ];
  const ALLOWED = new Set(["0", "1", "2", "4", "100", "1000"]);

  /**
   * 就地登记的具名常量：**声明内部**的数字不算回退。
   *
   * 清单不是垃圾桶，每条都要说清楚为什么它**不该**进 rules.yaml。判断线是
   * §10.1 那句：它随章节类型 / 题材 / 平台 / 内容负载变化吗？会，就该进
   * rules.yaml（那是那条线上所有阈值的唯一去处）；不会 —— 上游 API 的事实、
   * 落盘格式的契约、验收门槛、§13 的上下文布局预算 —— 就留在这里并登记。
   *
   * 登记按**声明名**，所以新加一个阈值常量仍会被挡住，哪怕它长得跟已登记的
   * 一模一样：`DUE_SOON_WINDOW = 5` 当年就是这样从防线下面溜过去的。
   */
  const REGISTERED = new Map<string, string>([
    // 上游 API 的事实，不是我们的设定。
    ["MIN_CACHEABLE_TOKENS", "Anthropic 提示缓存对可缓存前缀的最小长度要求，随上游变，我们不调。"],
    // §13 的上下文布局预算。它们决定模型看到多少，但不随章节类型/题材派生。
    ["MINOR_CHARACTER_WINDOW", "§13.4 名录裁剪：次要角色只列最近这么多章出现过的。布局参数。"],
    ["SYNOPSIS_DECAY", "§13.4 梗概的距离衰减分档。布局参数。"],
    ["L1_TOKEN_BUDGET", "§13.3 段 1 的软硬上限。布局参数。"],
    ["L3_TOKEN_BUDGET", "§13.1 段 3 的预算。布局参数。"],
    ["CJK_TOKENS_PER_CHAR", "token 估算系数，只影响预算估得准不准，不构成任何产品阈值。"],
    ["EXCERPT_MAX_CHARS", "预算溢出降级时埋设片段的字符上限，同上，是布局不是阈值。"],
    // 度量与格式契约。
    ["HIT_TOLERANCE", "§13.8 判定整段命中时的容差；上游计数有抖动，不能要求严格相等。"],
    ["LAST_CACHEABLE_SEGMENT", "§13.1 四段布局里最后一个可缓存段的序号。结构，不是阈值。"],
    ["L2_REBUILD_LIMITS", "§13.4 L2 重建的合并判定阈值；改它会改缓存契约，不是产品旋钮。"],
    ["M1_CACHE_TARGETS", "§13.8 M1 的验收门槛，只在验收脚本里比对，不参与运行期判断。"],
    ["C5_LIMITS", "结构声明的条数上限，是 schema 契约。"],
    ["EventWeight", "§11.4 的权重类型，取值本身就是格式定义。"],
    ["ContextSegment", "§13.1 的四段布局，段序是格式定义。"],
  ]);

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

  /**
   * 已登记声明覆盖的行号区间。
   *
   * 用一个花括号/方括号计数把声明体圈出来 —— 多行对象字面量（`L2_REBUILD_LIMITS`）
   * 的成员行上并没有声明名，只按行匹配名字会漏掉它们。
   */
  function registeredLines(code: string): ReadonlySet<number> {
    const lines = code.split("\n");
    const covered = new Set<number>();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const name = /^\s*(?:export\s+)?(?:const|let|type|function|class)\s+([A-Za-z_$][\w$]*)/u.exec(line)?.[1];
      if (name === undefined || !REGISTERED.has(name)) continue;
      let depth = 0;
      for (let j = i; j < lines.length; j += 1) {
        covered.add(j);
        const text = lines[j] ?? "";
        for (const ch of text) {
          if (ch === "{" || ch === "[" || ch === "(") depth += 1;
          else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
        }
        if (depth <= 0 && text.includes(";")) { i = j; break; }
        if (depth <= 0 && j > i) { i = j - 1; break; }
      }
    }
    return covered;
  }

  /** 登记清单自身要说得清：每条都得有理由，否则它会慢慢变成垃圾桶。 */
  it("登记的常量都写了理由", () => {
    for (const [name, reason] of REGISTERED) expect(reason.length, `${name} 没有说清为什么不进 rules.yaml`).toBeGreaterThan(8);
  });

  it("扫到了文件（防止 glob 写错导致测试空转）", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`${file} 不含硬编码的阈值/字数常量`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const lines = src.split("\n");
      const code = stripNonCode(src);
      const registered = registeredLines(code);
      const offenders: string[] = [];

      code.split("\n").forEach((line, i) => {
        if (registered.has(i)) return;
        for (const m of line.matchAll(/\b\d+(?:\.\d+)?\b/gu)) {
          const raw = m[0];
          if (ALLOWED.has(raw)) continue;
          offenders.push(`${i + 1}: ${raw} — ${(lines[i] ?? "").trim()}`);
        }
      });

      expect(offenders,
        `把这些数字移进 rules.yaml；确实不该进的就提成具名常量并登记进 REGISTERED（写明理由）：\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});
