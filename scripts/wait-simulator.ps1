param(
    [Parameter(Mandatory = $true)][string]$WindowTitle,
    [Parameter(Mandatory = $true)][int]$TimeoutMs
)

$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
while ([DateTime]::UtcNow -lt $deadline) {
    $match = Get-Process | Where-Object {
        $_.MainWindowTitle -and $_.MainWindowTitle.IndexOf($WindowTitle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
    if ($match) {
        Write-Output $match.Id
        exit 0
    }
    Start-Sleep -Milliseconds 200
}

throw "Simulator window containing '$WindowTitle' did not appear within $TimeoutMs ms."
