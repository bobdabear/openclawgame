#!/usr/bin/env bash
# OpenClaw Game — LangGraph TRX Poker Platform Installer (macOS + Linux)
#
# Usage (one-liner from GitHub):
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/openclawgame/main/install-poker.sh | bash
#
# Or with options:
#   bash install-poker.sh --platform-url https://your-app.up.railway.app --no-onboard

set -euo pipefail

# ── colour helpers ────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m'

step()  { echo -e "  ${CYAN}${*}${NC}"; }
ok()    { echo -e "${GREEN}[OK]${NC} ${*}"; }
warn()  { echo -e "${YELLOW} [!]${NC} ${*}"; }
fail()  { echo -e "${RED}[ERR]${NC} ${*}" >&2; }
stage() { echo -e "\n${MAGENTA}${BOLD}--- ${*} ---${NC}"; }

# ── defaults (overridable by args) ────────────────────────────────────────────
PLATFORM_URL="${LANGGRAPH_POKER_URL:-}"
FORK_URL="https://github.com/YOUR_ORG/openclawgame.git"
INSTALL_DIR="${OPENCLAWGAME_DIR:-$HOME/openclawgame}"
NO_ONBOARD=0
DRY_RUN=0

NODE_MIN_MAJOR=22
NODE_MIN_MINOR=19
NODE_DEFAULT_MAJOR=24

# ── argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform-url|--url)  PLATFORM_URL="$2"; shift 2 ;;
        --fork-url)            FORK_URL="$2";     shift 2 ;;
        --install-dir|--dir)   INSTALL_DIR="$2";  shift 2 ;;
        --no-onboard)          NO_ONBOARD=1;      shift   ;;
        --dry-run)             DRY_RUN=1;         shift   ;;
        *) fail "Unknown option: $1"; exit 2 ;;
    esac
done

# ── banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${CYAN}${BOLD}OpenClaw Game — LangGraph TRX Poker Platform Installer${NC}"
echo -e "  ${GRAY}macOS + Linux setup script${NC}"
echo ""
[[ "$DRY_RUN" -eq 1 ]] && warn "DRY RUN — no changes will be made"

# ── detect OS ─────────────────────────────────────────────────────────────────
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]];                    then OS="macos"
elif [[ "$OSTYPE" == "linux"* ]] || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then OS="linux"
fi
if [[ "$OS" == "unknown" ]]; then
    fail "Unsupported OS. This script requires macOS or Linux (including WSL)."
    echo "For Windows, run: install-poker.ps1"
    exit 1
fi

is_root() { [[ "$(id -u)" -eq 0 ]]; }

maybe_sudo() {
    if is_root; then "$@"; else sudo "$@"; fi
}

add_to_profile() {
    local line="$1"
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
        [[ -f "$rc" ]] || continue
        grep -qxF "$line" "$rc" 2>/dev/null || echo "$line" >> "$rc"
    done
}

# ── stage 1: Node.js ──────────────────────────────────────────────────────────
stage "[1/5] Node.js"

node_ok() {
    command -v node &>/dev/null || return 1
    local major minor
    major="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
    minor="$(node -v | sed 's/v[0-9]*\.\([0-9]*\).*/\1/')"
    [[ "$major" -gt "$NODE_MIN_MAJOR" ]] ||
    { [[ "$major" -eq "$NODE_MIN_MAJOR" ]] && [[ "$minor" -ge "$NODE_MIN_MINOR" ]]; }
}

load_nvm() {
    local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
    [[ -s "$nvm_dir/nvm.sh" ]] || return 1
    # shellcheck disable=SC1090
    . "$nvm_dir/nvm.sh" --no-use &>/dev/null || . "$nvm_dir/nvm.sh" &>/dev/null || true
    nvm use default --silent &>/dev/null || nvm use node --silent &>/dev/null || true
}

load_nvm || true

if node_ok; then
    ok "Node.js $(node -v) found"
else
    step "Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ not found — installing"
    if [[ "$DRY_RUN" -eq 0 ]]; then
        if [[ "$OS" == "macos" ]]; then
            command -v brew &>/dev/null || {
                step "Installing Homebrew..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" || true
            }
            brew install "node@${NODE_DEFAULT_MAJOR}" --quiet
            brew link "node@${NODE_DEFAULT_MAJOR}" --overwrite --force 2>/dev/null || true
            export PATH="$(brew --prefix "node@${NODE_DEFAULT_MAJOR}")/bin:$PATH"
        elif [[ "$OS" == "linux" ]]; then
            if command -v apt-get &>/dev/null; then
                local tmp; tmp="$(mktemp)"
                curl -fsSL "https://deb.nodesource.com/setup_${NODE_DEFAULT_MAJOR}.x" -o "$tmp"
                maybe_sudo bash "$tmp" &>/dev/null
                maybe_sudo apt-get install -y -qq nodejs
            elif command -v dnf &>/dev/null; then
                local tmp; tmp="$(mktemp)"
                curl -fsSL "https://rpm.nodesource.com/setup_${NODE_DEFAULT_MAJOR}.x" -o "$tmp"
                maybe_sudo bash "$tmp" &>/dev/null
                maybe_sudo dnf install -y -q nodejs
            elif command -v pacman &>/dev/null; then
                maybe_sudo pacman -Sy --noconfirm nodejs npm
            elif command -v apk &>/dev/null; then
                maybe_sudo apk add --no-cache nodejs-current npm
            else
                fail "Could not detect a package manager. Install Node.js ${NODE_DEFAULT_MAJOR} manually: https://nodejs.org"
                exit 1
            fi
        fi
        if ! node_ok; then
            fail "Node.js install finished but the version check still fails."
            echo "  Open a new shell or install Node.js ${NODE_DEFAULT_MAJOR} manually, then rerun."
            exit 1
        fi
        ok "Node.js $(node -v) installed"
    else
        warn "DRY RUN: would install Node.js ${NODE_DEFAULT_MAJOR}"
    fi
fi

# ── stage 2: git ──────────────────────────────────────────────────────────────
stage "[2/5] git"

if command -v git &>/dev/null; then
    ok "git $(git --version | awk '{print $3}')"
else
    step "git not found — installing"
    if [[ "$DRY_RUN" -eq 0 ]]; then
        if [[ "$OS" == "macos" ]]; then
            brew install git --quiet
        elif command -v apt-get &>/dev/null; then
            maybe_sudo apt-get update -qq && maybe_sudo apt-get install -y -qq git
        elif command -v dnf &>/dev/null; then
            maybe_sudo dnf install -y -q git
        elif command -v pacman &>/dev/null; then
            maybe_sudo pacman -Sy --noconfirm git
        elif command -v apk &>/dev/null; then
            maybe_sudo apk add --no-cache git
        else
            fail "Could not install git. Install it manually: https://git-scm.com"
            exit 1
        fi
        ok "git installed"
    else
        warn "DRY RUN: would install git"
    fi
fi

# ── stage 3: clone / update fork ─────────────────────────────────────────────
stage "[3/5] openclawgame fork"
step "Target: $INSTALL_DIR"

if [[ "$DRY_RUN" -eq 0 ]]; then
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        step "Updating existing checkout..."
        if git -C "$INSTALL_DIR" status --porcelain | grep -q .; then
            warn "Working tree dirty — skipping git pull"
        else
            git -C "$INSTALL_DIR" pull --rebase --quiet 2>/dev/null || warn "git pull failed — continuing with existing checkout"
        fi
        ok "Checkout up to date"
    else
        step "Cloning $FORK_URL..."
        git clone "$FORK_URL" "$INSTALL_DIR" --quiet
        ok "Cloned to $INSTALL_DIR"
    fi

    # install pnpm via corepack if needed
    if ! command -v pnpm &>/dev/null; then
        step "Installing pnpm via corepack..."
        corepack enable 2>/dev/null || npm install -g corepack --quiet
        local pnpm_spec
        pnpm_spec="$(node -e "const p=require('$INSTALL_DIR/package.json');const m=p.packageManager?.match(/pnpm@(.+)/);console.log(m?'pnpm@'+m[1]:'pnpm@latest');")"
        corepack prepare "$pnpm_spec" --activate 2>/dev/null || npm install -g pnpm --quiet
        ok "pnpm ready"
    else
        ok "pnpm $(pnpm --version) found"
    fi

    step "Installing dependencies..."
    (
        cd "$INSTALL_DIR"
        NODE_LLAMA_CPP_SKIP_DOWNLOAD=1 pnpm install --frozen-lockfile --silent 2>/dev/null || \
        NODE_LLAMA_CPP_SKIP_DOWNLOAD=1 pnpm install --silent
    )
    ok "Dependencies installed"

    step "Building..."
    (
        cd "$INSTALL_DIR"
        NODE_LLAMA_CPP_SKIP_DOWNLOAD=1 pnpm build --silent 2>/dev/null || \
        NODE_LLAMA_CPP_SKIP_DOWNLOAD=1 pnpm build
    )
    ok "Build complete"

    # create wrapper
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
    WRAPPER="$BIN_DIR/openclaw"
    cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
export NODE_LLAMA_CPP_SKIP_DOWNLOAD=1
exec node "$INSTALL_DIR/dist/entry.js" "\$@"
EOF
    chmod +x "$WRAPPER"
    ok "openclaw -> $INSTALL_DIR/dist/entry.js"

    # persist to PATH if needed
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        export PATH="$BIN_DIR:$PATH"
        add_to_profile "export PATH=\"$BIN_DIR:\$PATH\""
        warn "Added $BIN_DIR to PATH — open a new shell or run: export PATH=\"$BIN_DIR:\$PATH\""
    fi
else
    warn "DRY RUN: skipping clone / install / build"
    BIN_DIR="$HOME/.local/bin"
    WRAPPER="$BIN_DIR/openclaw"
fi

# ── stage 4: configure platform URL ──────────────────────────────────────────
stage "[4/5] Platform URL"

if [[ -z "$PLATFORM_URL" ]]; then
    if [[ -t 0 ]]; then
        echo ""
        step "Enter the LangGraph TRX poker platform URL."
        echo -e "  ${GRAY}Example: https://your-app.up.railway.app${NC}"
        echo -e "  ${GRAY}Leave blank to configure later via poker_setup.${NC}"
        echo ""
        read -r -p "  Platform URL: " PLATFORM_URL
        PLATFORM_URL="${PLATFORM_URL%/}"
    else
        warn "Non-interactive shell — set LANGGRAPH_POKER_URL manually or pass --platform-url"
    fi
fi

if [[ -n "$PLATFORM_URL" ]]; then
    PLATFORM_URL="${PLATFORM_URL%/}"
    if [[ "$DRY_RUN" -eq 0 ]]; then
        add_to_profile "export LANGGRAPH_POKER_URL=\"$PLATFORM_URL\""
        export LANGGRAPH_POKER_URL="$PLATFORM_URL"
        ok "LANGGRAPH_POKER_URL set in shell profiles"
    else
        warn "DRY RUN: would set LANGGRAPH_POKER_URL=$PLATFORM_URL"
    fi
else
    warn "No URL provided — set LANGGRAPH_POKER_URL in your shell or pass it to poker_setup"
fi

# ── stage 5: onboard ─────────────────────────────────────────────────────────
stage "[5/5] OpenClaw setup"

if [[ "$DRY_RUN" -eq 0 ]]; then
    OPENCLAW_CMD="$WRAPPER"
    if [[ ! -x "$OPENCLAW_CMD" ]]; then
        OPENCLAW_CMD="$(command -v openclaw 2>/dev/null || true)"
    fi

    if [[ -n "$OPENCLAW_CMD" && -x "$OPENCLAW_CMD" ]]; then
        step "Running openclaw doctor (migrations)..."
        "$OPENCLAW_CMD" doctor --non-interactive 2>/dev/null || true

        if [[ "$NO_ONBOARD" -eq 0 ]]; then
            echo ""
            step "Starting interactive setup — choose your AI provider and channels."
            echo -e "  ${GRAY}Press Ctrl+C to skip and run 'openclaw onboard' later.${NC}"
            echo ""
            "$OPENCLAW_CMD" onboard || warn "Onboard exited non-zero — run 'openclaw onboard' to retry"
        else
            warn "Skipping onboard (--no-onboard). Run 'openclaw onboard' when ready."
        fi
    else
        warn "openclaw not found on PATH yet. Open a new terminal, then run: openclaw onboard"
    fi
else
    warn "DRY RUN: skipping onboard"
fi

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  Installation complete!${NC}"
echo ""
echo -e "${BOLD}  Next steps:${NC}"
echo -e "  ${GRAY}1. Open a new terminal (to pick up PATH + env changes)${NC}"
echo -e "  ${CYAN}2. Start openclaw:  openclaw gateway start${NC}"
echo -e "  ${CYAN}3. Talk to your agent and run the poker_setup tool${NC}"
echo -e "  ${GRAY}4. Restart openclaw after poker_setup completes${NC}"
echo -e "  ${CYAN}5. Use list_tables, join_table, get_game_state, submit_action to play${NC}"
echo ""
[[ -n "$PLATFORM_URL" ]] && echo -e "  ${GRAY}Platform: $PLATFORM_URL${NC}"
echo -e "  ${GRAY}Fork dir: $INSTALL_DIR${NC}"
echo ""
