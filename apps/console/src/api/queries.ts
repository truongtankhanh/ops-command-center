import {
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
import { api } from './client';

export const queryKeys = {
  zones: ['zones'] as const,
  sitePlan: ['site-plan'] as const,
  cameras: ['cameras'] as const,
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

export const useStream = (cameraId: string) =>
  useQuery({
    queryKey: queryKeys.stream(cameraId),
    queryFn: () => api.get<StreamDescriptor>(`/cameras/${cameraId}/stream`),
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
