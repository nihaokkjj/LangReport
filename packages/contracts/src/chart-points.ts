export const MAX_CHART_POINTS = 10_000;

export function chartPointBudgetMessage(pointCount: number): string {
  return `图表绘制结果为 ${pointCount} 个点，超过 ${MAX_CHART_POINTS} 个点的上限。请先按时间或类别聚合，再重新生成图表；系统不会自动截断数据。`;
}
