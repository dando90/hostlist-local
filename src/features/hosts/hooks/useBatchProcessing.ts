import { useState } from "react";
import { notifyAiUsageUpdated } from "../../../shared/ai-usage-events";
import { runAnalysisBatchRequest } from "../api";
import {
  AI_BATCH_START_INTERVAL_MS,
  getBatchConcurrency,
  getBatchRetryDelay,
} from "../batch-policy";
import type { AnalysisBatch, Host, RunState } from "../types";

type Props = {
  hosts: Host[];
  setHosts: React.Dispatch<React.SetStateAction<Host[]>>;
  runRef: React.MutableRefObject<RunState | null>;
  analysisBatchRef: React.MutableRefObject<AnalysisBatch | null>;
  setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Errore imprevisto";

export function useBatchProcessing({
  hosts,
  setHosts,
  runRef,
  analysisBatchRef,
  setRefreshVersion,
}: Props) {
  const [batchStatus, setBatchStatus] = useState("");
  const [batchError, setBatchError] = useState(false);
  const [runActive, setRunActive] = useState(false);

  const runAnalysisBatch = async (kind: "deterministic" | "ai") => {
    if (analysisBatchRef.current || runRef.current) return;
    const exists =
      kind === "deterministic"
        ? "deterministic_analysis_exists"
        : "ai_analysis_exists";
    const targets = hosts
      .filter((host) => !host[exists])
      .map((host) => ({ id: host.id, name: host.fullname || host.id }));
    if (!targets.length) {
      setBatchStatus(
        `Tutti gli host della pagina hanno già un’analisi ${kind === "ai" ? "IA" : "deterministica"}.`,
      );
      setBatchError(false);
      return;
    }
    const batch: AnalysisBatch = {
      cancelled: false,
      kind,
      stopWaiters: new Set(),
    };
    analysisBatchRef.current = batch;
    setRunActive(true);
    setBatchError(false);
    setBatchStatus("");
    let nextIndex = 0;
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    let failureThresholdReached = false;
    let inFlight = 0;
    let deferred = 0;
    const activeNames = new Map<string, string>();
    const failures: string[] = [];
    const concurrency = getBatchConcurrency(kind, targets.length);
    const endpoint =
      kind === "ai"
        ? "/api/host-ai-analysis"
        : "/api/host-analyses/deterministic";
    let nextAiStartAt = Date.now();
    const progress = (lead?: string) => {
      const active = [...activeNames.values()].join(", ");
      setBatchStatus(
        `${lead ? `${lead} · ` : ""}Completati ${completed}, saltati ${skipped}, falliti ${failed}, in corso ${inFlight}${active ? ` (${active})` : ""}.`,
      );
    };
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          batch.stopWaiters.delete(done);
          resolve();
        }
        batch.stopWaiters.add(done);
      });
    const processTarget = async (
      target: (typeof targets)[number],
      position: number,
    ) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (batch.cancelled) return "not_started" as const;
        if (kind === "ai") {
          const startAt = Math.max(Date.now(), nextAiStartAt);
          nextAiStartAt = startAt + AI_BATCH_START_INTERVAL_MS;
          if (startAt > Date.now()) await sleep(startAt - Date.now());
          if (batch.cancelled) return "not_started" as const;
        }
        progress(
          `${kind === "ai" ? "Analisi IA" : "Analisi deterministica"} ${position + 1}/${targets.length} · ${target.name} (${target.id}) · tentativo ${attempt + 1}/3`,
        );
        try {
          const { response, data } = await runAnalysisBatchRequest(
            endpoint,
            target.id,
          );
          if (
            data.skipped === "already_analyzed" ||
            data.skipped === "in_progress"
          )
            return "skipped" as const;
          if (!response.ok || !data.ok)
            throw Object.assign(
              new Error(data.error || `HTTP ${response.status}`),
              {
                retryable: data.retryable === true,
                retryAfterMs: data.retryAfterMs,
              },
            );
          setHosts((current) =>
            current.map((host) =>
              host.id === target.id ? { ...host, [exists]: 1 } : host,
            ),
          );
          if (kind === "ai") notifyAiUsageUpdated();
          return "completed" as const;
        } catch (error) {
          const retryable =
            (error as Error & { retryable?: boolean }).retryable === true ||
            error instanceof TypeError;
          if (!retryable || attempt >= 2 || batch.cancelled) throw error;
          const retryAfterMs = (error as Error & { retryAfterMs?: number })
            .retryAfterMs;
          await sleep(
            getBatchRetryDelay(
              attempt,
              retryAfterMs,
              Math.floor(Math.random() * 500),
            ),
          );
        }
      }
      return "failed" as const;
    };
    const worker = async () => {
      while (!batch.cancelled && !failureThresholdReached) {
        const position = nextIndex++;
        if (position >= targets.length) return;
        const target = targets[position];
        inFlight++;
        activeNames.set(target.id, `${target.name} (${target.id})`);
        progress(
          `${kind === "ai" ? "Analisi IA" : "Analisi deterministica"} ${position + 1}/${targets.length}`,
        );
        try {
          const result = await processTarget(target, position);
          if (result === "completed") {
            completed++;
            if (!failureThresholdReached) consecutiveFailures = 0;
          } else if (result === "skipped") skipped++;
          else deferred++;
        } catch (error) {
          failed++;
          consecutiveFailures++;
          failures.push(`${target.id}: ${errorText(error)}`);
          if (consecutiveFailures >= 2) failureThresholdReached = true;
        } finally {
          inFlight--;
          activeNames.delete(target.id);
          progress();
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const unstarted = Math.max(0, targets.length - nextIndex) + deferred;
    if (kind === "ai") notifyAiUsageUpdated();
    setRefreshVersion((version) => version + 1);
    const errorSummary = failures
      .slice(0, 5)
      .map(
        (item) =>
          `${item.split(":")[0]} (${item
            .slice(item.indexOf(":") + 1)
            .trim()
            .slice(0, 70)})`,
      )
      .join("; ");
    const summary = `${batch.cancelled ? "Interrotto" : failureThresholdReached ? "Fermato dopo due errori consecutivi" : "Completato"}: ${completed} salvati, ${skipped} saltati, ${failed} falliti, ${unstarted} non avviati.${errorSummary ? ` Errori: ${errorSummary}${failures.length > 5 ? `; e altri ${failures.length - 5}` : ""}.` : ""}`;
    setBatchStatus(summary);
    setBatchError(failed > 0 || failureThresholdReached);
    analysisBatchRef.current = null;
    setRunActive(false);
  };

  const stopBatch = () => {
    const batch = analysisBatchRef.current;
    if (!batch) return false;
    batch.cancelled = true;
    for (const wake of [...batch.stopWaiters]) wake();
    setBatchStatus(
      "Interruzione richiesta: le chiamate già avviate termineranno e salveranno il risultato.",
    );
    return true;
  };

  return {
    batchStatus,
    setBatchStatus,
    batchError,
    setBatchError,
    runActive,
    setRunActive,
    runAnalysisBatch,
    stopBatch,
  };
}
