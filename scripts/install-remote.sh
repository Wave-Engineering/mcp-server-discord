#!/usr/bin/env bash
# Install disc-server from a GitHub release.
# Detects platform, downloads the appropriate binary, installs to ~/.local/bin,
# and registers the MCP server in ~/.claude.json.
set -euo pipefail

REPO="Wave-Engineering/mcp-server-discord"
BINARY_NAME="disc-server"
INSTALL_DIR="${HOME}/.local/bin"
CLAUDE_CONFIG="${HOME}/.claude.json"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
    Linux-x86_64)   PLATFORM="linux-x64" ;;
    Darwin-x86_64)  PLATFORM="darwin-x64" ;;
    Darwin-arm64)   PLATFORM="darwin-arm64" ;;
    *)
        echo "Unsupported platform: ${OS}-${ARCH}" >&2
        exit 1
        ;;
esac

# Report a failed curl fetch and exit (#83). curl's exit status says which way it
# failed: the host could not be reached at all, or it answered with an HTTP error
# (-f makes curl exit 22 on 4xx/5xx).
# Usage: fetch_failed <curl-exit> <http-code> <url> <what the fetch was doing> [hint]
# The hint follows an HTTP error other than 404, the one failure a pin can get past.
fetch_failed() {
    local rc="$1" code="$2" url="$3" doing="$4" hint="${5:+ $5}"
    case "$rc" in
        6|7|28|35)
            echo "Network error while ${doing}: could not reach ${url} (curl exit ${rc}). Check the network or proxy, then re-run." >&2
            ;;
        22)
            if [[ "$code" == "404" ]]; then
                echo "HTTP 404 while ${doing}: ${url} does not exist." >&2
            else
                echo "HTTP ${code} while ${doing}: GitHub refused or failed the request for ${url}.${hint}" >&2
            fi
            ;;
        *)
            echo "curl failed (exit ${rc}) while ${doing}: ${url}." >&2
            ;;
    esac
    exit 1
}

# Resolve latest release tag from the releases/latest redirect, which lands on
# .../releases/tag/<tag>. Not the unauthenticated api.github.com endpoint: its
# 60/hour per-IP limit 403s on shared CI runners (#81). A pin skips the lookup.
LATEST_URL="https://github.com/${REPO}/releases/latest"
RESOLVED=""
if [[ -n "${DISC_VERSION:-}" ]]; then
    TAG="${DISC_VERSION}"
else
    RC=0
    RESOLVED="$(curl -fsSIL -o /dev/null -w '%{http_code} %{url_effective}' "${LATEST_URL}")" || RC=$?
    [[ "$RC" -eq 0 ]] || fetch_failed "$RC" "${RESOLVED%% *}" "${LATEST_URL}" "resolving the latest release" \
        "Set DISC_VERSION to a release tag (e.g. v1.2.3) to skip this lookup."
    # Empty unless the redirect landed on a tag page.
    TAG="$(printf '%s\n' "${RESOLVED#* }" | sed -n 's#.*/tag/##p')"
fi

if [[ -z "$TAG" ]]; then
    echo "Could not determine release tag: ${LATEST_URL} led to ${RESOLVED#* }, not a release. Set DISC_VERSION to override." >&2
    exit 1
fi

# A pin is checked too, so DISC_VERSION=1.4.2 fails here, not at download.
if [[ ! "$TAG" =~ ^v[0-9] ]]; then
    echo "Release tag '${TAG}' does not look like a tag. Set DISC_VERSION to a release tag (e.g. v1.2.3) to override." >&2
    exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY_NAME}-${PLATFORM}"

echo "Installing ${BINARY_NAME} ${TAG} for ${PLATFORM}..."

mkdir -p "${INSTALL_DIR}"
# Download to a temp file and rename into place.
# Direct -o on the final path would fail with ETXTBSY if the binary is
# currently running (e.g. Claude Code has it open as an MCP subprocess).
# rename(2) unlinks the old inode but keeps it alive for running processes.
TMP="${INSTALL_DIR}/${BINARY_NAME}.tmp.$$"
trap 'rm -f "${TMP}"' EXIT
RC=0
FETCHED="$(curl -fsSL --progress-bar -w '%{http_code} %{url_effective}' "${DOWNLOAD_URL}" -o "${TMP}")" || RC=$?
if [[ "$RC" -ne 0 ]]; then
    # github.com redirects the asset to a CDN host that a proxy can block on its own,
    # so name the URL curl actually failed on. Its query string is a signed token.
    WHERE="${FETCHED#* }"
    WHERE="${WHERE%%\?*}"
    if [[ -n "$WHERE" && "$WHERE" != "${DOWNLOAD_URL}" ]]; then
        WHERE="${WHERE} (redirected from ${DOWNLOAD_URL})"
    else
        WHERE="${DOWNLOAD_URL}"
    fi
    fetch_failed "$RC" "${FETCHED%% *}" "${WHERE}" "downloading ${BINARY_NAME} ${TAG}"
fi
chmod +x "${TMP}"
mv -f "${TMP}" "${INSTALL_DIR}/${BINARY_NAME}"
trap - EXIT

echo "Installed to ${INSTALL_DIR}/${BINARY_NAME}"

# Register MCP server in ~/.claude.json
if command -v jq &>/dev/null && [[ -f "${CLAUDE_CONFIG}" ]]; then
    BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"
    TOKEN_PLACEHOLDER="<your-discord-bot-token>"
    jq --arg path "${BINARY_PATH}" --arg token "${DISCORD_TOKEN:-${TOKEN_PLACEHOLDER}}" \
       '.mcpServers["disc-server"] = {"command": $path, "args": [], "env": {"DISCORD_TOKEN": $token}}' \
       "${CLAUDE_CONFIG}" > "${CLAUDE_CONFIG}.tmp" && mv "${CLAUDE_CONFIG}.tmp" "${CLAUDE_CONFIG}"
    echo "Registered disc-server in ${CLAUDE_CONFIG}"
    if [[ -z "${DISCORD_TOKEN:-}" ]]; then
        echo "  Note: DISCORD_TOKEN not set — update the placeholder in ${CLAUDE_CONFIG} before use"
    fi
else
    echo "Note: jq not found or ${CLAUDE_CONFIG} missing — register manually:"
    echo "  Add disc-server to mcpServers in ${CLAUDE_CONFIG} with command: ${INSTALL_DIR}/${BINARY_NAME}"
fi

echo "Done. Set DISCORD_TOKEN in your environment and restart Claude Code."
