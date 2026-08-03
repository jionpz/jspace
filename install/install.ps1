# JSpace 一键安装脚本（Windows / PowerShell 5.1+）
# 用法（两段式落盘，符合治理红线）:
#   irm <url>/install/install.ps1 -OutFile $env:TEMP\jspace-install.ps1
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\jspace-install.ps1
# 卸载（双触发）:
#   ① 落盘后: powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#   ② env 触发: $env:JSPACE_UNINSTALL=1; irm <url> | iex
# 环境变量: JSPACE_VERSION=<tag>(默认 latest)、JSPACE_BASE_URL=<base>(默认 GitHub releases)
param(
    [switch]$Uninstall,
    [switch]$Force,
    [switch]$NoPath
)

$ErrorActionPreference = 'Stop'
# PS5.1 默认 TLS1.0，GitHub 需 TLS1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
# iwr 进度条使下载慢一个数量级
$ProgressPreference = 'SilentlyContinue'

# env 触发（兼容 irm|iex 场景的卸载）
if ($env:JSPACE_UNINSTALL) { $Uninstall = $true }

function Write-Log  { Write-Host ("✓ {0}" -f $args) }
function Write-Warn { Write-Host ("⚠ {0}" -f $args) }
function Fail       { Write-Host ("jspace-install: error: {0}" -f $args); exit 1 }

$INSTALL_DIR = Join-Path $env:LOCALAPPDATA 'jspace\bin'
$BIN         = Join-Path $INSTALL_DIR 'jspace.exe'
$PATH_ENTRY  = $INSTALL_DIR.TrimEnd('\')

function Add-JspacePath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    $parts = @($userPath -split ';' | Where-Object { $_ })
    $found = $parts | Where-Object { $_.TrimEnd('\') -ieq $PATH_ENTRY }
    if ($found) { Write-Log ("用户 PATH 已存在: {0}" -f $PATH_ENTRY); return }
    $sep = if ($parts.Count -gt 0) { ';' } else { '' }
    [Environment]::SetEnvironmentVariable('Path', $userPath + $sep + $INSTALL_DIR, 'User')
    Write-Log ("已写入用户 PATH: {0}" -f $INSTALL_DIR)
}

function Remove-JspacePath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { return }
    $remaining = @($userPath -split ';') | Where-Object { ($_.TrimEnd('\')) -ne $PATH_ENTRY }
    [Environment]::SetEnvironmentVariable('Path', ($remaining -join ';'), 'User')
}

function Invoke-Download {
    param([string]$Url, [string]$Out)
    try { Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing }
    catch { Fail ("下载失败: {0}（{1}）" -f $Url, $_.Exception.Message) }
}

function Get-ExpectedHash {
    param([string]$ChecksumsFile, [string]$Asset)
    if (-not (Test-Path -LiteralPath $ChecksumsFile)) { return $null }
    foreach ($line in Get-Content -LiteralPath $ChecksumsFile) {
        $parts = $line -split '\s+'
        if ($parts.Count -lt 2) { continue }
        $file = $parts[1]
        if ($file.StartsWith('*')) { $file = $file.Substring(1) }  # GNU sha256sum -b 的 * 前缀
        if ($file -eq $Asset) { return $parts[0].ToLowerInvariant() }
    }
    return $null
}

function Get-Arch {
    $arch = $env:PROCESSOR_ARCHITEW6432   # x86 PS 下的 64 位 OS 取真实架构
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ($arch -eq 'AMD64') {
        # ARM64 主机上的 x64 模拟 → 提示
        if ($env:PROCESSOR_IDENTIFIER -like '*ARM64*') { Write-Warn '检测到 ARM64 系统上的 x64 模拟，将安装 x64 版本' }
        return 'x64'
    }
    if ($arch -eq 'ARM64') { return 'arm64' }
    Fail ("不支持的架构: {0}（支持 x64 / arm64）" -f $arch)
}

# ---------- 卸载 ----------
if ($Uninstall) {
    Write-Host '卸载 jspace...'
    Remove-JspacePath
    if (Test-Path -LiteralPath $BIN) { Remove-Item -LiteralPath $BIN -Force }
    if ((Test-Path -LiteralPath $INSTALL_DIR) -and -not (Get-ChildItem -LiteralPath $INSTALL_DIR -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $INSTALL_DIR -Force   # 目录仅空才删
    }
    Write-Log '卸载完成。用户 PATH 已移除该条目。新终端生效。'
    exit 0
}

# ---------- 安装：打印计划 ----------
Write-Host 'jspace 安装计划:'
Write-Host ("  - 安装到  {0}" -f $INSTALL_DIR)
if (-not $NoPath) { Write-Host '  - 将写入用户 PATH（可随卸载移除）' }

$arch = Get-Arch
$asset = "jspace-windows-$arch.exe"
Write-Host ("  - 目标产物  {0}" -f $asset)

$baseUrl = if ($env:JSPACE_BASE_URL) { $env:JSPACE_BASE_URL } else { 'https://github.com/jionpz/jspace/releases' }
$ver     = if ($env:JSPACE_VERSION)   { $env:JSPACE_VERSION }   else { 'latest' }
# GitHub 的 /download/<tag> 会把 latest 当字面 tag（返回 404）；
# latest 必须走 /latest/download 重定向写法，具体 tag 才走 /download/<tag>
$dl = if ($ver -eq 'latest') { "$baseUrl/latest/download" } else { "$baseUrl/download/$ver" }

$tmp = Join-Path $env:TEMP ("jspace-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    # 两段式下载到临时目录
    Invoke-Download -Url "$dl/$asset" -Out (Join-Path $tmp 'jspace.exe')
    Invoke-Download -Url "$dl/checksums.txt" -Out (Join-Path $tmp 'checksums.txt')

    # SHA-256 校验
    $expected = Get-ExpectedHash -ChecksumsFile (Join-Path $tmp 'checksums.txt') -Asset $asset
    if (-not $expected) { Fail ("checksums.txt 中未找到产物 {0}（发布不完整？）" -f $asset) }
    $actual = (Get-FileHash -LiteralPath (Join-Path $tmp 'jspace.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Fail ("SHA-256 校验不匹配。期望 {0}，实际 {1}" -f $expected, $actual) }

    # 安装
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
    if (Test-Path -LiteralPath $BIN) {
        $running = Get-Process -Name 'jspace' -ErrorAction SilentlyContinue
        if ($running) { Fail 'jspace 正在运行，无法覆盖。请先关闭相关进程后重试' }
        if (-not $Force) {
            $v = & $BIN --version 2>$null
            if ($LASTEXITCODE -ne 0 -or -not ($v -match '^jspace ')) {
                Fail ("已有同名文件 {0} 且不是 jspace。用 -Force 覆盖" -f $BIN)
            }
        }
    }
    Copy-Item -LiteralPath (Join-Path $tmp 'jspace.exe') -Destination $BIN -Force

    # 绝对路径自检（PATH 只对后续进程生效）
    $verOut = & $BIN --version
    if ($LASTEXITCODE -ne 0) { Fail '安装后自检失败' }
    Write-Log ("已安装 {0}" -f $verOut)

    if (-not $NoPath) { Add-JspacePath }
    Write-Host '请新开终端后使用 jspace（PATH 对新进程生效）'
    Write-Log '安装完成。运行 jspace --version 确认，jspace init <目录> 生成工作台。'
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
