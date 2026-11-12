import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeRiderMapLayout, observeRiderMapTiles, riderMapTileDetail, type RiderMapTileState } from "./riderMapLifecycle";
class VisibilityDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}
let documentMock: VisibilityDocument;
let resized: () => void;
let disconnected: ReturnType<typeof vi.fn>;
beforeEach(() => {
  documentMock = new VisibilityDocument();
  disconnected = vi.fn();
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe = vi.fn();
    disconnect = disconnected;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("map layout recovery independent of GPS fixes", () => {
  it("invalidates after an initially zero-size map becomes visible without a new GPS fix", () => {
    const node = { clientWidth: 0, clientHeight: 0 } as HTMLElement;
    const map = { invalidateSize: vi.fn() };
    const remove = observeRiderMapLayout(node, map);
    resized();
    expect(map.invalidateSize).not.toHaveBeenCalled();
    Object.assign(node, { clientWidth: 360, clientHeight: 640 });
    resized();
    expect(map.invalidateSize).toHaveBeenCalledWith({ pan: false });
    documentMock.visibilityState = "hidden";
    resized();
    expect(map.invalidateSize).toHaveBeenCalledTimes(1);
    documentMock.visibilityState = "visible";
    documentMock.dispatchEvent(new Event("visibilitychange"));
    expect(map.invalidateSize).toHaveBeenCalledTimes(2);
    remove();
    resized();
    documentMock.dispatchEvent(new Event("visibilitychange"));
    expect(map.invalidateSize).toHaveBeenCalledTimes(2);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });
  it("keeps visibility recovery when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const map = { invalidateSize: vi.fn() };
    const remove = observeRiderMapLayout({ clientWidth: 360, clientHeight: 640 } as HTMLElement, map);
    documentMock.dispatchEvent(new Event("visibilitychange"));
    expect(map.invalidateSize).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe("tile failure is not GPS or API evidence", () => {
  it("shows errors/partial loads, recovers on a successful load and removes all listeners", () => {
    const events = new EventTarget();
    const layer = {
      on: (event: string, listener: () => void) => events.addEventListener(event, listener),
      off: (event: string, listener: () => void) => events.removeEventListener(event, listener),
    };
    const states: RiderMapTileState[] = [];
    const remove = observeRiderMapTiles(layer, (state) => states.push(state));
    const emit = (event: string) => events.dispatchEvent(new Event(event));
    emit("loading"); emit("tileerror"); emit("load");
    expect(states.at(-1)).toBe("error");
    emit("loading"); emit("tileload"); emit("tileerror"); emit("load");
    expect(states.at(-1)).toBe("partial");
    emit("loading"); emit("tileload"); emit("load");
    expect(states.at(-1)).toBe("ready");
    expect(riderMapTileDetail("error")).toContain("No se conoce su causa HTTP");
    expect(riderMapTileDetail("error")).toContain("no confirma ni rechaza el envío GPS");
    expect(riderMapTileDetail("ready")).toBe("");
    const count = states.length;
    remove(); emit("loading"); emit("tileerror");
    expect(states).toHaveLength(count);
  });
});
