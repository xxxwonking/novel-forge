import { useId } from "react";
import { CheckField, NumberInput } from "./controls.js";
import type { SceneWritingOptions } from "../api.js";

export interface SceneWritingForm { enabled: boolean; maxCalls: number | null; maxCredits: number | null }
export const initialSceneWriting = (): SceneWritingForm => ({ enabled: true, maxCalls: 16, maxCredits: 50 });
export function sceneWritingOptions(form: SceneWritingForm): SceneWritingOptions | undefined {
  if (!form.enabled) return undefined;
  if (!Number.isSafeInteger(form.maxCalls) || form.maxCalls === null || form.maxCalls < 1 || form.maxCalls > 100 || form.maxCredits === null || !Number.isFinite(form.maxCredits) || form.maxCredits <= 0 || form.maxCredits > 100000) throw new Error("请填写1–100次模型调用，以及大于0且不超过100000的积分停止线。");
  return { maxCalls: form.maxCalls, maxCredits: form.maxCredits };
}
export function SceneWritingSettings({ value, onChange, disabled = false }: { value: SceneWritingForm; onChange: (value: SceneWritingForm) => void; disabled?: boolean }): React.ReactElement {
  const id = useId();
  return <fieldset className="scene-writing-settings prep-section" disabled={disabled} aria-label="新任务生成方式">
    <CheckField checked={value.enabled} onChange={enabled => onChange({ ...value, enabled })}>分场写章，逐场保存进度</CheckField>
    <p className="muted">按已确认的本章计划逐场创作，完成后统一检查。仅影响新任务，已有任务保留原配置。</p>
    {value.enabled && <><div className="prep-grid">
      <div><label htmlFor={`${id}-calls`}>每章最多模型调用次数</label><NumberInput id={`${id}-calls`} min={1} max={100} step={1} value={value.maxCalls} onChange={maxCalls => onChange({ ...value, maxCalls })} /></div>
      <div><label htmlFor={`${id}-credits`}>每章积分停止线</label><NumberInput id={`${id}-credits`} min={0.01} max={100000} value={value.maxCredits} onChange={maxCredits => onChange({ ...value, maxCredits })} /></div>
    </div><p className="muted">每章额度包含生成、检查和最多一次自动修订。积分按项目价格表与已报告用量检查，当前调用可能越过停止线，不是供应商账单硬限额。连写时每章分别计额，恢复不重置已用额度。</p></>}
  </fieldset>;
}
