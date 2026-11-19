import { useCallback, useEffect, useRef, useState } from "react";
import { FAVORITES_CHANGED_STORAGE_KEY } from "../../../shared/favorite-events";
import {
  getHostDomains,
  getHostStatus,
  getHosts,
  getRecentCaptures,
} from "../api";
import type { Capture, Host, Status } from "../types";

const PAGE_SIZE = 50;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Errore imprevisto";

export function useHosts() {
  const [status, setStatus] = useState<Status | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const hostRequestSequence = useRef(0);

  const loadStatus = useCallback(
    async () => setStatus(await getHostStatus()),
    [],
  );
  const loadDomains = useCallback(
    async () => setDomains((await getHostDomains()).domains),
    [],
  );
  const loadCaptures = useCallback(
    async () => setCaptures((await getRecentCaptures()).captures),
    [],
  );
  const loadHosts = useCallback(async () => {
    const requestId = ++hostRequestSequence.current;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      q: debouncedSearch,
      domain,
      favorites: favoritesOnly ? "1" : "0",
    });
    const data = await getHosts(params);
    if (requestId !== hostRequestSequence.current) return;
    const pages = Math.ceil(data.total / PAGE_SIZE);
    if (pages > 0 && page >= pages) {
      setPage(pages - 1);
      return;
    }
    setHosts(data.hosts);
    setTotal(data.total);
    setLoading(false);
    setError("");
  }, [debouncedSearch, domain, favoritesOnly, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void Promise.all([loadStatus(), loadDomains(), loadCaptures()]).catch(
      (reason) => setError(errorText(reason)),
    );
  }, [loadCaptures, loadDomains, loadStatus, refreshVersion]);

  useEffect(() => {
    setLoading(true);
    void loadHosts().catch((reason) => {
      setError(errorText(reason));
      setLoading(false);
    });
  }, [loadHosts, refreshVersion]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FAVORITES_CHANGED_STORAGE_KEY)
        setRefreshVersion((version) => version + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
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
  };
}
