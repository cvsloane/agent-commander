'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export const STATUS_SHORTCUTS: Record<string, string> = {
  '!': 'RUNNING',
  '@': 'WAITING_FOR_INPUT,WAITING_FOR_APPROVAL',
  '#': 'IDLE',
  $: 'ERROR',
};

export const WORKFLOW_STATUSES =
  'RUNNING,STARTING,WAITING_FOR_INPUT,WAITING_FOR_APPROVAL,ERROR,IDLE';

export interface SessionRouteState {
  needsAttention: boolean;
  status: string;
  view: string;
  provider: string;
  hostId: string;
  groupId: string;
  ungrouped: boolean;
  includeArchived: boolean;
  archivedOnly: boolean;
  q: string;
  page: number;
  pageSize: number;
  perfEnabled: boolean;
  disableRealtime: boolean;
  showSnapshotPreview: boolean;
}

export function parseSessionRouteState(params: Pick<URLSearchParams, 'get'>): SessionRouteState {
  const pageParam = Number(params.get('page') || '1');
  const pageSizeParam = Number(params.get('page_size') || '20');
  return {
    needsAttention: params.get('needs_attention') === 'true',
    status: params.get('status') || '',
    view: params.get('view') || 'workflow',
    provider: params.get('provider') || '',
    hostId: params.get('host_id') || '',
    groupId: params.get('group_id') || '',
    ungrouped: params.get('ungrouped') === 'true',
    includeArchived: params.get('include_archived') === 'true',
    archivedOnly: params.get('archived_only') === 'true',
    q: params.get('q') || '',
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    pageSize: [10, 20, 50].includes(pageSizeParam) ? pageSizeParam : 20,
    perfEnabled: params.get('perf') === '1',
    disableRealtime: params.get('nowebsocket') === '1',
    showSnapshotPreview: params.get('nosnapshot') !== '1',
  };
}

export function buildAppliedSessionParams(
  state: SessionRouteState,
  normalizedQuery: string
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view && state.view !== 'workflow') params.set('view', state.view);
  if (state.needsAttention) params.set('needs_attention', 'true');
  if (state.status) params.set('status', state.status);
  if (state.provider) params.set('provider', state.provider);
  if (state.hostId) params.set('host_id', state.hostId);
  if (state.groupId) params.set('group_id', state.groupId);
  if (state.ungrouped) params.set('ungrouped', 'true');
  if (state.includeArchived) params.set('include_archived', 'true');
  if (state.archivedOnly) params.set('archived_only', 'true');
  if (normalizedQuery) params.set('q', normalizedQuery);
  params.set('page', '1');
  params.set('page_size', String(state.pageSize));
  return params;
}

export function useSessionFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const routeState = useMemo(() => parseSessionRouteState(searchParams), [searchParams]);
  const [query, setQuery] = useState(routeState.q);
  const normalizedQuery = query.trim();
  const isWorkflowView =
    routeState.view === 'workflow' &&
    !routeState.needsAttention &&
    !routeState.status &&
    !routeState.provider &&
    !routeState.hostId &&
    !routeState.groupId &&
    !routeState.ungrouped &&
    !routeState.includeArchived &&
    !routeState.archivedOnly &&
    !routeState.q;
  const effectiveStatus = isWorkflowView ? WORKFLOW_STATUSES : routeState.status;
  const filters = useMemo(
    () => ({
      needs_attention: routeState.needsAttention || undefined,
      status: effectiveStatus || undefined,
      provider: routeState.provider || undefined,
      host_id: routeState.hostId || undefined,
      group_id: routeState.groupId || undefined,
      ungrouped: routeState.ungrouped || undefined,
      include_archived: routeState.includeArchived || undefined,
      archived_only: routeState.archivedOnly || undefined,
      q: normalizedQuery || undefined,
    }),
    [effectiveStatus, normalizedQuery, routeState]
  );

  useEffect(() => setQuery(routeState.q), [routeState.q]);

  const pushParams = useCallback(
    (params: URLSearchParams) => {
      const queryString = params.toString();
      router.push(`/sessions${queryString ? `?${queryString}` : ''}`);
    },
    [router]
  );

  const applyFilters = useCallback(() => {
    pushParams(buildAppliedSessionParams(routeState, normalizedQuery));
  }, [normalizedQuery, pushParams, routeState]);

  const updateFilter = useCallback(
    (key: 'status' | 'provider' | 'host_id', value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.set('page', '1');
      pushParams(params);
    },
    [pushParams, searchParams]
  );

  const toggleStatusShortcut = useCallback(
    (key: string) => {
      const status = STATUS_SHORTCUTS[key];
      if (!status) return;
      const params = new URLSearchParams(searchParams.toString());
      if (params.get('status') === status) params.delete('status');
      else params.set('status', status);
      pushParams(params);
    },
    [pushParams, searchParams]
  );

  const setPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('page', String(Math.max(1, page)));
      pushParams(params);
    },
    [pushParams, searchParams]
  );

  const setPageSize = useCallback(
    (pageSize: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('page_size', String(pageSize));
      params.set('page', '1');
      pushParams(params);
    },
    [pushParams, searchParams]
  );

  return {
    ...routeState,
    query,
    setQuery,
    filters,
    isWorkflowView,
    applyFilters,
    updateFilter,
    toggleStatusShortcut,
    setPage,
    setPageSize,
  };
}
