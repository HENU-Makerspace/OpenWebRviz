param(
    [ValidateSet('local','cloud')]
    [string]$Profile = 'local',
    [string]$RobotIp = '',
    [switch]$SkipInstall,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw 'bun is not installed or not available on PATH.'
}

if (-not $SkipInstall) {
    Write-Host '[1/3] Installing dependencies...'
    bun install
}

if ($RobotIp) {
    $env:ROBOT_HOST = $RobotIp
    $env:JETSON_HOST = $RobotIp
    $env:FRONTEND_WS_URL = "ws://${RobotIp}:9090"
    $env:VITE_ROSBRIDGE_PROXY_TARGET = "ws://${RobotIp}:9090"
    Write-Host "Using robot IP: $RobotIp"
}

Write-Host '[2/3] Starting project...'

$argumentList = @('run')

switch ($Profile) {
    'local' {
        $argumentList += 'dev:local'
    }
    'cloud' {
        $argumentList += 'dev:cloud'
    }
}

$process = Start-Process -FilePath 'bun' -ArgumentList $argumentList -WorkingDirectory $PSScriptRoot -PassThru

if ($NoBrowser) {
    Write-Host '[3/3] Browser auto-open is disabled.'
    exit 0
}

$targetUrl = switch ($Profile) {
    'local' { 'http://localhost:3000/' }
    'cloud' { 'http://localhost:3000/' }
}

Write-Host "[3/3] Waiting for $targetUrl and opening browser..."

$maxAttempts = 60
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $targetUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            Start-Process $targetUrl
            Write-Host "Opened $targetUrl"
            exit 0
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }
}

Write-Host "Project started in process ID $($process.Id), but $targetUrl was not reachable in time."
