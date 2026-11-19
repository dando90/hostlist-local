(() => {
  const script = document.createElement("script");
  script.src = browser.runtime.getURL("page-hook.js");
  script.onload = () => script.remove();
  (document.documentElement || document).appendChild(script);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "HOSTLIST_CAPTURE") return;
    browser.runtime.sendMessage({
      type: "HOSTLIST_CAPTURE",
      kind: event.data.kind,
      hostId: event.data.hostId,
      sourceUrl: event.data.sourceUrl,
      payload: event.data.payload
    }).catch(() => {});
  });
})();
