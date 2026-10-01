import type {
  Camera,
  Incident,
  IncidentDetail,
  ReportIncidentRequest,
  StreamDescriptor,
  TransitionIncidentRequest,
  Zone,
} from '@occ/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { upsertIncident } from '../lib/incidents';
import { api } from './client';

export const queryKeys = {
  zones: ['zones'] as const,
  cameras: ['cameras'] as const,
  incidents: ['incidents'] as const,
  incident: (id: string) => ['incidents', id] as const,
  stream: (cameraId: string) => ['cameras', cameraId, 'stream'] as const,
};

/** Reference data changes rarely; cache it for the whole shift. */
const STATIC = { staleTime: Infinity };

export const useZones = () =>
  useQuery({ queryKey: queryKeys.zones, queryFn: () => api.get<Zone[]>('/zones'), ...STATIC });

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
  });

export const useIncident = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.incident(id ?? ''),
    queryFn: () => api.get<IncidentDetail>(`/incidents/${id}`),
    enabled: id !== null,
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
      queryClient.setQueryData(queryKeys.incident(detail.id), detail);
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, detail),
      );
    },
  });
}

/** Report a new incident; the response is written straight into the cache. */
export function useReportIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ReportIncidentRequest) => api.post<IncidentDetail>('/incidents', request),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.incident(detail.id), detail);
      // Idempotent with the live `incident.created` event this console also receives.
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, detail),
      );
    },
  });
}
