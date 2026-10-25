# Usage: powershell -NoProfile -File shot-win.ps1 <output-path>
# PrintWindow capture of the Universal Renderer / electron main window (occlusion-proof)
param([string]$Out = "E:\universal-renderer\test\shot-win.png")
$Out = $Out.Replace('/', '\')
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr r, IntPtr hrgn, uint flags);
  public static readonly IntPtr TOPMOST = new IntPtr(-1);
  public static readonly IntPtr NOTOPMOST = new IntPtr(-2);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$p = Get-Process electron, UniversalRenderer -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and ($_.Path -like '*universal-renderer*' -or $_.Path -like '*UniversalRenderer*') } |
  Select-Object -First 1
if (-not $p) {
  $p = Get-Process UniversalRenderer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
if (-not $p) { Write-Output 'no-window'; exit 1 }
[Win32Cap]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
# 前台锁定策略会拒绝 SetForegroundWindow → 用 TOPMOST 强制可见 + 重绘
[Win32Cap]::SetWindowPos($p.MainWindowHandle, [Win32Cap]::TOPMOST, 0, 0, 0, 0, 0x0003) | Out-Null
Start-Sleep -Milliseconds 500
[Win32Cap]::RedrawWindow($p.MainWindowHandle, [IntPtr]::Zero, [IntPtr]::Zero, 0x0085) | Out-Null
Start-Sleep -Milliseconds 500
$r = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
if ($w -le 0 -or $h -le 0) { Write-Output 'bad-rect'; exit 1 }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[Win32Cap]::PrintWindow($p.MainWindowHandle, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()
[Win32Cap]::SetWindowPos($p.MainWindowHandle, [Win32Cap]::NOTOPMOST, 0, 0, 0, 0, 0x0003) | Out-Null
$bmp.Save($Out)
$bmp.Dispose()
Write-Output "saved $Out ${w}x${h} pid=$($p.Id)"
