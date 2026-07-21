/**
 * Shared class string for icon-only action buttons that are revealed on hover
 * or focus (e.g. inline row affordances such as rename / delete).
 *
 * Consumers pair it with a Tailwind `group/<name>` variant on the row
 * container:
 *
 *   <div className="group/branch-row relative">
 *     <div className="opacity-0 transition-opacity duration-150
 *                     group-hover/branch-row:opacity-100
 *                     focus-within:group-hover/branch-row:opacity-100
 *                     max-sm:opacity-100">
 *       <button className={INLINE_HOVER_ACTION_BUTTON_CLASS}>…</button>
 *     </div>
 *   </div>
 *
 * Kept here (instead of inlined next to a single consumer) so Sidebar rows,
 * branch picker rows, and any other hover-revealed affordance can share the
 * same visual + a11y baseline.
 */
export const INLINE_HOVER_ACTION_BUTTON_CLASS =
  "inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring";
