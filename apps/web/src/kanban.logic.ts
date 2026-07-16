export const KANBAN_COLUMN_IDS = ["plan", "todo", "doing", "done"] as const;

export type KanbanColumnId = (typeof KANBAN_COLUMN_IDS)[number];

export const KANBAN_COLUMN_LABELS: Record<KanbanColumnId, string> = {
  plan: "Plan",
  todo: "Todo",
  doing: "Doing",
  done: "Done",
};

export interface KanbanProjectLink {
  readonly environmentId: string;
  readonly projectId: string;
  readonly label: string;
  readonly workspaceRoot: string;
}

export interface KanbanThreadLink {
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly label: string;
}

export interface KanbanCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: KanbanColumnId;
  readonly order: number;
  readonly projectLinks: readonly KanbanProjectLink[];
  readonly threadLinks: readonly KanbanThreadLink[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KanbanCardInput {
  readonly title: string;
  readonly description: string;
  readonly projectLinks: readonly KanbanProjectLink[];
  readonly threadLinks: readonly KanbanThreadLink[];
}

export type KanbanColumnEnabled = Record<KanbanColumnId, boolean>;

export const DEFAULT_KANBAN_COLUMNS: KanbanColumnEnabled = {
  plan: true,
  todo: true,
  doing: true,
  done: true,
};

export function isKanbanColumnId(value: unknown): value is KanbanColumnId {
  return typeof value === "string" && KANBAN_COLUMN_IDS.includes(value as KanbanColumnId);
}

export function normalizeCardInput(input: KanbanCardInput): KanbanCardInput | null {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) return null;

  return {
    title,
    description,
    projectLinks: uniqueProjectLinks(input.projectLinks),
    threadLinks: uniqueThreadLinks(input.threadLinks),
  };
}

export function uniqueProjectLinks(
  links: readonly KanbanProjectLink[],
): readonly KanbanProjectLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.environmentId}:${link.projectId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function uniqueThreadLinks(links: readonly KanbanThreadLink[]): readonly KanbanThreadLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.environmentId}:${link.threadId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cardsForColumn(
  cards: readonly KanbanCard[],
  status: KanbanColumnId,
): readonly KanbanCard[] {
  return cards
    .filter((card) => card.status === status)
    .toSorted(
      (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
    );
}

export function nextCardStatus(columns: KanbanColumnEnabled): KanbanColumnId {
  return columns.todo ? "todo" : (KANBAN_COLUMN_IDS.find((column) => columns[column]) ?? "todo");
}

export function moveKanbanCard(input: {
  readonly cards: readonly KanbanCard[];
  readonly cardId: string;
  readonly destinationStatus: KanbanColumnId;
  readonly destinationIndex: number;
  readonly updatedAt: string;
}): readonly KanbanCard[] {
  const card = input.cards.find((entry) => entry.id === input.cardId);
  if (!card) return input.cards;

  const destination = cardsForColumn(
    input.cards.filter((entry) => entry.id !== card.id),
    input.destinationStatus,
  );
  const destinationIndex = Math.max(0, Math.min(input.destinationIndex, destination.length));
  const reorderedDestination = [
    ...destination.slice(0, destinationIndex),
    { ...card, status: input.destinationStatus, updatedAt: input.updatedAt },
    ...destination.slice(destinationIndex),
  ];
  const cardsWithoutMovedCard = input.cards.filter((entry) => entry.id !== card.id);
  const updatedById = new Map<string, KanbanCard>();
  for (const status of KANBAN_COLUMN_IDS) {
    const orderedCards =
      status === input.destinationStatus
        ? reorderedDestination
        : cardsForColumn(cardsWithoutMovedCard, status);
    orderedCards.forEach((entry, order) => updatedById.set(entry.id, { ...entry, order }));
  }

  return input.cards.map((entry) => updatedById.get(entry.id) ?? entry);
}

export function normalizePersistedKanbanCards(value: unknown): readonly KanbanCard[] {
  if (!Array.isArray(value)) return [];
  const cards: KanbanCard[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const card = candidate as Partial<KanbanCard>;
    if (
      typeof card.id !== "string" ||
      typeof card.title !== "string" ||
      typeof card.description !== "string" ||
      !isKanbanColumnId(card.status) ||
      typeof card.order !== "number" ||
      typeof card.createdAt !== "string" ||
      typeof card.updatedAt !== "string"
    ) {
      continue;
    }
    const normalized = normalizeCardInput({
      title: card.title,
      description: card.description,
      projectLinks: normalizeProjectLinks(card.projectLinks),
      threadLinks: normalizeThreadLinks(card.threadLinks),
    });
    if (!normalized) continue;
    cards.push({
      id: card.id,
      title: normalized.title,
      description: normalized.description,
      status: card.status,
      order: card.order,
      projectLinks: normalized.projectLinks,
      threadLinks: normalized.threadLinks,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    });
  }
  return cards;
}

export function normalizePersistedColumns(value: unknown): KanbanColumnEnabled {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_KANBAN_COLUMNS;
  const candidate = value as Partial<Record<KanbanColumnId, unknown>>;
  const columns = Object.fromEntries(
    KANBAN_COLUMN_IDS.map((column) => [column, candidate[column] !== false]),
  ) as KanbanColumnEnabled;
  return KANBAN_COLUMN_IDS.some((column) => columns[column]) ? columns : DEFAULT_KANBAN_COLUMNS;
}

function normalizeProjectLinks(value: unknown): readonly KanbanProjectLink[] {
  if (!Array.isArray(value)) return [];
  return uniqueProjectLinks(
    value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const link = candidate as Partial<KanbanProjectLink>;
      return typeof link.environmentId === "string" &&
        typeof link.projectId === "string" &&
        typeof link.label === "string" &&
        typeof link.workspaceRoot === "string"
        ? [{ ...link } as KanbanProjectLink]
        : [];
    }),
  );
}

function normalizeThreadLinks(value: unknown): readonly KanbanThreadLink[] {
  if (!Array.isArray(value)) return [];
  return uniqueThreadLinks(
    value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const link = candidate as Partial<KanbanThreadLink>;
      return typeof link.environmentId === "string" &&
        typeof link.threadId === "string" &&
        typeof link.projectId === "string" &&
        typeof link.label === "string"
        ? [{ ...link } as KanbanThreadLink]
        : [];
    }),
  );
}
