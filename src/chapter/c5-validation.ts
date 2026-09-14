/** 验证模型输出与作者纠错的字段形状；宽松 parseC5 仍负责领域引用和锚点。 */
import { C5_OUTPUT_SCHEMA } from "./c5-schema.js";

export interface OutputShape {
  readonly type: string | readonly string[];
  readonly properties?: Readonly<Record<string, OutputShape>>;
  readonly items?: OutputShape;
  readonly required?: readonly string[];
  readonly enum?: readonly unknown[];
  readonly additionalProperties?: boolean;
  readonly maxItems?: number;
}

export function c5OutputIssue(value: unknown): string | null {
  return outputShapeIssue(value, C5_OUTPUT_SCHEMA as unknown as OutputShape, "C5");
}

export function outputShapeIssue(value: unknown, shape: OutputShape, path: string): string | null {
  const types = typeof shape.type === "string" ? [shape.type] : shape.type;
  const matches = types.some(type => type === "null" ? value === null
    : type === "array" ? Array.isArray(value)
      : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isSafeInteger(value) : typeof value === type);
  if (!matches || (shape.enum !== undefined && !shape.enum.includes(value))) return `${path}：字段类型或值无效`;
  if (Array.isArray(value)) {
    if (shape.maxItems !== undefined && value.length > shape.maxItems) return `${path}：超出条目上限 ${shape.maxItems}`;
    for (const [index, item] of value.entries()) {
      const issue = outputShapeIssue(item, shape.items!, `${path}[${index}]`);
      if (issue !== null) return issue;
    }
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of shape.required ?? []) if (!Object.hasOwn(record, key)) return `${path}：缺少 ${key}`;
    for (const [key, item] of Object.entries(record)) {
      const child = shape.properties?.[key];
      if (child === undefined) {
        if (shape.additionalProperties === false) return `${path}：不允许字段 ${key}`;
        continue;
      }
      const issue = outputShapeIssue(item, child, `${path}.${key}`);
      if (issue !== null) return issue;
    }
  }
  return null;
}
