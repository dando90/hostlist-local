(() => {
  if (location.hostname !== "127.0.0.1" || location.port !== "18765") return;

  // React owns the page DOM; announce availability through a handshake instead
  // of changing HTML attributes or text before hydration has completed.
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== "HOSTLIST_BRIDGE_PING"
    ) return;
    window.postMessage(
      { type: "HOSTLIST_BRIDGE_STATUS", connected: true },
      location.origin,
    );
  });

  const status = (text, isError = false) => {
    const element = document.getElementById("open-status");
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("error", isError);
  };

  const openProfile = (hostId) => browser.runtime.sendMessage({ type: "HOSTLIST_OPEN_PROFILE", hostId });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "HOSTLIST_DATA_CHANGED") return undefined;
    window.postMessage({
      type: "HOSTLIST_DATA_CHANGED",
      kind: message.kind,
      hostId: message.hostId,
      capturedAt: message.capturedAt,
    }, location.origin);
    return undefined;
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data || event.data.type !== "HOSTLIST_OPEN_PROFILE") return;
    const { hostId, requestId } = event.data;
    if (!/^[a-zA-Z0-9_-]+$/.test(String(hostId || "")) || typeof requestId !== "string") {
      window.postMessage({ type: "HOSTLIST_OPEN_PROFILE_RESULT", requestId, ok: false, message: "Richiesta di apertura non valida." }, location.origin);
      return;
    }
    openProfile(hostId).then((result) => {
      window.postMessage({ type: "HOSTLIST_OPEN_PROFILE_RESULT", requestId, ...result }, location.origin);
    }).catch((error) => {
      window.postMessage({ type: "HOSTLIST_OPEN_PROFILE_RESULT", requestId, ok: false, message: `Errore dell’estensione: ${error.message}` }, location.origin);
    });
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-host-id]");
    if (!button) return;
    event.preventDefault();

    const hostId = button.dataset.openHostId;
    if (!/^[a-zA-Z0-9_-]+$/.test(hostId || "")) {
      status("ID host non valido.", true);
      return;
    }

    status("Apertura della scheda profilo…");
    try {
      const result = await openProfile(hostId);
      status(result?.message || "Richiesta completata.", !result?.ok);
    } catch (_) {
      status("Estensione non disponibile: ricaricala da about:debugging.", true);
    }
  }, true);
})();
