import { useEffect, useRef, useState } from 'react';
import { suggestProblemCategory } from '@/services/ticketService';

export const PENDING_CLASSIFICATION = 'Pending classification';

/** Lowercase name helpers so every surface applies the same equipment rule (AC-5). */
export const isSoftwareCategory = (category) => String(category?.category_name || '').trim().toLowerCase() === 'software';
export const isServiceCategory = (category) => String(category?.category_name || '').trim().toLowerCase() === 'service';

/**
 * Spec 0043 (AC-5): the customer never picks a category. This shows the AI classification preview
 * from the live active problem categories, or `Pending classification` while loading or when the
 * AI cannot decide. The server makes the real decision on submit (AC-6).
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.description
 * @param {Array<{problem_category_ID:number, category_name:string}>} args.categories live categories from getTicketFormOptions()
 * @param {number|string|null} [args.fixedCategoryId] an already stored category (edit dialog), shown as is with no AI call
 * @param {boolean} [args.enabled]
 * @param {number} [args.debounceMs]
 */
export default function useCategoryPreview({
  title = '',
  description = '',
  categories = [],
  fixedCategoryId = null,
  enabled = true,
  debounceMs = 600,
} = {}) {
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const categoryKey = (categories || []).map((c) => c.problem_category_ID).join(',');

  useEffect(() => {
    const list = categories || [];

    if (fixedCategoryId !== null && fixedCategoryId !== undefined && fixedCategoryId !== '') {
      setCategory(list.find((c) => String(c.problem_category_ID) === String(fixedCategoryId)) || null);
      setLoading(false);
      return undefined;
    }

    const desc = String(description || '').trim();
    if (!enabled || list.length === 0 || desc.length < 10) {
      setCategory(null);
      setLoading(false);
      return undefined;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      suggestProblemCategory(title || '', desc, list)
        .then((suggestion) => {
          if (requestId !== requestRef.current) return;
          const match = suggestion?.category_id != null
            ? list.find((c) => String(c.problem_category_ID) === String(suggestion.category_id))
            : null;
          setCategory(match || null);
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, debounceMs);

    return () => clearTimeout(timer);
    // categoryKey stands in for the categories array so a new array with the same ids does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, categoryKey, fixedCategoryId, enabled, debounceMs]);

  return {
    category,
    loading,
    label: category?.category_name || PENDING_CLASSIFICATION,
    isSoftware: isSoftwareCategory(category),
    isService: isServiceCategory(category),
  };
}
