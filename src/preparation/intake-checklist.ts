/** 有明确“角色名称/姓名”列的档案表提供覆盖清单，不替模型判断实体是否是真实人物。 */
export function materialCharacterNames(materials:readonly {text:string}[]):readonly string[] {
  const names=new Set<string>();
  const clean=(s:string)=>s.replace(/[*`]/gu,"").trim();
  for(const material of materials){
    let column=-1;
    for(const line of material.text.split(/\r?\n/u)){
      if(!line.trim().startsWith("|")){column=-1;continue;}
      const cells=line.trim().replace(/^\||\|$/gu,"").split("|").map(clean);
      const heading=cells.findIndex(c=>/^(角色名称|人物名称|姓名|角色名|人物|角色)$/u.test(c));
      if(heading>=0){column=heading;continue;}
      if(column<0 || cells.every(c=>/^[-: ]*$/u.test(c))) continue;
      const name=cells[column];if(name && name.length<=80) names.add(name);
    }
  }
  return [...names];
}

const chapterHeading = /^\s*(?:#{1,6}\s+)?(?:第\s*[\d０-９〇零一二三四五六七八九十百千两]+\s*[章回节]|chapter\s+\d+)(?:\s|$)/iu;

/** 连续目录标题不算叙事；只有章标题后有具体内容时才要求剧情候选覆盖。 */
export function materialOutlineSections(materials: readonly { name: string; text: string }[]): readonly { file: string; heading: string; body: string }[] {
  const sections: { file: string; heading: string; body: string }[] = [];
  for (const material of materials) {
    let heading: string | null = null;
    let body: string[] = [];
    const flush = () => {
      const content = body.join("\n").trim();
      if (heading !== null && content !== "") sections.push({ file: material.name, heading, body: content });
    };
    for (const line of material.text.split(/\r?\n/u)) {
      if (chapterHeading.test(line)) { flush(); heading = line.trim(); body = []; }
      else if (heading !== null) body.push(line);
    }
    flush();
  }
  return sections;
}

export function uncoveredOutlineSections(
  materials: readonly { name: string; text: string }[],
  nodes: readonly { source: { file: string; quote: string } }[],
): ReturnType<typeof materialOutlineSections> {
  return materialOutlineSections(materials).filter(section => !nodes.some(node => {
    if (node.source.file !== section.file) return false;
    const narrative = node.source.quote.split(/\r?\n/u).filter(line => !chapterHeading.test(line)).join("\n").trim();
    return narrative !== "" && (section.body.includes(narrative) || narrative.includes(section.body));
  }));
}
