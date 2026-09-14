/**
 * 主 Agent 的回复是 markdown，原样塞进气泡就会在对话栏里留下一片 ### 与 **。
 *
 * 只认它实际会用的几种：标题、有序/无序列表、分隔线、加粗、行内码；其余按段落走。
 * 不引 markdown 库，也不碰 dangerouslySetInnerHTML —— 回复里带着用户自己的文本。
 */

const HEADING = /^#{1,6}\s+(.*)$/u;
const BULLET = /^[-*]\s+(.*)$/u;
const ORDERED = /^\d+[.)]\s+(.*)$/u;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/u;
/** 加粗与行内码。带捕获组，split 会把分隔符一并留在结果里。 */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/gu;

function inline(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export function RichText({ text }: { text: string }): React.ReactElement {
  const blocks: React.ReactElement[] = [];
  let items: string[] = [];
  let ordered = false;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length === 0) return;
    blocks.push(<p key={blocks.length}>{inline(para.join("\n"))}</p>);
    para = [];
  };
  const flushList = (): void => {
    if (items.length === 0) return;
    const li = items.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(ordered ? <ol key={blocks.length}>{li}</ol> : <ul key={blocks.length}>{li}</ul>);
    items = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    if (RULE.test(line)) {
      flushPara();
      flushList();
      blocks.push(<hr key={blocks.length} />);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushPara();
      flushList();
      blocks.push(<h4 key={blocks.length}>{inline(heading[1] ?? "")}</h4>);
      continue;
    }
    const numbered = ORDERED.exec(line);
    const bullet = numbered === null ? BULLET.exec(line) : null;
    if (numbered !== null || bullet !== null) {
      flushPara();
      const nextOrdered = numbered !== null;
      if (nextOrdered !== ordered) flushList();
      ordered = nextOrdered;
      items.push(numbered?.[1] ?? bullet?.[1] ?? "");
      continue;
    }
    flushList();
    para.push(raw.trimEnd());
  }
  flushPara();
  flushList();

  return <>{blocks}</>;
}
