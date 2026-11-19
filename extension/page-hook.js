(() => {
  if (window.__hostListHookInstalled) return;
  window.__hostListHookInstalled = true;

  const kindFor = (url, payload) => {
    const parsed = new URL(url, location.href);
    if (!parsed.pathname.startsWith("/demo-api/hosts")) return null;
    const detail = parsed.pathname.match(/^\/demo-api\/hosts\/(\d+)\/?$/);
    if (detail && payload && String(payload.id ?? payload.hostId ?? "") === detail[1]) return { kind: "host-detail", hostId: detail[1] };
    if (/^\/demo-api\/hosts\/?$/.test(parsed.pathname) && payload && Array.isArray(payload.records)) return { kind: "list" };
    return null;
  };

  const publish = (url, payload) => {
    try {
      const match = kindFor(url, payload);
      if (match) window.postMessage({ type: "HOSTLIST_CAPTURE", ...match, sourceUrl: url, payload }, location.origin);
    } catch {}
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
    return originalFetch.apply(this, args).then((response) => {
      if (response.ok) response.clone().json().then((json) => publish(response.url || requestUrl, json)).catch(() => {});
      return response;
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__hostListUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      if (this.status < 200 || this.status >= 300) return;
      try {
        const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
        publish(this.responseURL || this.__hostListUrl, payload);
      } catch {}
    }, { once: true });
    return originalSend.apply(this, args);
  };
})();
