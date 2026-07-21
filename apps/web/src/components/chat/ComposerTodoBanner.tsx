import { memo, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ListTodoIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActivePlanState } from "../../session-logic";
import { stepStatusIcon } from "../PlanSidebar";
import { AnimatedHeight } from "../AnimatedHeight";

interface ComposerTodoBannerProps {
  activePlan: ActivePlanState | null;
}

const ComposerTodoBanner = memo(function ComposerTodoBanner({
  activePlan,
}: ComposerTodoBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const prevTurnIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const currentTurnId = activePlan?.turnId ?? null;
    if (prevTurnIdRef.current !== currentTurnId) {
      prevTurnIdRef.current = currentTurnId;
      if (activePlan !== null) {
        setExpanded(true);
      } else {
        setExpanded(false);
      }
    }
  }, [activePlan]);

  if (!activePlan || activePlan.steps.length === 0) {
    return null;
  }

  const { steps } = activePlan;
  const doneCount = steps.filter((s) => s.status === "completed").length;
  const runningCount = steps.filter((s) => s.status === "inProgress").length;
  const totalCount = steps.length;

  const summaryParts: string[] = [];
  if (doneCount > 0) summaryParts.push(`${doneCount} done`);
  if (runningCount > 0) summaryParts.push(`${runningCount} running`);
  const pendingCount = totalCount - doneCount - runningCount;
  if (pendingCount > 0) summaryParts.push(`${pendingCount} pending`);

  return (
    <div className="mx-auto mb-1.5 max-w-3xl">
      <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
        {/* Header row — always visible, click to toggle */}
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/10"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="flex-1 text-[11px] font-medium text-muted-foreground/80">
            <span className="text-foreground/70">{totalCount}</span>
            {" tasks"}
            {summaryParts.length > 0 && (
              <span className="text-muted-foreground/50">
                {" — "}
                {summaryParts.join(", ")}
              </span>
            )}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {/* Expanded steps list */}
        <AnimatedHeight>
          {expanded ? (
            <div className="border-t border-border/40 px-3 py-2 space-y-0.5">
              {steps.map((step, i) => (
                <div
                  key={`${i}:${step.step}`}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-200",
                    step.status === "inProgress" && "bg-primary/5",
                    step.status === "completed" && "bg-success/5",
                  )}
                >
                  <span className="[&>span]:size-4 [&>span>svg]:size-2.5">
                    {stepStatusIcon(step.status)}
                  </span>
                  <span
                    className={cn(
                      "text-[12px] leading-snug",
                      step.status === "completed"
                        ? "text-muted-foreground/45 line-through decoration-muted-foreground/20"
                        : step.status === "inProgress"
                          ? "text-foreground/90"
                          : "text-muted-foreground/65",
                    )}
                  >
                    {step.step}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </AnimatedHeight>
      </div>
    </div>
  );
});

export default ComposerTodoBanner;
