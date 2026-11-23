"use client";

import Link from "next/link";
import { notifyAiUsageUpdated } from "../../shared/ai-usage-events";
import { notifyFavoritesChanged } from "../../shared/favorite-events";
import { useEffect, useRef, useState } from "react";
import {
  getHostDetail,
  runAiAnalysis,
  runDeterministicAnalysis,
  saveHostFavorite,
} from "./api";
import { CaptureHistory } from "./components/CaptureHistory";
import { HostDirectoryPanel } from "./components/HostDirectoryPanel";
import { StatCard } from "./components/StatCard";
import { formatHostTime as formatTime } from "./format";
import { useBatchProcessing } from "./hooks/useBatchProcessing";
import { useHosts } from "./hooks/useHosts";
import type {
  AnalysisBatch,
  ExtensionEvent,
  Host,
  HostDetail,
  PendingDetail,
  RunState,
} from "./types";

const PAGE_SIZE = 50;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Errore imprevisto";

export default function HostDashboard() {
  const {
    status,
    setStatus,
    domains,
    hosts,
    setHosts,
    captures,
    search,
    setSearch,
    debouncedSearch,
    domain,
    setDomain,
    favoritesOnly,
    setFavoritesOnly,
    page,
    setPage,
    total,
    loading,
    error,
    setError,
    refreshVersion,
    setRefreshVersion,
  } = useHosts();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, HostDetail>>({});
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [openStatus, setOpenStatus] = useState("");
  const [openError, setOpenError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<Record<string, string>>({});
  const [analysisBusy, setAnalysisBusy] = useState<Set<string>>(new Set());
  const [analysisMessages, setAnalysisMessages] = useState<
    Record<string, string>
  >({});
  const [aiBusyHost, setAiBusyHost] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<Record<string, string>>({});
  const runRef = useRef<RunState | null>(null);
  const analysisBatchRef = useRef<AnalysisBatch | null>(null);
  const detailWaiters = useRef(new Map<string, PendingDetail>());
  const pendingProfileOpens = useRef(
    new Map<
      string,
      {
        resolve: (value: { ok: boolean; message?: string }) => void;
        timeout: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const requestSequence = useRef(0);
  const {
    batchStatus,
    setBatchStatus,
    batchError,
    setBatchError,
    runActive,
    setRunActive,
    runAnalysisBatch,
    stopBatch,
  } = useBatchProcessing({
    hosts,
    setHosts,
    runRef,
    analysisBatchRef,
    setRefreshVersion,
  });

  useEffect(() => {
    const onMessage = (
      event: MessageEvent<
        ExtensionEvent & {
          requestId?: string;
          ok?: boolean;
          message?: string;
          connected?: boolean;
        }
      >,
    ) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type === "HOSTLIST_BRIDGE_STATUS") {
        setBridgeConnected(Boolean(event.data.connected));
        return;
      }
      if (
        event.data?.type === "HOSTLIST_OPEN_PROFILE_RESULT" &&
        event.data.requestId
      ) {
        const pending = pendingProfileOpens.current.get(event.data.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingProfileOpens.current.delete(event.data.requestId);
        pending.resolve({
          ok: Boolean(event.data.ok),
          message: event.data.message,
        });
        return;
      }
      if (event.data?.type !== "HOSTLIST_DATA_CHANGED") return;
      const change = event.data;
      if (change.kind === "host-detail" && change.hostId) {
        const hostId = String(change.hostId);
        const pending = detailWaiters.current.get(hostId);
        if (pending) {
          clearTimeout(pending.timeout);
          detailWaiters.current.delete(hostId);
          pending.resolve(true);
        }
        setHosts((current) =>
          current.map((host) =>
            host.id === hostId
              ? {
                  ...host,
                  detail_captured_at:
                    change.capturedAt || new Date().toISOString(),
                }
              : host,
          ),
        );
        setStatus((current) =>
          current ? { ...current, details: current.details + 1 } : current,
        );
        if (expanded.has(hostId)) {
          void getHostDetail(hostId)
            .then((value) =>
              setDetails((current) => ({ ...current, [hostId]: value })),
            )
            .catch(() => {});
        }
        if (!runRef.current && !analysisBatchRef.current)
          setRefreshVersion((version) => version + 1);
      } else if (
        change.kind === "list" &&
        !runRef.current &&
        !analysisBatchRef.current
      ) {
        setRefreshVersion((version) => version + 1);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "HOSTLIST_BRIDGE_PING" }, location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [expanded]);

  useEffect(
    () => () => {
      for (const pending of detailWaiters.current.values()) {
        clearTimeout(pending.timeout);
        pending.resolve(false);
      }
      for (const pending of pendingProfileOpens.current.values()) {
        clearTimeout(pending.timeout);
        pending.resolve({ ok: false, message: "Dashboard chiusa." });
      }
    },
    [],
  );

  const fetchHostDetail = async (hostId: string) => {
    const value = await getHostDetail(hostId);
    setDetails((current) => ({ ...current, [hostId]: value }));
  };

  const toggleHost = async (hostId: string) => {
    const next = new Set(expanded);
    if (next.has(hostId)) {
      next.delete(hostId);
      setExpanded(next);
      return;
    }
    next.add(hostId);
    setExpanded(next);
    if (!details[hostId]) {
      try {
        await fetchHostDetail(hostId);
      } catch (reason) {
        setError(errorText(reason));
        setExpanded((current) => {
          const result = new Set(current);
          result.delete(hostId);
          return result;
        });
      }
    }
  };

  const openHostPage = (hostId: string) =>
    new Promise<{ ok: boolean; message?: string }>((resolve) => {
      const requestId = `hostlist-${Date.now()}-${++requestSequence.current}`;
      const timeout = setTimeout(() => {
        pendingProfileOpens.current.delete(requestId);
        resolve({
          ok: false,
          message: "L’estensione non ha risposto alla richiesta di apertura.",
        });
      }, 10000);
      pendingProfileOpens.current.set(requestId, { resolve, timeout });
      window.postMessage(
        { type: "HOSTLIST_OPEN_PROFILE", requestId, hostId },
        location.origin,
      );
    });

  const toggleFavorite = async (host: Host) => {
    const next = host.is_favorite !== 1;
    try {
      await saveHostFavorite(host.id, next);
      setHosts((current) =>
        current.map((item) =>
          item.id === host.id ? { ...item, is_favorite: next ? 1 : 0 } : item,
        ),
      );
      notifyFavoritesChanged(host.id);
      if (favoritesOnly && !next) setRefreshVersion((version) => version + 1);
    } catch (reason) {
      setError(`Preferito non salvato: ${errorText(reason)}`);
    }
  };

  const analyzeDeterministically = async (hostId: string) => {
    setAnalysisBusy((current) => new Set(current).add(hostId));
    setAnalysisMessages((current) => ({
      ...current,
      [hostId]: "Analisi in corso…",
    }));
    try {
      await runDeterministicAnalysis(hostId);
      setAnalysisMessages((current) => ({
        ...current,
        [hostId]: "Analisi salvata · totale ricalcolato nella graduatoria",
      }));
      setRefreshVersion((version) => version + 1);
    } catch (reason) {
      setAnalysisMessages((current) => ({
        ...current,
        [hostId]: `Errore: ${errorText(reason)}`,
      }));
    } finally {
      setAnalysisBusy((current) => {
        const next = new Set(current);
        next.delete(hostId);
        return next;
      });
    }
  };

  const analyzeWithAi = async (hostId: string) => {
    if (aiBusyHost) return;
    setAiBusyHost(hostId);
    setAiMessages((current) => ({
      ...current,
      [hostId]: "Analisi IA in corso…",
    }));
    try {
      const result = await runAiAnalysis(hostId);
      setAiMessages((current) => ({
        ...current,
        [hostId]: `Analisi salvata · ${result.model_id || "IA"}`,
      }));
      setHosts((current) =>
        current.map((host) =>
          host.id === hostId ? { ...host, ai_analysis_exists: 1 } : host,
        ),
      );
      setRefreshVersion((version) => version + 1);
    } catch (reason) {
      setAiMessages((current) => ({
        ...current,
        [hostId]: `Errore: ${errorText(reason)}`,
      }));
    } finally {
      setAiBusyHost(null);
      notifyAiUsageUpdated();
    }
  };

  const waitForDetailSaved = (hostId: string, run: RunState) =>
    new Promise<boolean>((resolve, reject) => {
      const finish = (saved: boolean) => {
        const pending = detailWaiters.current.get(hostId);
        if (pending) clearTimeout(pending.timeout);
        detailWaiters.current.delete(hostId);
        run.cancelWaiters.delete(cancelWait);
        resolve(saved);
      };
      const cancelWait = () => finish(false);
      const timeout = setTimeout(() => {
        detailWaiters.current.delete(hostId);
        run.cancelWaiters.delete(cancelWait);
        reject(
          new Error(
            `Timeout: il dettaglio di ${hostId} non è stato salvato entro 30 secondi.`,
          ),
        );
      }, 30000);
      detailWaiters.current.set(hostId, { resolve: finish, timeout });
      run.cancelWaiters.add(cancelWait);
    });

  const startPageDetailCollection = async () => {
    if (runRef.current) return;
    if (!bridgeConnected) {
      setBatchStatus(
        "Estensione non collegata: ricaricala da about:debugging.",
      );
      setBatchError(true);
      return;
    }
    const targets = hosts
      .filter((host) => !host.detail_captured_at)
      .map((host) => ({ id: host.id, name: host.fullname || host.id }));
    if (!targets.length) {
      setBatchStatus(
        "Tutti i dettagli della pagina corrente sono già salvati.",
      );
      setBatchError(false);
      return;
    }
    let cancelResolve!: () => void;
    const run: RunState = {
      cancelled: false,
      cancelWaiters: new Set(),
      cancel: () => {},
    };
    const cancelPromise = new Promise<void>((resolve) => {
      cancelResolve = resolve;
    });
    run.cancel = () => {
      run.cancelled = true;
      cancelResolve();
      for (const cancel of [...run.cancelWaiters]) cancel();
    };
    runRef.current = run;
    analysisBatchRef.current = {
      cancelled: false,
      kind: "deterministic",
      stopWaiters: new Set(),
    };
    setRunActive(true);
    setBatchError(false);
    setBatchStatus("");
    let completed = 0;
    let index = 0;
    try {
      for (; index < targets.length; index++) {
        if (run.cancelled) break;
        const host = targets[index];
        const savedPromise = waitForDetailSaved(host.id, run);
        setBatchStatus(
          `Apertura ${index + 1}/${targets.length}: ${host.name} (${host.id})…`,
        );
        const result = await Promise.race([
          openHostPage(host.id),
          cancelPromise.then(() => null),
        ]);
        if (run.cancelled) break;
        if (!result?.ok) {
          detailWaiters.current.get(host.id)?.resolve(false);
          await savedPromise;
          throw new Error(
            result?.message ||
              `Non è stato possibile aprire l’host ${host.id}.`,
          );
        }
        setBatchStatus(
          `In attesa del salvataggio ${index + 1}/${targets.length}: ${host.name} (${host.id})…`,
        );
        const saved = await Promise.race([
          savedPromise,
          cancelPromise.then(() => false),
        ]);
        if (run.cancelled || !saved) break;
        completed++;
      }
      if (run.cancelled) {
        setBatchStatus(
          `Raccolta interrotta. ${completed} dettagli confermati; ${targets.length - completed} non completati. La scheda già aperta potrebbe ancora terminare il salvataggio.`,
        );
      } else
        setBatchStatus(
          `Raccolta completata: ${completed} dettagli salvati su ${targets.length}.`,
        );
      setBatchError(false);
    } catch (reason) {
      const notStarted = Math.max(0, targets.length - index - 1);
      setBatchStatus(
        `Raccolta interrotta su ${targets[index]?.id || "host corrente"}: ${errorText(reason)} ${notStarted} host successivi non avviati.`,
      );
      setBatchError(true);
    } finally {
      runRef.current = null;
      analysisBatchRef.current = null;
      setRunActive(false);
      setRefreshVersion((version) => version + 1);
    }
  };

  const stopCollection = () => {
    const run = runRef.current;
    if (!run) {
      stopBatch();
      return;
    }
    setBatchStatus("Interruzione in corso…");
    run.cancel();
  };

  const copyDetail = async (hostId: string, rawJson: string) => {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopyStatus((current) => ({ ...current, [hostId]: "JSON copiato ✓" }));
    } catch {
      const area = document.createElement("textarea");
      area.value = rawJson;
      area.setAttribute("readonly", "");
      area.className = "copy-fallback";
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      setCopyStatus((current) => ({
        ...current,
        [hostId]: copied ? "JSON copiato ✓" : "Copia non riuscita",
      }));
    }
  };

  const openHostPageForRow = (host: Host) => {
    if (!bridgeConnected) {
      setOpenStatus(
        "Estensione non disponibile: ricaricala da about:debugging.",
      );
      setOpenError(true);
      return;
    }
    setOpenError(false);
    setOpenStatus(
      host.detail_captured_at
        ? "Riapertura del profilo per aggiornare il dettaglio…"
        : "Apertura del profilo…",
    );
    void openHostPage(host.id).then((result) => {
      setOpenStatus(result.message || "Richiesta completata.");
      setOpenError(!result.ok);
    });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const first = total ? page * PAGE_SIZE + 1 : 0;
  const last = page * PAGE_SIZE + hosts.length;

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <h1>HostList</h1>
          <p>
            Raccolta locale dei profili host · aggiornamento su acquisizione{" "}
            <span
              id="bridge-state"
              className={`bridge-status ${bridgeConnected ? "connected" : ""}`}
            >
              {bridgeConnected
                ? "Estensione collegata"
                : "Estensione non collegata"}
            </span>{" "}
            · <Link href="/analisi-host">Analisi deterministica</Link> ·{" "}
            <Link href="/analisi-host-ia">Analisi IA</Link>
          </p>
        </div>
      </header>
      <main className="dashboard-main">
        <section className="stat-cards" aria-label="Stato raccolta">
          <StatCard label="Profili distinti salvati" value={status?.hosts} />
          <StatCard label="Risposte acquisite" value={status?.captures} />
          <StatCard
            label="Schede dettagliate salvate"
            value={status?.details}
          />
          <div className="card">
            <span className="status-line">
              <i className={`status-dot ${status?.latest ? "live" : ""}`} />
              {status?.latest ? "Ultima acquisizione" : "In attesa di dati…"}
            </span>
            <strong className="last-capture">
              {formatTime(status?.latest?.captured_at)}
            </strong>
          </div>
        </section>

        <HostDirectoryPanel
          domains={domains}
          domain={domain}
          favoritesOnly={favoritesOnly}
          search={search}
          debouncedSearch={debouncedSearch}
          page={page}
          total={total}
          totalPages={totalPages}
          first={first}
          last={last}
          hosts={hosts}
          loading={loading}
          error={error}
          runActive={runActive}
          openStatus={openStatus}
          openError={openError}
          batchStatus={batchStatus}
          batchError={batchError}
          expanded={expanded}
          details={details}
          copyStatus={copyStatus}
          analysisBusy={analysisBusy}
          analysisMessages={analysisMessages}
          aiBusyHost={aiBusyHost}
          aiMessages={aiMessages}
          onDomainChange={(value) => {
            setDomain(value);
            setPage(0);
          }}
          onFavoritesChange={(value) => {
            setFavoritesOnly(value);
            setPage(0);
          }}
          onSearchChange={setSearch}
          onRefresh={() => setRefreshVersion((version) => version + 1)}
          onCollectDetails={() => void startPageDetailCollection()}
          onRunBatch={(kind) => void runAnalysisBatch(kind)}
          onStop={stopCollection}
          onFavorite={(host) => void toggleFavorite(host)}
          onToggleHost={(hostId) => void toggleHost(hostId)}
          onOpenHost={openHostPageForRow}
          onAnalyzeDeterministic={(hostId) =>
            void analyzeDeterministically(hostId)
          }
          onAnalyzeAi={(hostId) => void analyzeWithAi(hostId)}
          onCopy={(hostId, rawJson) => void copyDetail(hostId, rawJson)}
          onCloseHost={(hostId) =>
            setExpanded((current) => {
              const next = new Set(current);
              next.delete(hostId);
              return next;
            })
          }
          onPrevious={() => setPage((current) => Math.max(0, current - 1))}
          onNext={() => setPage((current) => current + 1)}
        />
        <CaptureHistory captures={captures} />
      </main>
    </>
  );
}
