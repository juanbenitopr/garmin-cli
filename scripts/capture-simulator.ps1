param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$WindowTitle,
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

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$target = [IntPtr]::Zero
$needle = $WindowTitle
$callback = [ForgeWindows+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$state)
    if (-not [ForgeWindows]::IsWindowVisible($handle)) { return $true }
    $builder = New-Object System.Text.StringBuilder 512
    [void][ForgeWindows]::GetWindowText($handle, $builder, $builder.Capacity)
    if ($builder.ToString().IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $script:target = $handle
        return $false
    }
    return $true
}

[void][ForgeWindows]::EnumWindows($callback, [IntPtr]::Zero)
if ($target -eq [IntPtr]::Zero) { throw "Simulator window containing '$WindowTitle' was not found." }

# Restore first so SetWindowPos applies to the visible window rather than only
# changing the saved bounds of a minimized or maximized window.
$swRestore = 9
$swpShowWindow = 0x0040
$swpNoMove = 0x0002
$swpNoSize = 0x0001
$hwndTopmost = [IntPtr](-1)
$hwndNoTopmost = [IntPtr](-2)
[void][ForgeWindows]::ShowWindowAsync($target, $swRestore)
if (-not [ForgeWindows]::SetWindowPos($target, $hwndTopmost, $WindowX, $WindowY, $WindowWidth, $WindowHeight, $swpShowWindow)) {
    throw "Could not position and resize the simulator window."
}
# A short topmost pulse reliably lifts the simulator above overlapping windows
# without leaving it permanently topmost after the capture.
if (-not [ForgeWindows]::SetWindowPos($target, $hwndNoTopmost, 0, 0, 0, 0, $swpNoMove -bor $swpNoSize -bor $swpShowWindow)) {
    throw "Could not restore the simulator window z-order."
}
[void][ForgeWindows]::BringWindowToTop($target)
[void][ForgeWindows]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 200

$rect = New-Object ForgeWindows+RECT
if (-not [ForgeWindows]::GetWindowRect($target, [ref]$rect)) { throw "Could not read simulator window bounds." }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "Simulator window has invalid dimensions." }

$directory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OutputPath))
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
