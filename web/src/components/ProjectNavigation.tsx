import { ArrowLeft, BookOpen, ClipboardList, Coins, Download, FileText, House, MessagesSquare, Network, Route, Search, TriangleAlert, Users, Waypoints, Workflow, type LucideIcon } from "lucide-react";
import { Separator } from "./ui/separator.js";

interface Props {
  route: string;
  title: string;
  currentChapter: number;
  nextChapter: number;
  alertCount: number;
  revisionPending: number;
  onNavigate: (path: string) => void;
}

export function ProjectNavigation({ route, title, currentChapter, nextChapter, alertCount, revisionPending, onNavigate }: Props): React.ReactElement {
  const path = route.split("?")[0] ?? route;
  const link = (to: string, label: string, Icon: LucideIcon, count?: number, active = path === to) => <a
    className="navigation-link" key={to} href={`#${to}`} aria-current={active ? "page" : undefined} data-active={active}
    aria-label={count === undefined || count === 0 ? undefined : `${label}，${count} 项`}
    onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(to); } }}>
    <Icon aria-hidden="true" /><span>{label}</span>{count !== undefined && count > 0 && <span className="navigation-count">{count}</span>}
  </a>;

  return <div className="project-navigation">
    <a className="navigation-link all-works" href="#/works" onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate("/works"); } }}><ArrowLeft aria-hidden="true" />全部作品</a>
    <div className="navigation-title">{title}</div>
    <div className="navigation-progress">第 {currentChapter} 章 · 下一章 {nextChapter}</div>
    <div className="navigation-section">
      {link("/chat", "对话", MessagesSquare)}
      {link("/preparation", "作品资料", ClipboardList)}
      {link("/", "首页", House)}
      {link("/alerts", "全部提示", TriangleAlert, alertCount)}
      {link("/search", "全文检索", Search)}
      {link("/credits", "用量与积分", Coins)}
    </div>
    <div className="navigation-label">结构视图</div>
    <div className="navigation-section">
      {link("/plotboard", "剧情白板", Workflow)}
      {link("/foreshadow", "伏笔时间线", Waypoints)}
      {link("/plotlines", "情节线", Route)}
      {link("/arcs", "人物弧线", Users)}
      {link("/relations", "关系图", Network)}
    </div>
    <Separator className="my-4" />
    <div className="navigation-label mt-0">正文</div>
    <div className="navigation-section">
      {revisionPending > 0 && link("/revision", "跨章返修", FileText, revisionPending)}
      {link("/export", "导出作品", Download)}
      {link(`/chapter/${Math.max(currentChapter, 1)}`, "章节与体检", BookOpen, undefined, path.startsWith("/chapter/"))}
    </div>
  </div>;
}
