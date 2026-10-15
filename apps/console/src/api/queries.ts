import {
  type Asset,
  type AssetDetail,
  type AssetTelemetry,
  type Camera,
  IDEMPOTENCY_KEY_HEADER,
  type Incident,
  type IncidentDetail,
  type ReportIncidentRequest,
  type SitePlan,
  type StreamDescriptor,
  type TransitionIncidentRequest,
  type Zone,
} from '@occ/contracts';
import { replaceEqualDeep, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mergeIncidentLists, newerIncident, upsertIncident } from '../lib/incidents';
import { api, ApiRequestError } from './client';

export const queryKeys = {
  zones: ['zones'] as const,
  sitePlan: ['site-plan'] as const,
  cameras: ['cameras'] as const,
  // Nested like the incident keys: `['assets']` is the prefix of one asset and of its history.
  assets: ['assets'] as const,
  asset: (code: string) => ['assets', code] as const,
  assetHistory: (code: string) => ['assets', code, 'history'] as const,
  incidents: ['incidents'] as const,
  incident: (id: string) => ['incidents', id] as const,
  stream: (cameraId: string) => ['cameras', cameraId, 'stream'] as const,
};

/** Reference data changes rarely; cache it for the whole shift. */
const STATIC = { staleTime: Infinity };

export const useZones = () =>
  useQuery({ queryKey: queryKeys.zones, queryFn: () => api.get<Zone[]>('/zones'), ...STATIC });

/**
 * The site's boundary, roads and field markings. A 404 (no site set up, or an API replica from
 * before the route existed) and any other failure leave `data` empty: the map then draws the zones
 * only, since the plan is decoration and the zones carry the meaning.
 */
export const useSitePlan = () =>
  useQuery({
    queryKey: queryKeys.sitePlan,
    queryFn: () => api.get<SitePlan>('/site-plan'),
    ...STATIC,
  });

export const useCameras = () =>
  useQuery({
    queryKey: queryKeys.cameras,
    queryFn: () => api.get<Camera[]>('/cameras'),
    ...STATIC,
  });

/** How often an empty catalogue is asked for again: see `useAssets`. */
const EMPTY_CATALOGUE_RETRY_MS = 30_000;

/**
 * The equipment catalogue (reference data: 31 rows in the demo, no pagination). A 404 is an API
 * replica from before V2-05 (ADR-0018 § Rolling deploys) and means "no assets", not an error, so
 * the query succeeds with `[]`; unlike `useSitePlan`, which leaves `data` undefined on a 404, the
 * conversion is made here. Any other failure keeps `data` undefined with `error` available.
 *
 * `STATIC` would keep that `[]` for the whole shift, since `main.tsx` also turns off the refetch on
 * focus, and a console opened mid-rollout would draw no equipment after the API was upgraded. An
 * empty list is therefore asked for again every 30 s, and only while it is empty (a site that has
 * no assets pays one request per 30 s).
 */
export const useAssets = () =>
  useQuery({
    queryKey: queryKeys.assets,
    queryFn: async (): Promise<Asset[]> => {
      try {
        return await api.get<Asset[]>('/assets');
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return [];
        throw error;
      }
    },
    staleTime: (query) => (query.state.data?.length ? STATIC.staleTime : EMPTY_CATALOGUE_RETRY_MS),
    refetchInterval: (query) => (query.state.data?.length === 0 ? EMPTY_CATALOGUE_RETRY_MS : false),
  });

/**
 * One asset with all its points and its threshold rules. Reference data like the list: a point or
 * a rule changes by a database change only (ADR-0018). No request is sent without a code.
 */
export const useAsset = (code: string | null) =>
  useQuery({
    queryKey: queryKeys.asset(code ?? ''),
    queryFn: () => api.get<AssetDetail>(`/assets/${encodeURIComponent(code ?? '')}`),
    enabled: code !== null,
    ...STATIC,
  });

/** A range of an asset's history: ISO 8601 with a zone, at most 1 hour (docs/api/assets.md). */
export interface AssetHistoryRange {
  from: string;
  to: string;
}

/**
 * An asset's reading history in 5 s buckets; the API's default is the last 15 minutes up to now.
 * The live path seeds its own rings from this route (`telemetryClient`); this is for a reader that
 * asks for a range of its own. A 404 (an older replica without the route, or an unknown code) stays
 * an error with `data` undefined: the caller says "no history". Not `STATIC`: history moves.
 */
export const useAssetHistory = (code: string | null, range?: AssetHistoryRange) =>
  useQuery({
    // Every value the request depends on is in the key, so two ranges never share an entry.
    queryKey: [...queryKeys.assetHistory(code ?? ''), range?.from ?? null, range?.to ?? null],
    queryFn: () => {
      const query = range ? `?${new URLSearchParams({ from: range.from, to: range.to })}` : '';
      return api.get<AssetTelemetry>(`/assets/${encodeURIComponent(code ?? '')}/telemetry${query}`);
    },
    enabled: code !== null,
  });

/** The whole recent list; filtering happens client-side so live events can patch one cache. */
export const useIncidents = () =>
  useQuery({
    queryKey: queryKeys.incidents,
    queryFn: () => api.get<Incident[]>('/incidents?limit=200'),
    staleTime: Infinity, // kept fresh by WebSocket events, refetched on reconnect
    // A refetch can be older than events applied while it was in flight: merge, never roll back.
    structuralSharing: (cached, fetched) =>
      replaceEqualDeep(
        cached,
        mergeIncidentLists(cached as Incident[] | undefined, fetched as Incident[]),
      ),
  });

export const useIncident = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.incident(id ?? ''),
    queryFn: () => api.get<IncidentDetail>(`/incidents/${id}`),
    enabled: id !== null,
    // A refetch started by a live event can land after a newer mutation response.
    structuralSharing: (cached, fetched) =>
      newerIncident(cached as IncidentDetail | undefined, fetched as IncidentDetail),
  });

/** An offline camera has nothing to stream: no request is sent until it is online again. */
export const useStream = (camera: Pick<Camera, 'id' | 'online'>) =>
  useQuery({
    queryKey: queryKeys.stream(camera.id),
    queryFn: () => api.get<StreamDescriptor>(`/cameras/${camera.id}/stream`),
    enabled: camera.online,
    ...STATIC,
  });

type Transition = 'acknowledge' | 'resolve';

export function useTransition(action: Transition) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string } & TransitionIncidentRequest) =>
      api.post<IncidentDetail>(`/incidents/${id}/${action}`, note ? { note } : {}),
    onSuccess: (detail) => {
      queryClient.setQueryData<IncidentDetail>(queryKeys.incident(detail.id), (cached) =>
        newerIncident(cached, detail),
      );
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, detail),
      );
    },
  });
}

/**
 * Report a new incident; the response is written straight into the cache. Retrying with the same
 * `idempotencyKey` returns the incident the first attempt created instead of a duplicate (ADR-0009).
 */
export function useReportIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      idempotencyKey,
    }: {
      request: ReportIncidentRequest;
      idempotencyKey: string;
    }) =>
      api.post<IncidentDetail>('/incidents', request, {
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData<IncidentDetail>(queryKeys.incident(detail.id), (cached) =>
        newerIncident(cached, detail),
      );
      // Idempotent with the live `incident.created` event this console also receives.
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, detail),
      );
    },
  });
}
