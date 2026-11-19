import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hostlist-store-test-"));
process.env.HOSTLIST_DATABASE_PATH = path.join(tempRoot, "demo.sqlite3");
const store = await import("../src/server/store-demo.ts");

after(() => {
  store.db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("the demo store accepts only its compact profile shape and saves details", () => {
  const sourceUrl = "https://demo.hostlist.example/demo-api/hosts?pageStart=1&pageCount=20";
  const saved = store.saveCapture({
    sourceUrl,
    payload: {
      totalRows: 1,
      records: [{
        id: "demo-101",
        fullname: "Ada Demo",
        company: "Sample Workshop",
        country: "Italy",
        city: "Bologna",
        primary_domain: "Software",
        privateExtra: "discard this field",
      }],
    },
  });

  assert.equal(saved.savedRows, 1);
  const host = store.readHost("demo-101");
  assert.equal(host.fullname, "Ada Demo");
  assert.equal(host.company, "Sample Workshop");
  assert.equal("privateExtra" in host, false);

  const detail = store.saveHostDetail({
    sourceUrl: "https://demo.hostlist.example/demo-api/hosts/demo-101",
    payload: { id: "demo-101", motivation: "Build useful digital tools", specific_skills: "TypeScript" },
  });
  assert.equal(detail.hostId, "demo-101");
  assert.equal(store.readHost("demo-101").savedDetail.fields.motivation, "Build useful digital tools");
  assert.ok(store.analyzeHostDeterministically("demo-101"));
});

test("the demo store rejects captures from an unconfigured origin", () => {
  assert.throws(() => store.saveCapture({
    sourceUrl: "https://other.example/demo-api/hosts",
    payload: { records: [] },
  }), /Sorgente demo non riconosciuta/);
});
