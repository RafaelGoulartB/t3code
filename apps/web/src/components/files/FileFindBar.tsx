import { ArrowDown, ArrowUp, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useLayoutEffect } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

import type { FileFindDirection } from "./fileFind";

interface FileFindBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  matchCount: number;
  currentIndex: number | null;
  onQueryChange: (query: string) => void;
  onNavigate: (direction: FileFindDirection) => void;
  onClose: () => void;
}

export function FileFindBar({
  inputRef,
  query,
  matchCount,
  currentIndex,
  onQueryChange,
  onNavigate,
  onClose,
}: FileFindBarProps) {
  useLayoutEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    };
    focusInput();
    const frameId = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(frameId);
  }, [inputRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    onNavigate(event.shiftKey ? "previous" : "next");
  };

  return (
    <div
      className="absolute top-2 right-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
      data-file-find-bar
      role="search"
    >
      <Input
        ref={inputRef}
        nativeInput
        type="text"
        size="sm"
        className="w-48 max-w-[45vw]"
        aria-label="Find in file"
        placeholder="Find"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <span
        className="min-w-14 px-1 text-center text-[11px] text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {matchCount > 0 && currentIndex !== null
          ? `${currentIndex + 1} of ${matchCount}`
          : "No results"}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={matchCount === 0}
        onClick={() => onNavigate("previous")}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={matchCount === 0}
        onClick={() => onNavigate("next")}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close find"
        title="Close find (Escape)"
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}
