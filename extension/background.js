const demoOrigin = "https://demo.hostlist.example";

async function openDemoProfile(hostId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(hostId || ""))) {
    return { ok: false, message: "Identificativo profilo non valido." };
  }
  const target = `${demoOrigin}/hosts/${encodeURIComponent(hostId)}`;
  const tabs = await browser.tabs.query({ url: `${demoOrigin}/*` });
  const existing = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (existing?.id != null) await browser.tabs.update(existing.id, { url: target, active: true });
  else await browser.tabs.create({ url: target, active: true });
  return { ok: true, message: `Profilo ${hostId} aperto nella demo.` };
}

async function notifyDashboard(change) {
  const tabs = await browser.tabs.query({ url: "http://127.0.0.1/*" });
  await Promise.all(tabs.map((tab) => {
    try {
      const url = new URL(tab.url || "");
      if (url.hostname !== "127.0.0.1" || url.port !== "18765" || tab.id == null) return Promise.resolve();
      return browser.tabs.sendMessage(tab.id, { type: "HOSTLIST_DATA_CHANGED", ...change }).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }));
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "HOSTLIST_OPEN_PROFILE") return openDemoProfile(message.hostId);
  if (!message || message.type !== "HOSTLIST_CAPTURE") return undefined;
  if (!["list", "host-detail"].includes(message.kind) || !message.payload || typeof message.payload !== "object") return undefined;

  const endpoint = message.kind === "host-detail" ? "/api/host-detail" : "/api/capture";
  return fetch(`http://127.0.0.1:18765${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl: message.sourceUrl, payload: message.payload }),
  }).then(async (response) => {
    if (!response.ok) {
      console.warn("HostList: il server locale ha rifiutato una risposta.", endpoint, response.status);
      return;
    }
    const saved = await response.json();
    if (saved?.ok) await notifyDashboard({ kind: message.kind, hostId: saved.hostId, capturedAt: saved.capturedAt });
  }).catch((error) => {
    console.warn("HostList: server locale non raggiungibile. Avvia npm run dev.", error.message);
  });
});
