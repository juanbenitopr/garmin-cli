param (
    [Parameter(Mandatory=$true)][int]$ProcessId
)
$ErrorActionPreference = "SilentlyContinue"
$csPath = Join-Path $PSScriptRoot "SimUnlocker.cs"
if (Test-Path $csPath) {
    Add-Type -Path $csPath -ErrorAction SilentlyContinue
    [SimUnlocker]::Unlock($ProcessId)
}
