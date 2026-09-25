/**
 * GitHub 搜索历史的本地持久化层。
 *
 * 数据存到 `window.localStorage` 的 `codex.ghsearch.history` 键下,
 * 限 10 条;同 fingerprint 重复时移到头部并刷新时间戳。
 *
 * 把 storage 设计成可注入接口(接口契约见 SearchHistoryStorage),
 * 测试用 createMemorySearchHistory(),生产用 createLocalStorageSearchHistory()。
 */

export interface SearchHistoryEntry {
  query: string;
  topics: string[];
  language: string | null;
  /** ISO 8601 timestamp */
  savedAt: string;
}

export interface SearchHistoryStorage {
  load(): SearchHistoryEntry[];
  save(items: SearchHistoryEntry[]): void;
}

export const SEARCH_HISTORY_KEY = "codex.ghsearch.history";
export const SEARCH_HISTORY_MAX_ENTRIES = 10;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseEntry(value: unknown): SearchHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.query !== "string") {
    return null;
  }
  if (!isStringArray(candidate.topics)) {
    return null;
  }
  if (typeof candidate.language !== "string" && candidate.language !== null) {
    return null;
  }
  if (typeof candidate.savedAt !== "string") {
    return null;
  }
  return {
    query: candidate.query,
    topics: [...candidate.topics],
    language:
      typeof candidate.language === "string" ? candidate.language : null,
    savedAt: candidate.savedAt,
  };
}

export function parseHistoryEntries(raw: string | null): SearchHistoryEntry[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: SearchHistoryEntry[] = [];
  for (const item of parsed) {
    const entry = parseEntry(item);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

export function fingerprint(
  entry: Pick<SearchHistoryEntry, "query" | "topics" | "language">,
): string {
  const topicsPart = [...entry.topics].sort().join(",");
  const languagePart = entry.language ?? "";
  return `${entry.query}\u0001${topicsPart}\u0001${languagePart}`;
}

export interface HistoryInput {
  query: string;
  topics: string[];
  language: string | null;
}

export function addToHistory(
  previous: SearchHistoryEntry[],
  input: HistoryInput,
  now: () => string = () => new Date().toISOString(),
): SearchHistoryEntry[] {
  const trimmedQuery = input.query.trim();
  const trimmedTopics = input.topics
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0);
  const trimmedLanguage = input.language?.trim()
    ? input.language.trim()
    : null;
  if (!trimmedQuery && trimmedTopics.length === 0 && !trimmedLanguage) {
    return previous;
  }
  const next: SearchHistoryEntry = {
    query: trimmedQuery,
    topics: trimmedTopics,
    language: trimmedLanguage,
    savedAt: now(),
  };
  const fp = fingerprint(next);
  const withoutDuplicates = previous.filter(
    (existing) => fingerprint(existing) !== fp,
  );
  return [next, ...withoutDuplicates].slice(0, SEARCH_HISTORY_MAX_ENTRIES);
}

export function createLocalStorageSearchHistory(): SearchHistoryStorage {
  return {
    load() {
      if (typeof window === "undefined") {
        return [];
      }
      try {
        return parseHistoryEntries(window.localStorage.getItem(SEARCH_HISTORY_KEY));
      } catch {
        return [];
      }
    },
    save(items) {
      if (typeof window === "undefined") {
        return;
      }
      try {
        window.localStorage.setItem(
          SEARCH_HISTORY_KEY,
          JSON.stringify(items),
        );
      } catch {
        // quota exceeded or storage disabled; intentionally silent
      }
    },
  };
}

export function createMemorySearchHistory(
  initial: SearchHistoryEntry[] = [],
): SearchHistoryStorage {
  let state: SearchHistoryEntry[] = initial;
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
  };
}
