import { useCallback, useEffect, useState } from "react";
import {
  AI_WEIGHT_KEYS,
  AI_WEIGHT_QUERY_KEYS,
  AI_WEIGHT_STORAGE_KEY,
  DEFAULT_AI_WEIGHTS,
  isAiWeightsValue,
  isValidAiWeights,
  type AiWeightKey,
  type AiWeights,
} from "../../../shared/host-analysis-weights";
import { subscribeToAiUsageUpdates } from "../../../shared/ai-usage-events";
import {
  FAVORITES_CHANGED_STORAGE_KEY,
  notifyFavoritesChanged,
} from "../../../shared/favorite-events";
import {
  getAiUsageSummary,
  getAnalyses,
  getAnalysisFilters,
  getHostAnalysisDetails,
  saveAnalysisFavorite,
} from "../api";
import type {
  AiUsageSummary,
  Analysis,
  HostAnalysisDetails,
  Location,
} from "../types";

const PAGE_SIZE = 50;

export function useAnalysisDashboard(isAi: boolean) {
  const [offset, setOffset] = useState(0);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("Caricamento…");
  const [error, setError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [aiWeights, setAiWeights] = useState<AiWeights>(DEFAULT_AI_WEIGHTS);
  const [weightsReady, setWeightsReady] = useState(false);
  const [usageSummary, setUsageSummary] = useState<AiUsageSummary | null>(null);
  const [expandedHost, setExpandedHost] = useState<string | null>(null);
  const [hostDetails, setHostDetails] = useState<
    Record<string, HostAnalysisDetails>
  >({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState<Set<string>>(new Set());

  const loadFilters = useCallback(async () => {
    if (isAi) {
      const [filterData, usageData] = await Promise.all([
        getAnalysisFilters(true),
        getAiUsageSummary(),
      ]);
      setLocations(filterData.locations);
      setUsageSummary(usageData);
    } else {
      const data = await getAnalysisFilters(false);
      setLocations(data.locations);
    }
  }, [isAi]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(queryInput.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AI_WEIGHT_STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isAiWeightsValue(parsed)) setAiWeights(parsed);
      }
    } catch {
      /* Usa i pesi predefiniti se localStorage non è disponibile o valido. */
    }
    setWeightsReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== AI_WEIGHT_STORAGE_KEY) return;
      try {
        const parsed: unknown = event.newValue
          ? JSON.parse(event.newValue)
          : DEFAULT_AI_WEIGHTS;
        if (isAiWeightsValue(parsed)) setAiWeights(parsed);
      } catch {
        /* Ignora il valore non valido mantenendo l'ultima selezione valida. */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void loadFilters().catch((reason) => {
      setError(true);
      setStatus(
        `Errore nel caricamento dei filtri: ${reason instanceof Error ? reason.message : "Errore imprevisto"}`,
      );
    });
  }, [loadFilters, refreshVersion]);

  useEffect(() => {
    if (!isAi) return;
    return subscribeToAiUsageUpdates(() =>
      setRefreshVersion((value) => value + 1),
    );
  }, [isAi]);

  useEffect(() => {
    if (!weightsReady) return;
    const weightTotal = AI_WEIGHT_KEYS.reduce(
      (sum, key) => sum + aiWeights[key],
      0,
    );
    if (!isValidAiWeights(aiWeights)) {
      setStatus(
        `I pesi devono sommare a 100% (ora ${weightTotal.toLocaleString("it-IT")}%). La classifica non è stata aggiornata.`,
      );
      setError(false);
      return;
    }
    let active = true;
    const params = new URLSearchParams({
      q: query,
      country,
      city,
      favorites: favoritesOnly ? "1" : "0",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    for (const key of AI_WEIGHT_KEYS)
      params.set(AI_WEIGHT_QUERY_KEYS[key], String(aiWeights[key]));
    void getAnalyses(
      `${isAi ? "/api/host-ai-analyses" : "/api/host-analyses"}?${params}`,
    )
      .then((data) => {
        if (!active) return;
        setTotal(data.total);
        setAnalyses(data.analyses);
        setError(false);
        setStatus(
          `${data.total.toLocaleString("it-IT")} risultati${favoritesOnly ? " · solo preferiti" : ""} · ordinati per punteggio decrescente, poi ID crescente.`,
        );
      })
      .catch((reason) => {
        if (!active) return;
        setError(true);
        setStatus(
          `Errore nel caricamento: ${reason instanceof Error ? reason.message : "Errore imprevisto"}`,
        );
      });
    return () => {
      active = false;
    };
  }, [
    isAi,
    query,
    country,
    city,
    favoritesOnly,
    offset,
    refreshVersion,
    aiWeights,
    weightsReady,
  ]);

  const changeWeight = (key: AiWeightKey, value: number) => {
    const next = {
      ...aiWeights,
      [key]: Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)),
    };
    setAiWeights(next);
    try {
      window.localStorage.setItem(AI_WEIGHT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* La classifica continua a funzionare anche senza persistenza browser. */
    }
  };

  const resetWeights = () => {
    setAiWeights(DEFAULT_AI_WEIGHTS);
    try {
      window.localStorage.setItem(
        AI_WEIGHT_STORAGE_KEY,
        JSON.stringify(DEFAULT_AI_WEIGHTS),
      );
    } catch {
      /* La classifica continua a funzionare anche senza persistenza browser. */
    }
  };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FAVORITES_CHANGED_STORAGE_KEY)
        setRefreshVersion((version) => version + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleFavorite = async (item: Analysis) => {
    const next = item.is_favorite !== 1;
    setFavoriteBusy((current) => new Set(current).add(item.host_id));
    try {
      await saveAnalysisFavorite(item.host_id, next);
      setAnalyses((current) =>
        current.map((row) =>
          row.host_id === item.host_id
            ? { ...row, is_favorite: next ? 1 : 0 }
            : row,
        ),
      );
      notifyFavoritesChanged(item.host_id);
      if (favoritesOnly && !next) setRefreshVersion((version) => version + 1);
    } catch (reason) {
      setStatus(
        `Preferito non salvato: ${reason instanceof Error ? reason.message : "errore imprevisto"}`,
      );
      setError(true);
    } finally {
      setFavoriteBusy((current) => {
        const nextBusy = new Set(current);
        nextBusy.delete(item.host_id);
        return nextBusy;
      });
    }
  };

  const toggleDetails = async (hostId: string) => {
    if (expandedHost === hostId) {
      setExpandedHost(null);
      setDetailError("");
      return;
    }
    setExpandedHost(hostId);
    setDetailError("");
    if (hostDetails[hostId]) return;
    setDetailLoading(hostId);
    try {
      const details = await getHostAnalysisDetails(hostId);
      setHostDetails((current) => ({ ...current, [hostId]: details }));
    } catch (reason) {
      setDetailError(
        `Impossibile caricare la scheda: ${reason instanceof Error ? reason.message : "errore imprevisto"}`,
      );
    } finally {
      setDetailLoading(null);
    }
  };

  return {
    offset,
    setOffset,
    queryInput,
    setQueryInput,
    country,
    setCountry,
    city,
    setCity,
    favoritesOnly,
    setFavoritesOnly,
    locations,
    analyses,
    total,
    status,
    error,
    aiWeights,
    usageSummary,
    expandedHost,
    hostDetails,
    detailLoading,
    detailError,
    favoriteBusy,
    changeWeight,
    resetWeights,
    toggleFavorite,
    toggleDetails,
    setRefreshVersion,
  };
}
