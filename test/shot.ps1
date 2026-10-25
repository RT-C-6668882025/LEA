# Usage: powershell -NoProfile -File shot.ps1 <output-path>
# Bring the Universal Renderer window to front and take a full-screen shot.
param([string]$Out = "E:\universal-renderer\test\shot.png")
$Out = $Out.Replace('/', '\')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$p = Get-Process electron, UniversalRenderer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'no-window'; exit 1 }
[Win32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$bmp.Save($Out)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $Out"
