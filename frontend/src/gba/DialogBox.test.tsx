import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { DialogBox } from "./DialogBox";

const host = document.createElement("div");
document.body.appendChild(host);
afterEach(() => { act(() => render(null, host)); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(reduced = false) {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: () => {}, removeEventListener: () => {} }));
}
it("skip retains the complete text through subsequent timer ticks", () => {
  setup();
  act(() => render(<DialogBox lines={["Una pregunta larga"]} />, host));
  act(() => host.querySelector("button")!.click());
  expect(host.querySelector("span[aria-hidden]")?.textContent).toBe("Una pregunta larga");
  act(() => { vi.advanceTimersByTime(100); });
  expect(host.querySelector("span[aria-hidden]")?.textContent).toBe("Una pregunta larga");
});
it("reduced motion renders instantly and advances the queue", () => {
  setup(true);
  const completed = vi.fn();
  act(() => render(<DialogBox lines={["Primera", "Final"]} onComplete={completed} />, host));
  expect(host.querySelector("span[aria-hidden]")?.textContent).toBe("Primera");
  act(() => host.querySelector("button")!.click());
  expect(host.querySelector("span[aria-hidden]")?.textContent).toBe("Final");
  act(() => host.querySelector("button")!.click());
  expect(completed).toHaveBeenCalledOnce();
});
