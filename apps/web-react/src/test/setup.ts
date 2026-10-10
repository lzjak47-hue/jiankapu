/**
 * Vitest 全局初始化
 * ---------------------------------------------------------------------------
 * 补上 jsdom 缺失的浏览器 API，并统一清理 React 测试的副作用。
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/* jsdom 没有实现 matchMedia / IntersectionObserver，组件里用到了 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * jsdom 没有实现 IntersectionObserver，商品列表与各区块的入场动画依赖它。
 *
 * 这里的替身会**立即以 isIntersecting: true 回调**，
 * 与真实浏览器的行为一致（真实实现初始化时也会为每个被观察元素回调一次）。
 * 这样「某个元素压根没被 observe 到」就会表现为它拿不到 is-in，
 * 从而能被测试抓到 —— 这正是之前「为什么选择简卡铺」整块不可见的成因。
 */
class MockIntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
  #callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    this.#callback(
      [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }

  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (!("IntersectionObserver" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;
}

/* 滚动到顶部是 jsdom 未实现的 */
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

/* 每个用例后卸载组件，避免 DOM 串味 */
afterEach(() => {
  cleanup();
});
