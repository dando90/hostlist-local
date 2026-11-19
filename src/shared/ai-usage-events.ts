const channelName = "hostlist-ai-usage";

export function notifyAiUsageUpdated() {
  if (typeof window === "undefined") return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage({ type: "updated" });
  channel.close();
}

export function subscribeToAiUsageUpdates(onUpdate: () => void) {
  if (typeof window === "undefined") return () => {};
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (event: MessageEvent) => { if (event.data?.type === "updated") onUpdate(); };
  return () => {
    channel.close();
  };
}
