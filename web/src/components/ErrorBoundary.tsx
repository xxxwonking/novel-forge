/**
 * 渲染出错时只换掉出错的那一块，不要把整页白掉。
 *
 * 真机撞过：前端读了一个后端还没有的字段，一处 TypeError 让 React 卸掉整棵树，
 * 作者看到的是一片纯黑 —— 连导航栏都没了，连"换一页"都做不到，也无从判断自己的
 * 稿子还在不在。这与 §35「读坏的清单不能拖垮应用」是同一条：**局部坏掉不该等于
 * 全部没有**。
 *
 * 错误照旧抛进 console（排查要靠它的栈），这里只负责给作者留一条路。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";

interface Props {
  readonly children: ReactNode;
  /** 点「重试」时额外做的事，通常是重新取一遍数据。 */
  readonly onReset?: () => void;
}
interface State { readonly error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("页面渲染失败", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="empty" data-kind="render-failed" role="alert">
        <p>这一页没能显示出来：{error.message}</p>
        {/* 先说稿子没事。白屏最吓人的地方不是功能不能用，是不知道自己写的东西还在不在。 */}
        <p className="muted">你的稿子没有受影响 —— 这是显示出的问题，不是数据出的问题。换一页继续，或者重新载入。</p>
        <div className="row">
          <Button onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>重试</Button>
          <Button type="primary" onClick={() => location.reload()}>重新载入</Button>
        </div>
      </div>
    );
  }
}
