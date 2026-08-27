param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $false)][string]$WindowTitle = "CIQ Simulator",
    [int]$ProcessId = 0,
    [int]$WindowX = 0,
    [int]$WindowY = 0,
    [ValidateRange(1, 32767)][int]$WindowWidth = 1200,
    [ValidateRange(1, 32767)][int]$WindowHeight = 1000
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ForgeWindows {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBmp, uint nFlags);
}
"@

$target = [IntPtr]::Zero
$needle = $WindowTitle
$targetPid = $ProcessId

$callback = [ForgeWindows+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$state)
    if ($targetPid -gt 0) {
        $pidOut = 0
        [void][ForgeWindows]::GetWindowThreadProcessId($handle, [ref]$pidOut)
        if ($pidOut -eq $targetPid) {
            $cls = New-Object System.Text.StringBuilder 256
            [void][ForgeWindows]::GetClassName($handle, $cls, $cls.Capacity)
            $rectCheck = New-Object ForgeWindows+RECT
            [void][ForgeWindows]::GetWindowRect($handle, [ref]$rectCheck)
            $w = [Math]::Abs($rectCheck.Right - $rectCheck.Left)
            $h = [Math]::Abs($rectCheck.Bottom - $rectCheck.Top)
            if ($cls.ToString() -eq "wxWindowNR" -and $w -gt 150 -and $h -gt 300) {
                $script:target = $handle
                return $false
            }
            if ($w -gt 150 -and $h -gt 300) {
                $script:target = $handle
            }
        }
        return $true
    }
    
    $cls = New-Object System.Text.StringBuilder 256
    [void][ForgeWindows]::GetClassName($handle, $cls, $cls.Capacity)
    $builder = New-Object System.Text.StringBuilder 512
    [void][ForgeWindows]::GetWindowText($handle, $builder, $builder.Capacity)
    if ($builder.ToString().IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or ($cls.ToString() -eq "wxWindowNR" -and [ForgeWindows]::IsWindowVisible($handle))) {
        $script:target = $handle
        return $false
    }
    return $true
}

[void][ForgeWindows]::EnumWindows($callback, [IntPtr]::Zero)
if ($target -eq [IntPtr]::Zero) { throw "Simulator window was not found." }

$rect = New-Object ForgeWindows+RECT
if (-not [ForgeWindows]::GetWindowRect($target, [ref]$rect)) { throw "Could not read simulator window bounds." }
$width = [Math]::Abs($rect.Right - $rect.Left)
$height = [Math]::Abs($rect.Bottom - $rect.Top)
if ($width -le 0 -or $height -le 0) {
    $width = $WindowWidth
    $height = $WindowHeight
}

$directory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OutputPath))
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

$printed = $false
try {
    $hdc = $graphics.GetHdc()
    $printed = [ForgeWindows]::PrintWindow($target, $hdc, 2)
    $graphics.ReleaseHdc($hdc)
} catch {
    $printed = $false
}

if ($printed) {
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    exit 0
}

# Fallback: CopyFromScreen
$swRestore = 9
$swpShowWindow = 0x0040
$swpNoMove = 0x0002
$swpNoSize = 0x0001
$hwndTopmost = [IntPtr](-1)
$hwndNoTopmost = [IntPtr](-2)
[void][ForgeWindows]::ShowWindowAsync($target, $swRestore)
[void][ForgeWindows]::SetWindowPos($target, $hwndTopmost, $WindowX, $WindowY, $WindowWidth, $WindowHeight, $swpShowWindow)
[void][ForgeWindows]::SetWindowPos($target, $hwndNoTopmost, 0, 0, 0, 0, $swpNoMove -bor $swpNoSize -bor $swpShowWindow)
[void][ForgeWindows]::BringWindowToTop($target)
[void][ForgeWindows]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 200

if (-not [ForgeWindows]::GetWindowRect($target, [ref]$rect)) { throw "Could not read simulator window bounds." }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "Simulator window has invalid dimensions." }

$bitmapFallback = New-Object System.Drawing.Bitmap $width, $height
$graphicsFallback = [System.Drawing.Graphics]::FromImage($bitmapFallback)
try {
    $graphicsFallback.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmapFallback.Size)
    $bitmapFallback.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphicsFallback.Dispose()
    $bitmapFallback.Dispose()
}
