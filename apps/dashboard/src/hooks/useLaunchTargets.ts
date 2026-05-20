'use client';

import { useQuery } from '@tanstack/react-query';
import { getLaunchTargets } from '@/lib/api';

export function useLaunchTargets(enabled = true) {
  return useQuery({
    queryKey: ['launch-targets'],
    queryFn: getLaunchTargets,
    enabled,
  });
}
