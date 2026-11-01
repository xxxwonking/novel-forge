/** 新增使用下一空编号；编辑仍按原编号 upsert，不改变正文的下一章。 */
export function nextPlanChapter(nextWritten: number, beats: readonly { chapter: number }[]): number {
  return Math.max(nextWritten, ...beats.map(b => b.chapter + 1));
}

export function nextVolumeNumber(volumes: readonly { volume: number }[], beats: readonly { volume: number }[]): number {
  return Math.max(0, ...volumes.map(v => v.volume), ...beats.map(b => b.volume)) + 1;
}
