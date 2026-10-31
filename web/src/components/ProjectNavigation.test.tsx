import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectNavigation } from "./ProjectNavigation.js";

describe("项目导航迁移", () => {
  it("带查询的页面仍标记当前入口，动态章号与待办入口保持准确", () => {
    const html = renderToStaticMarkup(createElement(ProjectNavigation, {
      route: "/chat?mode=planning", title: "雨夜当铺", currentChapter: 175, nextChapter: 176,
      alertCount: 7, revisionPending: 2, onNavigate: () => {},
    }));
    expect(html).toMatch(/href="#\/chat"[^>]*aria-current="page"/);
    expect(html).toContain("下一章 176");
    expect(html).toContain('href="#/chapter/175"');
    expect(html).toContain('href="#/revision"');
    expect(html).toContain('aria-label="跨章返修，2 项"');
  });
  it("正文深链接标记阅读入口，不伪造未处理返修", () => {
    const html = renderToStaticMarkup(createElement(ProjectNavigation, {
      route: "/chapter/1?quote=test", title: "新作品", currentChapter: 175, nextChapter: 176,
      alertCount: 0, revisionPending: 0, onNavigate: () => {},
    }));
    expect(html).toMatch(/href="#\/chapter\/175"[^>]*aria-current="page"/);
    expect(html).not.toContain('href="#/revision"');
  });
});
