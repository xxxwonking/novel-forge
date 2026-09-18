/**
 * 卷的章号范围。
 *
 * **卷的边界只有一份真相：`Beat.volume`。** 卷名与卷纲另存 `volumes.json`，但那里
 * 不存章号 —— 存两份边界必然分歧，而节拍表本来就是按章排的，它才是那份真相。
 *
 * 所以这里是纯推导：把节拍表按卷归并成闭区间。卷号不连续、章号有缺口都允许
 * （作者可以先排第 30 章再回头补第 25 章），区间取该卷的最小与最大章号。
 */

import type { ChapterBeat } from "../types/beat.js";
import type { ChapterNo, VolumeNo } from "../types/primitives.js";

export interface VolumeRange {
  readonly volume: VolumeNo;
  readonly from: ChapterNo;
  readonly to: ChapterNo;
}

export function volumeRanges(beats: readonly ChapterBeat[]): readonly VolumeRange[] {
  const bounds = new Map<VolumeNo, { from: ChapterNo; to: ChapterNo }>();
  for (const beat of beats) {
    const current = bounds.get(beat.volume);
    if (current === undefined) bounds.set(beat.volume, { from: beat.chapter, to: beat.chapter });
    else {
      if (beat.chapter < current.from) current.from = beat.chapter;
      if (beat.chapter > current.to) current.to = beat.chapter;
    }
  }
  return [...bounds.entries()]
    .map(([volume, span]) => ({ volume, ...span }))
    .sort((a, b) => a.volume - b.volume);
}

/** 第 N 章属于哪一卷。没有节拍表的章返回 null —— 不猜。 */
export function volumeOf(beats: readonly ChapterBeat[], chapter: ChapterNo): VolumeNo | null {
  return beats.find((beat) => beat.chapter === chapter)?.volume ?? null;
}
