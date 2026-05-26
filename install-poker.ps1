# OpenClaw Game — LangGraph TRX Poker Platform Installer for Windows
#
# Usage (one-liner from GitHub):
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/YOUR_ORG/openclawgame/main/install-poker.ps1 | iex"
#
# Or with options:
#   .\install-poker.ps1 -PlatformUrl "https://your-app.up.railway.app" -NoOnboard

param(
    [string]$PlatformUrl = "",
    [string]$ForkUrl = "https://github.com/YOUR_ORG/openclawgame.git",
    [string]$InstallDir = "",
    [switch]$NoOnboard,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ── colours ──────────────────────────────────────────────────────────────────
function Write-Step  { param([string]$Msg) Write-Host "  $Msg" -ForegroundColor Cyan }
function Write-OK    { param([string]$Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host " [!] $Msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host "[ERR] $Msg" -ForegroundColor Red }
function Write-Stage { param([string]$Msg) Write-Host "`n--- $Msg ---" -ForegroundColor Magenta }

# ── banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  OpenClaw Game — LangGraph TRX Poker Platform Installer" -ForegroundColor Cyan
Write-Host "  Windows setup script" -ForegroundColor DarkGray
Write-Host ""

if ($DryRun) {
    Write-Warn "DRY RUN — no changes will be made"
    Write-Host ""
}

# ── resolve install dir ───────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) "openclawgame"
}

# ── helper: refresh PATH in this session ─────────────────────────────────────
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Add-UserPath {
    param([string]$Dir)
    if ([string]::IsNullOrWhiteSpace($Dir)) { return }
    $current = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = $current -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if ($entries | Where-Object { $_ -ieq $Dir }) { return }
    [Environment]::SetEnvironmentVariable("Path", "$current;$Dir", "User")
    $env:Path = "$env:Path;$Dir"
}

# ── stage 1: Node.js 22+ ──────────────────────────────────────────────────────
Write-Stage "[1/5] Node.js"

function Test-NodeOk {
    try {
        $v = (node -v 2>$null)
        if (-not $v) { return $false }
        $major = [int]($v -replace '^v(\d+)\..*','$1')
        $minor = [int]($v -replace '^v\d+\.(\d+)\..*','$1')
        return ($major -gt 22) -or ($major -eq 22 -and $minor -ge 19)
    } catch { return $false }
}

if (Test-NodeOk) {
    Write-OK "Node.js $(node -v) found"
} else {
    Write-Step "Node.js 22.19+ not found — attempting install"
    $nodeInstalled = $false

    if (-not $DryRun) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Write-Step "Installing via winget..."
            winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements 2>$null
            Refresh-Path
            if (Test-NodeOk) { $nodeInstalled = $true; Write-OK "Node.js installed via winget" }
        }
        if (-not $nodeInstalled -and (Get-Command choco -ErrorAction SilentlyContinue)) {
            Write-Step "Installing via Chocolatey..."
            choco install nodejs-lts -y 2>$null
            Refresh-Path
            if (Test-NodeOk) { $nodeInstalled = $true; Write-OK "Node.js installed via Chocolatey" }
        }
        if (-not $nodeInstalled -and (Get-Command scoop -ErrorAction SilentlyContinue)) {
            Write-Step "Installing via Scoop..."
            scoop install nodejs-lts 2>$null
            Refresh-Path
            if (Test-NodeOk) { $nodeInstalled = $true; Write-OK "Node.js installed via Scoop" }
        }
    } else {
        $nodeInstalled = $true
    }

    if (-not $nodeInstalled) {
        Write-Fail "Could not install Node.js automatically."
        Write-Host ""
        Write-Host "  Please install Node.js 22+ manually, then re-run this installer:"
        Write-Host "  https://nodejs.org/en/download/" -ForegroundColor Cyan
        Write-Host ""
        exit 1
    }
}

# ── stage 2: git ──────────────────────────────────────────────────────────────
Write-Stage "[2/5] Git"

if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-OK "git $(git --version)"
} else {
    Write-Step "git not found — attempting install"
    $gitInstalled = $false
    if (-not $DryRun) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install Git.Git --source winget --accept-package-agreements --accept-source-agreements 2>$null
            Refresh-Path
            if (Get-Command git -ErrorAction SilentlyContinue) { $gitInstalled = $true; Write-OK "git installed" }
        }
        if (-not $gitInstalled -and (Get-Command choco -ErrorAction SilentlyContinue)) {
            choco install git -y 2>$null
            Refresh-Path
            if (Get-Command git -ErrorAction SilentlyContinue) { $gitInstalled = $true; Write-OK "git installed" }
        }
    } else {
        $gitInstalled = $true
    }

    if (-not $gitInstalled) {
        Write-Fail "Could not install git automatically."
        Write-Host "  Install Git for Windows: https://git-scm.com/download/win" -ForegroundColor Cyan
        exit 1
    }
}

# ── stage 3: clone / update fork ─────────────────────────────────────────────
Write-Stage "[3/5] openclawgame fork"
Write-Step "Target directory: $InstallDir"

if (-not $DryRun) {
    if (Test-Path (Join-Path $InstallDir ".git")) {
        Write-Step "Updating existing checkout..."
        $dirty = git -C $InstallDir status --porcelain 2>$null
        if ($dirty) {
            Write-Warn "Working tree is dirty — skipping git pull"
        } else {
            git -C $InstallDir pull --rebase --quiet 2>$null
        }
        Write-OK "Checkout updated"
    } else {
        Write-Step "Cloning $ForkUrl..."
        git clone $ForkUrl $InstallDir --quiet
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "git clone failed. Check the ForkUrl parameter."
            exit 1
        }
        Write-OK "Cloned to $InstallDir"
    }

    # install pnpm via corepack if needed
    $packageJson = Get-Content (Join-Path $InstallDir "package.json") -Raw | ConvertFrom-Json
    $pnpmVersion = if ($packageJson.packageManager -match 'pnpm@(.+)') { $Matches[1] } else { "latest" }
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) {
        Write-Step "Installing pnpm ($pnpmVersion)..."
        $prevShell = $env:NPM_CONFIG_SCRIPT_SHELL
        $env:NPM_CONFIG_SCRIPT_SHELL = "cmd.exe"
        try {
            corepack enable 2>$null
            corepack prepare "pnpm@$pnpmVersion" --activate 2>$null
        } finally {
            $env:NPM_CONFIG_SCRIPT_SHELL = $prevShell
        }
        Refresh-Path
        if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
            npm install -g pnpm --quiet
        }
        Write-OK "pnpm ready"
    } else {
        Write-OK "pnpm $(pnpm --version) found"
    }

    # pnpm install + build
    Write-Step "Installing dependencies (this may take a few minutes)..."
    $prevShell = $env:NPM_CONFIG_SCRIPT_SHELL
    $env:NPM_CONFIG_SCRIPT_SHELL = "cmd.exe"
    $env:NODE_LLAMA_CPP_SKIP_DOWNLOAD = "1"
    Push-Location $InstallDir
    try {
        pnpm install --frozen-lockfile 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "pnpm install failed — re-run with verbose output to diagnose."
            exit 1
        }
        Write-OK "Dependencies installed"

        Write-Step "Building..."
        pnpm build 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "pnpm build failed"
            exit 1
        }
        Write-OK "Build complete"
    } finally {
        Pop-Location
        $env:NPM_CONFIG_SCRIPT_SHELL = $prevShell
    }
} else {
    Write-Warn "DRY RUN: skipping clone / install / build"
}

# create wrapper in ~/.local/bin
$binDir  = Join-Path $env:USERPROFILE ".local\bin"
$cmdPath = Join-Path $binDir "openclaw.cmd"
$entryJs = Join-Path $InstallDir "dist\entry.js"

if (-not $DryRun) {
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Force -Path $binDir | Out-Null }
    $wrapper = "@echo off`r`nset NODE_LLAMA_CPP_SKIP_DOWNLOAD=1`r`nnode `"$entryJs`" %*`r`n"
    Set-Content -Path $cmdPath -Value $wrapper -NoNewline
    Add-UserPath $binDir
    Write-OK "openclaw.cmd -> $entryJs"
}

# ── stage 4: configure platform URL ──────────────────────────────────────────
Write-Stage "[4/5] Platform URL"

if ([string]::IsNullOrWhiteSpace($PlatformUrl)) {
    Write-Host ""
    Write-Host "  Enter the LangGraph TRX poker platform URL." -ForegroundColor White
    Write-Host "  Example: https://your-app.up.railway.app" -ForegroundColor DarkGray
    Write-Host "  Leave blank to configure later (run poker_setup in a conversation)." -ForegroundColor DarkGray
    Write-Host ""
    $PlatformUrl = (Read-Host "  Platform URL").Trim()
}

if (-not [string]::IsNullOrWhiteSpace($PlatformUrl)) {
    $PlatformUrl = $PlatformUrl.TrimEnd("/")
    if (-not $DryRun) {
        [Environment]::SetEnvironmentVariable("LANGGRAPH_POKER_URL", $PlatformUrl, "User")
        $env:LANGGRAPH_POKER_URL = $PlatformUrl
        Write-OK "LANGGRAPH_POKER_URL set in user environment"
    } else {
        Write-Warn "DRY RUN: would set LANGGRAPH_POKER_URL=$PlatformUrl"
    }
} else {
    Write-Warn "No URL provided — set LANGGRAPH_POKER_URL later or pass platform_url to poker_setup"
}

# ── stage 5: onboard ─────────────────────────────────────────────────────────
Write-Stage "[5/5] OpenClaw setup"

if (-not $DryRun) {
    $openclawCmd = $cmdPath
    if (-not (Test-Path $openclawCmd)) {
        $found = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
        $openclawCmd = if ($found) { $found.Source } else { $null }
    }

    if ($openclawCmd) {
        Write-Step "Running openclaw doctor (migrations)..."
        try { & $openclawCmd doctor --non-interactive 2>$null } catch {}

        if (-not $NoOnboard) {
            Write-Host ""
            Write-Host "  Starting interactive setup. Choose your AI provider and channels." -ForegroundColor White
            Write-Host "  Press Ctrl+C to skip and run 'openclaw onboard' later." -ForegroundColor DarkGray
            Write-Host ""
            Start-Process -FilePath $openclawCmd -ArgumentList "onboard" -NoNewWindow -Wait
        } else {
            Write-Warn "Skipping onboard (--NoOnboard). Run 'openclaw onboard' when ready."
        }
    } else {
        Write-Warn "openclaw.cmd not found on PATH yet. Open a new terminal, then run: openclaw onboard"
    }
} else {
    Write-Warn "DRY RUN: skipping onboard"
}

# ── done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Open a new terminal (to pick up PATH changes)" -ForegroundColor Gray
Write-Host "    2. Start openclaw:   openclaw gateway start" -ForegroundColor Cyan
Write-Host "    3. Talk to your agent and run the poker_setup tool" -ForegroundColor Cyan
Write-Host "    4. Restart openclaw after poker_setup completes" -ForegroundColor Gray
Write-Host "    5. Use list_tables, join_table, get_game_state, submit_action to play" -ForegroundColor Cyan
Write-Host ""
if (-not [string]::IsNullOrWhiteSpace($PlatformUrl)) {
    Write-Host "  Platform: $PlatformUrl" -ForegroundColor DarkGray
}
Write-Host "  Fork dir: $InstallDir" -ForegroundColor DarkGray
Write-Host ""
