import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The project's first table primitive (D4), in the house shadcn/ui style.
 *
 * **Markup and classes only — no JavaScript, no `'use client'`.** Nothing here
 * sorts, filters or paginates; a table that did would be a client component,
 * and the first surface to use this one ships no client bundle at all.
 *
 * The wrapper carries `overflow-x-auto` so a wide table scrolls **inside its
 * own container** rather than making the page body scroll sideways. That is the
 * fallback, not the plan: a caller with more columns than a phone can hold is
 * expected to render something else at that size, which is what the clients
 * directory does.
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('hover:bg-muted/50 border-b transition-colors', className)}
      {...props}
    />
  );
}

/**
 * A column header.
 *
 * `scope="col"` by default rather than by the caller remembering: without it a
 * screen reader cannot associate a cell with the column it belongs to, and a
 * table of contact details read as an undifferentiated stream of strings is
 * unusable. A caller may still override it for a row header.
 */
function TableHead({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        'text-muted-foreground h-10 px-3 text-left align-middle font-medium whitespace-nowrap',
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-3 align-middle', className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption };
