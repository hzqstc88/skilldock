import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useTranslate } from "@/app/i18n";
import {
  type GithubSearchRepository,
  type GithubSearchResponse,
  searchGithubRepositories,
} from "@/features/skills/api/skill-client";
import { useFailureReporter } from "@/app/failure-feedback";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; response: GithubSearchResponse };

const PER_PAGE = 20;

const TOPIC_PRESETS = [
  { value: "codex", labelKey: "githubSearch.topic.codex" as const },
  { value: "codex-cli", labelKey: "githubSearch.topic.codex-cli" as const },
  { value: "claude-code", labelKey: "githubSearch.topic.claude-code" as const },
  { value: "mcp", labelKey: "githubSearch.topic.mcp" as const },
];

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function GithubSearchPanel() {
  const { t } = useTranslate();
  const reportFailure = useFailureReporter();
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState<string>("codex");
  const [language, setLanguage] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copiedFullName, setCopiedFullName] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

  const enabledTopicPresets = useMemo(() => TOPIC_PRESETS, []);

  function resetCopyTimer(fullName: string) {
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
    }
    copyTimer.current = setTimeout(() => {
      setCopiedFullName(null);
      copyTimer.current = null;
    }, 1500);
    setCopiedFullName(fullName);
  }

  function copyCloneUrl(item: GithubSearchRepository) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setStatus({
        kind: "error",
        message: t("githubSearch.copy.unsupported"),
      });
      return;
    }
    navigator.clipboard
      .writeText(item.cloneUrl)
      .then(() => {
        resetCopyTimer(item.fullName);
      })
      .catch((error) => {
        reportFailure(error, {
          operation: "github-search.copy",
          fallbackMessage: t("githubSearch.copy.failed"),
        });
        setStatus({
          kind: "error",
          message: t("githubSearch.copy.failed"),
        });
      });
  }

  async function handleSearch() {
    const trimmedKeyword = keyword.trim();
    const trimmedTopic = topic.trim();
    const trimmedLanguage = language.trim();
    if (!trimmedKeyword && !trimmedTopic && !trimmedLanguage) {
      setStatus({
        kind: "error",
        message: t("githubSearch.error.empty"),
      });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const topics = trimmedTopic
        ? trimmedTopic
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [];
      const response = await searchGithubRepositories({
        query: trimmedKeyword,
        topics,
        language: trimmedLanguage || null,
        perPage: PER_PAGE,
        page: 1,
      });
      setStatus({ kind: "ok", response });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      setStatus({ kind: "error", message });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSearch();
    }
  }

  return (
    <div className="github-search-panel" data-testid="github-search-panel">
      <header className="github-search-panel__intro">
        <h2>{t("githubSearch.title")}</h2>
        <p className="github-search-panel__description">
          {t("githubSearch.description")}
        </p>
      </header>

      <div className="github-search-panel__form" role="search">
        <label className="github-search-field">
          <span>{t("githubSearch.keyword.label")}</span>
          <input
            type="search"
            placeholder={t("githubSearch.keyword.placeholder")}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t("githubSearch.keyword.label")}
          />
        </label>
        <label className="github-search-field">
          <span>{t("githubSearch.topic.label")}</span>
          <input
            type="text"
            placeholder={t("githubSearch.topic.placeholder")}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t("githubSearch.topic.label")}
            list="github-search-topic-presets"
          />
          <datalist id="github-search-topic-presets">
            {enabledTopicPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {t(preset.labelKey)}
              </option>
            ))}
          </datalist>
        </label>
        <label className="github-search-field">
          <span>{t("githubSearch.language.label")}</span>
          <input
            type="text"
            placeholder={t("githubSearch.language.placeholder")}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t("githubSearch.language.label")}
          />
        </label>
        <button
          type="button"
          className="github-search-submit"
          onClick={() => void handleSearch()}
          disabled={status.kind === "loading"}
        >
          {status.kind === "loading"
            ? t("githubSearch.search.loading")
            : t("githubSearch.search.action")}
        </button>
      </div>

      {status.kind === "error" ? (
        <div className="github-search-panel__error" role="alert">
          {status.message}
        </div>
      ) : null}

      {status.kind === "ok" ? (
        <Results response={status.response} onCopy={copyCloneUrl} copiedFullName={copiedFullName} t={t} />
      ) : null}

      {status.kind === "idle" ? (
        <p className="github-search-panel__hint">{t("githubSearch.hint.idle")}</p>
      ) : null}
    </div>
  );
}

type ResultsProps = {
  response: GithubSearchResponse;
  onCopy: (item: GithubSearchRepository) => void;
  copiedFullName: string | null;
  t: ReturnType<typeof useTranslate>["t"];
};

function Results(props: ResultsProps) {
  const { response, onCopy, copiedFullName, t } = props;
  const items = response.items;

  return (
    <section className="github-search-panel__results">
      <p className="github-search-panel__totalCount">
        {t("githubSearch.results.total", { count: formatCount(response.totalCount) })}
      </p>
      {response.incompleteResults ? (
        <p className="github-search-panel__warning">
          {t("githubSearch.results.incomplete")}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="github-search-panel__empty">
          {t("githubSearch.results.empty")}
        </p>
      ) : (
        <ol className="github-search-results-list">
          {items.map((item) => (
            <li
              key={item.fullName}
              className="github-search-result-item"
            >
              <header className="github-search-result-item__header">
                <a
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="github-search-result-item__name"
                >
                  {item.fullName}
                </a>
                <span className="github-search-result-item__stars">
                  ★ {formatCount(item.stars)}
                </span>
                {item.language ? (
                  <span className="github-search-result-item__language">
                    {item.language}
                  </span>
                ) : null}
              </header>
              {item.description ? (
                <p className="github-search-result-item__description">
                  {item.description}
                </p>
              ) : (
                <p className="github-search-result-item__description is-empty">
                  {t("githubSearch.results.noDescription")}
                </p>
              )}
              {item.topics.length > 0 ? (
                <ul className="github-search-result-item__topics">
                  {item.topics.map((topic) => (
                    <li key={topic} className="github-search-result-item__topic">
                      {topic}
                    </li>
                  ))}
                </ul>
              ) : null}
              <footer className="github-search-result-item__footer">
                <code className="github-search-result-item__cloneUrl">
                  {item.cloneUrl}
                </code>
                <button
                  type="button"
                  className="github-search-result-item__copy"
                  onClick={() => onCopy(item)}
                >
                  {copiedFullName === item.fullName
                    ? t("githubSearch.copy.done")
                    : t("githubSearch.copy.action")}
                </button>
              </footer>
              <p className="github-search-result-item__hint">
                {t("githubSearch.results.installHint", {
                  fullName: item.fullName,
                })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
