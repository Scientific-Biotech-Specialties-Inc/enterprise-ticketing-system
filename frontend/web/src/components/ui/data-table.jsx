import * as React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, Plus, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function DataTableSkeleton({ columns = 5, rows = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <TableRow key={`skeleton-row-${rIdx}`} className="hover:bg-transparent">
          {Array.from({ length: columns }).map((_, cIdx) => (
            <TableCell key={`skeleton-cell-${rIdx}-${cIdx}`} className="py-4">
              <Skeleton className={cn("h-4", cIdx === 0 ? "w-20" : cIdx === 1 ? "w-48" : "w-24")} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function DataTableToolbar({
  title,
  count,
  searchPlaceholder = "Search records...",
  searchValue,
  onSearchChange,
  showFilterToggle = false,
  filtersActive = false,
  onToggleFilters,
  actionButton,
  className,
}) {
  return (
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 font-sans",
        className
      )}
    >
      <div className="flex items-center gap-3">
        {title && (
          <h2 className="text-lg font-bold text-dark-slate flex items-center gap-2">
            <span>{title}</span>
            {count !== undefined && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-muted-slate">
                {count}
              </span>
            )}
          </h2>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {onSearchChange && (
          <div className="relative min-w-[220px] sm:min-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
            <Input
              value={searchValue || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 h-10 bg-surface"
            />
          </div>
        )}

        {showFilterToggle && (
          <Button
            type="button"
            variant={filtersActive ? "secondary" : "outline"}
            size="default"
            onClick={onToggleFilters}
            className="flex items-center gap-2"
          >
            <Filter className="h-4 w-4 text-muted-slate" />
            <span>Filters</span>
          </Button>
        )}

        {actionButton}
      </div>
    </div>
  );
}

export function DataTablePagination({
  currentPage = 1,
  totalPages = 1,
  totalItems,
  pageSize = 10,
  onPageChange,
  className,
}) {
  if (totalPages <= 1 && !totalItems) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems || currentPage * pageSize);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4 px-2 text-xs text-muted-slate font-sans",
        className
      )}
    >
      <div>
        {totalItems !== undefined ? (
          <span>
            Showing <strong className="text-dark-slate">{startItem}</strong> to{" "}
            <strong className="text-dark-slate">{endItem}</strong> of{" "}
            <strong className="text-dark-slate">{totalItems}</strong> entries
          </span>
        ) : (
          <span>
            Page <strong className="text-dark-slate">{currentPage}</strong> of{" "}
            <strong className="text-dark-slate">{totalPages}</strong>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="h-8 px-2.5"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <span className="px-2 font-semibold text-dark-slate">
          {currentPage} / {totalPages || 1}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="h-8 px-2.5"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

export function DataTableEmpty({
  icon: Icon = Inbox,
  title = "No records found",
  description = "No results match your search query or filters.",
  action,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center font-sans">
      <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-muted-slate mb-3">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-bold text-dark-slate mb-1">{title}</h3>
      <p className="text-xs text-muted-slate max-w-sm mb-4 leading-normal">{description}</p>
      {action}
    </div>
  );
}

export function DataTableEmptyState({ colSpan = 5, ...props }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <DataTableEmpty {...props} />
      </TableCell>
    </TableRow>
  );
}
