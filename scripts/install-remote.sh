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

# Resolve latest release tag
TAG="${DISC_VERSION:-$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": "\(.*\)".*/\1/')}"

if [[ -z "$TAG" ]]; then
    echo "Could not determine release tag. Set DISC_VERSION to override." >&2
    exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY_NAME}-${PLATFORM}"

echo "Installing ${BINARY_NAME} ${TAG} for ${PLATFORM}..."

mkdir -p "${INSTALL_DIR}"
curl -fsSL --progress-bar "${DOWNLOAD_URL}" -o "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

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
