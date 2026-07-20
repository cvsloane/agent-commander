'use client';

import { Button } from '@/components/ui/button';

export function SessionsPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const lastPage = total == null ? null : Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground">{total != null ? `Total: ${total}` : 'Total: —'}</div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <label htmlFor="sessions-page-size" className="text-xs text-muted-foreground">
          Page size
        </label>
        <select
          id="sessions-page-size"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-11 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="mobile"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page}
          {lastPage != null ? ` of ${lastPage}` : ''}
        </span>
        <Button
          variant="outline"
          size="mobile"
          onClick={() => onPageChange(page + 1)}
          disabled={lastPage != null && page >= lastPage}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
