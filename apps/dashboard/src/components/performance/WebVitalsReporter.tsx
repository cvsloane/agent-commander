'use client';

import { useEffect } from 'react';
import type { Metric } from 'web-vitals';
import { recordPerformanceMetric } from '@/lib/sessionsPerf';
import { isPerformanceTelemetryEnabled } from './isEnabled';

function reportWebVital(metric: Metric) {
  recordPerformanceMetric({
    name: `web_vital.${metric.name.toLowerCase()}`,
    value: metric.value,
    unit: metric.name === 'CLS' ? 'score' : 'ms',
    rating: metric.rating,
    attributes: {
      delta: metric.delta,
      id: metric.id,
      navigation_type: metric.navigationType,
    },
  });
}

export function WebVitalsReporter() {
  useEffect(() => {
    if (!isPerformanceTelemetryEnabled()) return;

    let active = true;
    const report = (metric: Metric) => {
      if (active) reportWebVital(metric);
    };

    void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
      if (!active) return;
      onCLS(report);
      onFCP(report);
      onINP(report);
      onLCP(report);
      onTTFB(report);
    });

    return () => {
      active = false;
    };
  }, []);

  return null;
}
