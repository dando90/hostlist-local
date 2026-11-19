import test from "node:test";
import assert from "node:assert/strict";
import { getJson, postJson, postJsonAllowError, postRequest } from "../src/shared/api-client.ts";
import { getBatchConcurrency, getBatchRetryDelay } from "../src/features/hosts/batch-policy.ts";

test("GET requests disable caching and decode typed JSON", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.cache, "no-store");
    return Response.json({ hosts: 3 });
  };
  try {
    assert.deepEqual(await getJson("/api/status"), { hosts: 3 });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("POST requests surface server errors and preserve invalid JSON diagnostics", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "Rifiutato" }, { status: 400 });
  try {
    await assert.rejects(postJson("/api/action", {}), /Rifiutato/);
    globalThis.fetch = async () => new Response("bad response", { status: 502 });
    await assert.rejects(postJson("/api/action", {}, { invalidJsonMessage: (status, text) => `${status}: ${text}` }), /502: bad response/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fire-and-forget POST checks HTTP status without requiring a response body", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    await assert.doesNotReject(postRequest("/api/favorite", { hostId: "7", favorite: true }));
    globalThis.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(postRequest("/api/favorite", {}), /HTTP 503/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("batch POST keeps non-success JSON available for skip and retry policy", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ skipped: "in_progress" }, { status: 409 });
  try {
    const result = await postJsonAllowError("/api/analysis", { hostId: "7" });
    assert.equal(result.response.status, 409);
    assert.equal(result.data.skipped, "in_progress");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("batch policy preserves sequential deterministic work and caps AI concurrency", () => {
  assert.equal(getBatchConcurrency("deterministic", 20), 1);
  assert.equal(getBatchConcurrency("ai", 3), 3);
  assert.equal(getBatchConcurrency("ai", 9), 5);
});

test("batch retry delay respects exponential backoff and Retry-After", () => {
  assert.equal(getBatchRetryDelay(0), 1000);
  assert.equal(getBatchRetryDelay(1, 5000, 50), 5050);
  assert.equal(getBatchRetryDelay(2, 500, 25), 4025);
});
