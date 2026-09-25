import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useLazyProbe,
  type IntersectionObserverLikeEntry,
} from "@/features/install/hooks/useLazyProbe";

interface ObserverHandle {
  cb: (entries: IntersectionObserverLikeEntry[]) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  trigger(isIntersecting: boolean): void;
}

let lastMockInstance: ObserverHandle | null = null;
class MockIntersectionObserver {
  // 显式返回对象让 `new` 替代 class 实例,这样 hook 看到的 observer 就是这个对象,
  // 能调用 observe/disconnect/unobserve 等实例方法
  constructor(cb: (entries: IntersectionObserverLikeEntry[]) => void) {
    const handle: ObserverHandle = {
      cb,
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
      trigger(isIntersecting: boolean) {
        cb([{ isIntersecting }]);
      },
    };
    lastMockInstance = handle;
    return handle;
  }
}

const originalIntersectionObserver = (globalThis as { IntersectionObserver?: unknown })
  .IntersectionObserver;

beforeEach(() => {
  lastMockInstance = null;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    originalIntersectionObserver;
});

describe("useLazyProbe", () => {
  it("does not probe until the element intersects", () => {
    const probe = vi.fn().mockResolvedValue("value");

    const { result } = renderHook(() => useLazyProbe("octo", "cat", probe));

    expect(result.current.state).toEqual({ kind: "idle" });
    expect(probe).not.toHaveBeenCalled();

    const node = document.createElement("li");
    act(() => {
      result.current.ref(node);
    });

    expect(lastMockInstance).not.toBeNull();
    expect(lastMockInstance?.observe).toHaveBeenCalledWith(node);
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes exactly once after the element intersects", async () => {
    const data = { hasSkill: true, hasPlugin: false, hasMcp: true };
    const probe = vi.fn().mockResolvedValue(data);

    const { result } = renderHook(() => useLazyProbe("octo", "cat", probe));
    const node = document.createElement("li");
    act(() => {
      result.current.ref(node);
    });

    const observer = lastMockInstance;
    expect(observer).not.toBeNull();

    await act(async () => {
      observer?.trigger(true);
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("octo", "cat");
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "ok", data });
  });

  it("ignores entries that are not intersecting", () => {
    const probe = vi.fn().mockResolvedValue("value");
    const { result } = renderHook(() => useLazyProbe("octo", "cat", probe));
    const node = document.createElement("li");
    act(() => {
      result.current.ref(node);
    });

    const observer = lastMockInstance;
    act(() => {
      observer?.trigger(false);
    });

    expect(probe).not.toHaveBeenCalled();
    expect(observer?.disconnect).not.toHaveBeenCalled();
  });

  it("captures errors into the error state", async () => {
    const probe = vi
      .fn()
      .mockRejectedValue(new Error("API rate limit exceeded"));

    const { result } = renderHook(() => useLazyProbe("octo", "cat", probe));
    const node = document.createElement("li");
    act(() => {
      result.current.ref(node);
    });
    const observer = lastMockInstance;

    await act(async () => {
      observer?.trigger(true);
    });

    expect(result.current.state).toEqual({
      kind: "error",
      message: "API rate limit exceeded",
    });
  });

  it("falls back to an immediate probe when IntersectionObserver is missing", async () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      undefined;
    const probe = vi.fn().mockResolvedValue("v");

    const { result } = renderHook(() => useLazyProbe("octo", "cat", probe));
    const node = document.createElement("li");
    act(() => {
      result.current.ref(node);
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("octo", "cat");
    await act(async () => {});
    expect(result.current.state).toEqual({ kind: "ok", data: "v" });
  });

  it("resets state to idle when owner or name changes", async () => {
    const initialProbe = vi.fn().mockResolvedValue("first");
    const { result, rerender } = renderHook(
      ({ owner, name }: { owner: string; name: string }) =>
        useLazyProbe(owner, name, initialProbe),
      { initialProps: { owner: "octo", name: "cat" } },
    );

    const node = document.createElement("li");
    act(() => {
      result.current.ref(node);
    });
    const observer = lastMockInstance;
    await act(async () => {
      observer?.trigger(true);
    });

    expect(result.current.state).toEqual({ kind: "ok", data: "first" });

    rerender({ owner: "octo", name: "dog" });
    expect(result.current.state).toEqual({ kind: "idle" });
  });
});
