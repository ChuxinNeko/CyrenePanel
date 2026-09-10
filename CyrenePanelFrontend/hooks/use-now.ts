import { useEffect, useState } from "react";

/**
 * 返回一个按固定间隔自增的时间戳。
 *
 * 「已运行 X 分」这类相对时长如果在渲染里直接读 Date.now()，既违反 React 的
 * 纯度规则（同一次渲染结果不可复现），也会让时长只在数据重新拉取时才跳一下。
 * 把当前时间提升成 state 之后，两次拉取之间时长也会自己走。
 *
 * 默认 15 秒——界面上最小的显示单位是分钟，再密没有意义。
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
