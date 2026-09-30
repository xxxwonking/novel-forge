/**
 * 选一条反推路线。
 *
 * 同一个目标（把空白的结构补出来）有两条路，代价差一到两个量级。这个对话框存在的
 * 唯一理由是**让两个数字摆在一起** —— 没有它，两个按钮只能靠文案比"听起来谁更仔细"，
 * 而更仔细的那条恰好是按章计费的那条。
 *
 * 显示纪律与服务端的估算纪律对齐：
 *   - `credits: null` 显示"折不出积分"，不显示 0 —— 那是"不知道"，不是"免费"。
 *   - `basis: "ceiling"` 显示"最多"，不显示"约"。上限推算里输出占九成以上，
 *     实际通常只有四分之一；把它说成"约"，作者第二次就不会再信这个数。
 *   - 次数区间照原样显示，不取一端。取哪端都是在替作者猜。
 */

import { Button, Modal } from "antd";
import { api, type InferenceEstimate } from "../api.js";
import { Chip } from "./Chip.js";
import { useFetch } from "../hooks.js";

export interface InferenceChooserProps {
  /** 选了「从资料反推」：交给资料页去开起草对话框。 */
  onMaterials: () => void;
  /** 选了「逐章反推正文」：跳到反推页。 */
  onChapters: () => void;
  onClose: () => void;
}

interface Copy {
  readonly title: string;
  readonly reads: string;
  readonly yields: string;
  readonly caveat: string;
  readonly action: string;
}

const COPY: Record<InferenceEstimate["key"], Copy> = {
  materials: {
    title: "从资料反推伏笔",
    reads: "读你的大纲、简介，加正文抽样的六段章首",
    yields: "伏笔规划：时间线上的虚线，只有期限，没有埋点",
    caveat: "只认资料里写明的安排。资料里没写的伏笔认不出来 —— 六段章首读不出中段埋的东西。",
    action: "读资料，起草一份方案",
  },
  chapters: {
    title: "从正文逐章反推",
    reads: "一章一章读完整正文",
    yields: "事件、出场、关系与伏笔埋设：时间线上的实线，每条都能点回原文",
    caveat: "一章一次调用，要逐章确认。中途可以停，已确认的章不会重跑。",
    action: "去逐章反推",
  },
};

export function InferenceChooser({ onMaterials, onChapters, onClose }: InferenceChooserProps): React.ReactElement {
  const { data, error, loading } = useFetch(() => api.inferenceEstimate(), []);
  const pick = { materials: onMaterials, chapters: onChapters };

  return <Modal open className="prep-editor" title="反推故事结构" width={760} onCancel={onClose} footer={[<Button key="cancel" onClick={onClose}>先不反推</Button>]}>
    <p className="muted">
      导进来的正文只有字，没有结构 —— 伏笔时间线、情节线、关系图都要靠反推才长出来。
      两条路做的是同一件事，区别在读什么、产出什么形态、花多少。
    </p>
    {error !== null && <div className="finding" role="alert" data-level="warn">读不到费用预估：{error}。两条路仍然可以走，只是这次看不到数字。</div>}
    <div className="infer-choices">
      {(["materials", "chapters"] as const).map((key) => {
        const mode = data?.modes.find((m) => m.key === key);
        const copy = COPY[key];
        return <article className="infer-choice" key={key}>
          <h3>{copy.title}</h3>
          <p className="infer-cost">{loading ? <span className="muted">正在估算…</span> : mode === undefined ? <span className="muted">—</span> : <Cost mode={mode} />}</p>
          <dl className="prep-facts">
            <div><dt>读什么</dt><dd>{copy.reads}</dd></div>
            <div><dt>产出</dt><dd>{copy.yields}</dd></div>
          </dl>
          <p className="muted">{copy.caveat}</p>
          <Button type={key === "materials" ? "primary" : "default"} onClick={() => { onClose(); pick[key](); }}>{copy.action}</Button>
        </article>;
      })}
    </div>
    <p className="muted infer-basis">
      {data?.modes[0]?.basis === "measured"
        ? `预估按这个作品已有调用的实测均价算（样本 ${data.modes.map((m) => m.samples).join(" / ")} 次）。`
        : <>预估按声明的输出上限推算，<strong>必然偏高</strong> —— 实际输出通常只有上限的四分之一。攒够三次同类调用后会改按实测均价算。</>}
      {data?.modes.some((m) => m.credits === null) === true && " 价格表里没有当前配置的模型，那一档折不出积分：调用照样记用量，但不会扣。"}
    </p>
  </Modal>;
}

/** 次数确定时不画区间；积分同理。区间两端相同还写成 a~b，作者会以为哪里不确定。 */
function Cost({ mode }: { mode: InferenceEstimate }): React.ReactElement {
  const calls = mode.calls.min === mode.calls.max ? `${mode.calls.min} 次调用` : `${mode.calls.min}–${mode.calls.max} 次调用`;
  const credits = mode.credits === null ? "折不出积分"
    : mode.basis === "measured"
      ? `约 ${round(mode.credits.min)}${mode.credits.min === mode.credits.max ? "" : `–${round(mode.credits.max)}`} 积分`
      : `最多 ${round(mode.credits.max)} 积分`;
  return <>
    <strong>{credits}</strong>
    <Chip>{calls}</Chip>
    <span className="muted">{mode.model || "模型未配置"}</span>
  </>;
}

/** 不到 10 留一位小数：两条路差一个量级时，取整会把便宜的那条显示成 0。 */
function round(credits: number): string {
  return credits >= 10 ? String(Math.round(credits)) : credits.toFixed(1);
}
