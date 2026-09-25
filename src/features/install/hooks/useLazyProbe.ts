import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 等待 DOM 进入视口(或接近视口,rootMargin=120px)再调用 probeFn。
 *
 * 用途:搜索结果列表里每条结果都会拉一次「可装入性探测」,30 条并发
 * 立刻触发对 GitHub 公开搜索的匿名用户会立即撞 60 req/h 限速。改用
 * 懒触发后,只 probe 用户实际滚到的卡片。
 *
 * 行为:
 * - 不在视口时不调用 probeFn
 * - 进入视口后只 probe 一次(observer.disconnect)
 * - 没有 IntersectionObserver 的环境(如老 jsdom)退化为立即 probe
 *
 * @returns `ref` 回调给到元素 + `state` 四态机 idle/loading/ok/error
 */
export type LazyProbeState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: T }
  | { kind: "error"; message: string };

export interface IntersectionObserverLikeEntry {
  isIntersecting: boolean;
}

export interface IntersectionObserverLike {
  observe(target: Element): void;
  disconnect(): void;
  unobserve(target: Element): void;
}

export type IntersectionObserverConstructor = new (
  callback: (entries: IntersectionObserverLikeEntry[]) => void,
  options?: { rootMargin?: string; threshold?: number | number[] },
) => IntersectionObserverLike;

const ROOT_MARGIN = "120px";

export function useLazyProbe<T>(
  owner: string,
  name: string,
  probeFn: (owner: string, name: string) => Promise<T>,
): { ref: (node: HTMLElement | null) => void; state: LazyProbeState<T> } {
  const [state, setState] = useState<LazyProbeState<T>>({ kind: "idle" });
  const probeFnRef = useRef(probeFn);
  probeFnRef.current = probeFn;

  // 重置状态当 owner/name 变化(进入新的搜索结果项)
  useEffect(() => {
    setState({ kind: "idle" });
  }, [owner, name]);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node) {
        return;
      }
      const Ctor = getIntersectionObserverConstructor();
      if (!Ctor) {
        if (state.kind === "idle") {
          runProbe(owner, name, probeFnRef.current, setState);
        }
        return;
      }
      const observer = new Ctor(
        (entries) => {
          const first = entries[0];
          if (!first || !first.isIntersecting) {
            return;
          }
          observer.disconnect();
          if (state.kind === "idle") {
            runProbe(owner, name, probeFnRef.current, setState);
          }
        },
        { rootMargin: ROOT_MARGIN, threshold: 0.01 },
      );
      observer.observe(node);
    },
    [owner, name, state],
  );

  return { ref, state };
}

function getIntersectionObserverConstructor(): IntersectionObserverConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = (window as { IntersectionObserver?: unknown })
    .IntersectionObserver;
  if (typeof candidate === "function") {
    return candidate as unknown as IntersectionObserverConstructor;
  }
  return null;
}

async function runProbe<T>(
  owner: string,
  name: string,
  probeFn: (owner: string, name: string) => Promise<T>,
  setState: (state: LazyProbeState<T>) => void,
) {
  setState({ kind: "loading" });
  try {
    const data = await probeFn(owner, name);
    setState({ kind: "ok", data });
  } catch (error) {
    setState({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
