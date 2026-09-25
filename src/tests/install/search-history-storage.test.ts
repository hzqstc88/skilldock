import { describe, expect, it } from "vitest";

import {
  SEARCH_HISTORY_MAX_ENTRIES,
  addToHistory,
  createMemorySearchHistory,
  fingerprint,
  parseHistoryEntries,
  type SearchHistoryEntry,
} from "@/features/install/utils/searchHistoryStorage";

describe("parseHistoryEntries", () => {
  it("returns empty for null or undefined input", () => {
    expect(parseHistoryEntries(null)).toEqual([]);
    expect(parseHistoryEntries(undefined as unknown as string | null)).toEqual([]);
  });

  it("returns empty for invalid JSON", () => {
    expect(parseHistoryEntries("not json")).toEqual([]);
  });

  it("returns empty when JSON is not an array", () => {
    expect(parseHistoryEntries(JSON.stringify({ query: "codex" }))).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const raw = JSON.stringify([
      {
        query: "codex",
        topics: ["codex"],
        language: null,
        savedAt: "2026-01-01T00:00:00Z",
      },
      { foo: "bar" },
      null,
      "string",
      {
        query: 42,
        topics: [],
        language: null,
        savedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    const result = parseHistoryEntries(raw);
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe("codex");
  });
});

describe("fingerprint", () => {
  it("produces stable key regardless of topic order", () => {
    const a = fingerprint({ query: "codex", topics: ["a", "b"], language: "rust" });
    const b = fingerprint({ query: "codex", topics: ["b", "a"], language: "rust" });
    expect(a).toBe(b);
  });

  it("differs when query changes", () => {
    const base = fingerprint({ query: "codex", topics: [], language: null });
    expect(fingerprint({ query: "claude", topics: [], language: null })).not.toBe(base);
  });

  it("differs when language changes", () => {
    const base = fingerprint({ query: "codex", topics: [], language: null });
    expect(fingerprint({ query: "codex", topics: [], language: "rust" })).not.toBe(base);
  });

  it("differs when topics change", () => {
    const base = fingerprint({ query: "codex", topics: [], language: null });
    expect(fingerprint({ query: "codex", topics: ["codex"], language: null })).not.toBe(
      base,
    );
  });
});

describe("addToHistory", () => {
  const now = () => "2026-09-25T00:00:00Z";

  it("appends the first entry", () => {
    const result = addToHistory(
      [],
      { query: "codex", topics: [], language: null },
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe("codex");
    expect(result[0].savedAt).toBe("2026-09-25T00:00:00Z");
  });

  it("deduplicates by fingerprint and moves the entry to the head", () => {
    const existing: SearchHistoryEntry[] = [
      {
        query: "codex",
        topics: [],
        language: null,
        savedAt: "2026-09-20T00:00:00Z",
      },
      {
        query: "claude",
        topics: [],
        language: null,
        savedAt: "2026-09-21T00:00:00Z",
      },
    ];
    const result = addToHistory(
      existing,
      { query: "codex", topics: [], language: null },
      now,
    );
    expect(result).toHaveLength(2);
    expect(result[0].query).toBe("codex");
    expect(result[0].savedAt).toBe("2026-09-25T00:00:00Z");
    expect(result[1].query).toBe("claude");
  });

  it("treats topic reordering as the same entry", () => {
    const existing: SearchHistoryEntry[] = [
      {
        query: "codex",
        topics: ["a", "b"],
        language: null,
        savedAt: "2026-09-20T00:00:00Z",
      },
    ];
    const result = addToHistory(
      existing,
      { query: "codex", topics: ["b", "a"], language: null },
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0].savedAt).toBe("2026-09-25T00:00:00Z");
  });

  it("caps at SEARCH_HISTORY_MAX_ENTRIES and drops the oldest", () => {
    let result: SearchHistoryEntry[] = [];
    for (let i = 0; i < SEARCH_HISTORY_MAX_ENTRIES + 5; i++) {
      result = addToHistory(
        result,
        { query: `q${i}`, topics: [], language: null },
        () => `2026-01-${(i + 1).toString().padStart(2, "0")}T00:00:00Z`,
      );
    }
    expect(result).toHaveLength(SEARCH_HISTORY_MAX_ENTRIES);
    expect(result[0].query).toBe(`q${SEARCH_HISTORY_MAX_ENTRIES + 4}`);
    expect(result[SEARCH_HISTORY_MAX_ENTRIES - 1].query).toBe("q5");
  });

  it("returns previous unchanged when input is fully blank", () => {
    const existing: SearchHistoryEntry[] = [
      {
        query: "codex",
        topics: [],
        language: null,
        savedAt: "2026-09-20T00:00:00Z",
      },
    ];
    const result = addToHistory(
      existing,
      { query: "   ", topics: [" "], language: "" },
      now,
    );
    expect(result).toBe(existing);
  });
});

describe("createMemorySearchHistory", () => {
  it("round-trips load and save", () => {
    const storage = createMemorySearchHistory();
    expect(storage.load()).toEqual([]);
    const next: SearchHistoryEntry[] = [
      {
        query: "codex",
        topics: [],
        language: null,
        savedAt: "2026-09-25T00:00:00Z",
      },
    ];
    storage.save(next);
    expect(storage.load()).toBe(next);
  });

  it("preserves the initial array on construction", () => {
    const initial: SearchHistoryEntry[] = [
      {
        query: "codex",
        topics: [],
        language: null,
        savedAt: "2026-09-25T00:00:00Z",
      },
    ];
    const storage = createMemorySearchHistory(initial);
    expect(storage.load()).toBe(initial);
  });
});
