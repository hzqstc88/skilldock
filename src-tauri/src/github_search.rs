//! GitHub 仓库搜索能力
//!
//! 这是为 MVP 增加的模块,封装 `GET /search/repositories` 接口。
//! 与原有 `github_api.rs` 完全独立,不复用其 crate-private 助手,
//! 以避免在 fork 之后与 upstream 合并时产生冲突。
//!
//! 范围严格限定为「搜索」,不承担 OAuth 设备流、凭据存储、文件读取等职责。

use std::time::Duration;

use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_READ_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_SEARCH_QUERY_LENGTH: usize = 256;
const DEFAULT_SEARCH_SORT: &str = "stars";
const DEFAULT_SEARCH_ORDER: &str = "desc";

// ========================= 公开数据结构 =========================

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSearchRepository {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub description: String,
    pub html_url: String,
    pub clone_url: String,
    pub stars: u32,
    pub forks: u32,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub updated_at: String,
    pub pushed_at: String,
    pub default_branch: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSearchResponse {
    pub total_count: u32,
    pub incomplete_results: bool,
    pub items: Vec<GithubSearchRepository>,
}

// ========================= 私有反序列化结构 =========================

#[derive(Clone, Debug, Deserialize)]
struct GithubSearchRepositoryResponse {
    full_name: String,
    name: String,
    description: Option<String>,
    html_url: String,
    clone_url: String,
    stargazers_count: u32,
    forks_count: u32,
    language: Option<String>,
    topics: Option<Vec<String>>,
    updated_at: String,
    pushed_at: String,
    default_branch: String,
    owner: GithubSearchRepositoryOwnerResponse,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubSearchRepositoryOwnerResponse {
    login: String,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubSearchItemsResponse {
    total_count: u32,
    incomplete_results: bool,
    items: Vec<GithubSearchRepositoryResponse>,
}

// ========================= 私有映射 =========================

fn repository_from_response(response: GithubSearchRepositoryResponse) -> GithubSearchRepository {
    let (owner, name) = match response.full_name.split_once('/') {
        Some((o, n)) => (o.to_string(), n.to_string()),
        None => (response.owner.login, response.name),
    };
    GithubSearchRepository {
        owner,
        name,
        full_name: response.full_name,
        description: response.description.unwrap_or_default(),
        html_url: response.html_url,
        clone_url: response.clone_url,
        stars: response.stargazers_count,
        forks: response.forks_count,
        language: response.language,
        topics: response.topics.unwrap_or_default(),
        updated_at: response.updated_at,
        pushed_at: response.pushed_at,
        default_branch: response.default_branch,
    }
}

// ========================= 公开纯函数 =========================

/// 构造 GitHub `/search/repositories` 的 `q` 参数。
///
/// - `query`:自由关键字;空白会被 trim,空串会被剔除
/// - `topics`:作为 `topic:<value>` 追加,可多个
/// - `language`:作为 `language:<value>` 追加,`None` 表示不加
///
/// 用空格拼接;若没有任何过滤返回空串(调用方应拒绝这种输入)。
pub fn build_search_query(query: &str, topics: &[String], language: Option<&str>) -> String {
    let mut parts: Vec<String> = Vec::new();
    let trimmed_query = query.trim();
    if !trimmed_query.is_empty() {
        parts.push(trimmed_query.to_string());
    }
    for topic in topics {
        let trimmed = topic.trim();
        if !trimmed.is_empty() {
            parts.push(format!("topic:{trimmed}"));
        }
    }
    if let Some(lang) = language {
        let trimmed = lang.trim();
        if !trimmed.is_empty() {
            parts.push(format!("language:{trimmed}"));
        }
    }
    parts.join(" ")
}

/// 验证搜索 query;为空或过长时返回用户可读的中文错误。
pub fn validate_search_query(query: &str) -> Result<(), String> {
    if query.is_empty() {
        return Err("GitHub 搜索关键字不能为空,请至少输入一个关键字或选择一个主题过滤".to_string());
    }
    if query.chars().count() > MAX_SEARCH_QUERY_LENGTH {
        return Err(format!(
            "GitHub 搜索查询过长(最多 {MAX_SEARCH_QUERY_LENGTH} 字符)"
        ));
    }
    Ok(())
}

// ========================= 私有 HTTP 辅助 =========================

fn request(client: &Client, method: Method, url: &str, token: &str) -> reqwest::RequestBuilder {
    let mut builder = client
        .request(method, url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header(reqwest::header::USER_AGENT, "SkillDock");
    if !token.is_empty() {
        builder = builder.bearer_auth(token);
    }
    builder
}

fn search_repositories_url(
    query: &str,
    per_page: u8,
    page: u8,
    sort: Option<&str>,
    order: Option<&str>,
) -> Result<Url, String> {
    let mut url = Url::parse(GITHUB_API_BASE)
        .map_err(|error| format!("构建 GitHub Search URL 失败: {error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "构建 GitHub Search URL 失败".to_string())?;
        segments.push("search").push("repositories");
    }
    let per_page_value = per_page.clamp(1, 100);
    let page_value = page.max(1);
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("per_page", &per_page_value.to_string())
        .append_pair("page", &page_value.to_string());
    if let Some(s) = sort {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            url.query_pairs_mut().append_pair("sort", trimmed);
        }
    }
    if let Some(o) = order {
        let trimmed = o.trim();
        if !trimmed.is_empty() {
            url.query_pairs_mut().append_pair("order", trimmed);
        }
    }
    Ok(url)
}

fn response_is_rate_limited(response: &reqwest::Response) -> bool {
    if response.status() != StatusCode::FORBIDDEN {
        return false;
    }
    response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        == Some("0")
}

// ========================= 主入口 =========================

/// 调用 GitHub `/search/repositories`。
///
/// - `token`:可选 Personal Access Token / OAuth Token;提供时获得 5000 req/h 配额
/// - 按 `stars desc` 排序
pub async fn search_repositories(
    client: &Client,
    token: Option<&str>,
    query: &str,
    topics: &[String],
    language: Option<&str>,
    per_page: u8,
    page: u8,
) -> Result<GithubSearchResponse, String> {
    let combined = build_search_query(query, topics, language);
    validate_search_query(&combined)?;
    let url = search_repositories_url(
        &combined,
        per_page,
        page,
        Some(DEFAULT_SEARCH_SORT),
        Some(DEFAULT_SEARCH_ORDER),
    )?;
    let token_value = token.unwrap_or("");
    let request_builder = request(client, Method::GET, url.as_str(), token_value)
        .timeout(GITHUB_READ_TIMEOUT);
    let response = request_builder
        .send()
        .await
        .map_err(|error| format!("搜索 GitHub 仓库失败: {error}"))?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        let rate_limited = response_is_rate_limited(&response);
        if rate_limited {
            return Err(
                "搜索 GitHub 仓库失败: GitHub API 触发速率限制,请稍后重试或配置 Personal Access Token"
                    .to_string(),
            );
        }
        return Err(format!("搜索 GitHub 仓库失败: GitHub 返回 {status}"));
    }
    if status == StatusCode::UNPROCESSABLE_ENTITY {
        return Err("GitHub 搜索查询无效,请检查关键字或过滤条件".to_string());
    }
    if status != StatusCode::OK {
        return Err(format!("搜索 GitHub 仓库失败: GitHub 返回 {status}"));
    }
    let payload = response
        .json::<GithubSearchItemsResponse>()
        .await
        .map_err(|error| format!("解析 GitHub 搜索结果失败: {error}"))?;
    Ok(GithubSearchResponse {
        total_count: payload.total_count,
        incomplete_results: payload.incomplete_results,
        items: payload
            .items
            .into_iter()
            .map(repository_from_response)
            .collect(),
    })
}

// ========================= 单元测试 =========================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_search_query_with_keyword_only() {
        assert_eq!(build_search_query("codex plugin", &[], None), "codex plugin");
    }

    #[test]
    fn builds_search_query_with_topics_and_language() {
        assert_eq!(
            build_search_query(
                "codex",
                &["codex".to_string(), "skills".to_string()],
                Some("rust"),
            ),
            "codex topic:codex topic:skills language:rust"
        );
    }

    #[test]
    fn trims_whitespace_in_query_and_filters() {
        assert_eq!(
            build_search_query("  ", &["  codex  ".to_string()], Some(" rust ")),
            "topic:codex language:rust"
        );
    }

    #[test]
    fn empty_query_with_no_filters_returns_empty_string() {
        assert_eq!(build_search_query("", &[], None), "");
    }

    #[test]
    fn skips_empty_topic_and_language_values() {
        assert_eq!(
            build_search_query("codex", &["".to_string(), "  ".to_string()], Some("")),
            "codex"
        );
    }

    #[test]
    fn validates_search_query_rejects_empty() {
        let err = validate_search_query("").expect_err("空 query 应被拒绝");
        assert!(err.contains("不能为空"));
    }

    #[test]
    fn validates_search_query_accepts_keyword() {
        validate_search_query("codex plugin").expect("有效 query 应通过");
    }

    #[test]
    fn builds_search_repositories_url_with_default_sort() {
        let url = search_repositories_url(
            "codex plugin",
            10,
            1,
            Some(DEFAULT_SEARCH_SORT),
            Some(DEFAULT_SEARCH_ORDER),
        )
        .expect("构造 URL");
        assert_eq!(
            url.as_str(),
            "https://api.github.com/search/repositories?q=codex+plugin&per_page=10&page=1&sort=stars&order=desc"
        );
    }

    #[test]
    fn clamps_per_page_to_github_maximum() {
        let url = search_repositories_url(
            "codex",
            200,
            1,
            Some("updated"),
            Some("desc"),
        )
        .expect("构造 URL");
        assert!(
            url.as_str().contains("per_page=100"),
            "per_page 超过 100 应被夹到 100,实际 URL: {}",
            url.as_str()
        );
    }

    #[test]
    fn forces_page_minimum_to_one() {
        let url = search_repositories_url("codex", 10, 0, None, None)
            .expect("构造 URL");
        assert!(
            url.as_str().contains("page=1"),
            "page 小于 1 应被提升到 1,实际 URL: {}",
            url.as_str()
        );
    }

    #[test]
    fn builds_search_repositories_url_without_sort() {
        let url = search_repositories_url("codex", 10, 1, None, None)
            .expect("构造 URL");
        assert_eq!(
            url.as_str(),
            "https://api.github.com/search/repositories?q=codex&per_page=10&page=1"
        );
    }

    #[test]
    fn maps_search_repository_response_with_full_name() {
        let payload = r#"{
            "id": 1,
            "full_name": "octo/cat",
            "name": "cat",
            "description": "cat skill",
            "html_url": "https://github.com/octo/cat",
            "clone_url": "https://github.com/octo/cat.git",
            "stargazers_count": 42,
            "forks_count": 7,
            "language": "Rust",
            "topics": ["codex", "skills"],
            "updated_at": "2026-09-20T10:00:00Z",
            "pushed_at": "2026-09-20T11:00:00Z",
            "default_branch": "main",
            "owner": { "login": "octo" }
        }"#;
        let response: GithubSearchRepositoryResponse =
            serde_json::from_str(payload).expect("parse");
        let result = repository_from_response(response);
        assert_eq!(result.owner, "octo");
        assert_eq!(result.name, "cat");
        assert_eq!(result.full_name, "octo/cat");
        assert_eq!(result.stars, 42);
        assert_eq!(result.forks, 7);
        assert_eq!(result.language.as_deref(), Some("Rust"));
        assert_eq!(result.topics, vec!["codex", "skills"]);
        assert_eq!(result.default_branch, "main");
    }

    #[test]
    fn maps_search_repository_response_falls_back_to_owner_login() {
        let payload = r#"{
            "id": 1,
            "full_name": "no-slash",
            "name": "no-slash",
            "description": null,
            "html_url": "https://example.com/no-slash",
            "clone_url": "https://example.com/no-slash.git",
            "stargazers_count": 0,
            "forks_count": 0,
            "language": null,
            "topics": null,
            "updated_at": "2026-09-20T10:00:00Z",
            "pushed_at": "2026-09-20T10:00:00Z",
            "default_branch": "main",
            "owner": { "login": "owner-login" }
        }"#;
        let response: GithubSearchRepositoryResponse =
            serde_json::from_str(payload).expect("parse");
        let result = repository_from_response(response);
        assert_eq!(result.owner, "owner-login");
        assert_eq!(result.name, "no-slash");
        assert_eq!(result.description, "");
        assert_eq!(result.language, None);
        assert_eq!(result.topics, Vec::<String>::new());
    }
}
