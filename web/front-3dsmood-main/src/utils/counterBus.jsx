// Event bus rất nhẹ để báo Header cập nhật counters mà không cần reload.
// Dùng được cả trong đa tab nhờ BroadcastChannel.

export const COUNTER_EVENT_DIRTY = "user:counters:dirty";
export const COUNTER_EVENT_SET   = "user:counters:set";

export function markCountersDirty() {
  // Gọi khi bạn biết "đã thay đổi" nhưng CHƯA có số mới (ví dụ vừa add/remove)
  window.dispatchEvent(new CustomEvent(COUNTER_EVENT_DIRTY));

  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    const bc = new BroadcastChannel("user:counters");
    bc.postMessage({ type: "dirty" });
    bc.close();
  }
}

export function setCountersLive(next = {}) {
  // Gọi khi BẠN CÓ số mới từ API (khuyến nghị)
  window.dispatchEvent(new CustomEvent(COUNTER_EVENT_SET, { detail: next }));

  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    const bc = new BroadcastChannel("user:counters");
    bc.postMessage({ type: "set", payload: next });
    bc.close();
  }
}
    