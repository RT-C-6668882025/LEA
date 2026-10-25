@echo off
rem LEA MCP Server (stdio) - ELECTRON_RUN_AS_NODE pure-Node mode, no Node.js installation required
rem Works equally well in both layouts:
rem   Packaged: <install>\resources\app\mcp-server.cmd  -> exe goes two levels up, script is in the same directory as this file under src\main\
rem   Development: <repo>\mcp-server.cmd              -> directly reuse electron.exe from node_modules to run this script
setlocal
set "ELECTRON_RUN_AS_NODE=1"
if exist "%~dp0..\..\LEA.exe" (
  "%~dp0..\..\LEA.exe" "%~dp0src\main\mcp-stdio.js" %*
  goto :eof
)
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  "%~dp0node_modules\electron\dist\electron.exe" "%~dp0src\main\mcp-stdio.js" %*
  goto :eof
)
echo LEA not found next to this script. 1>&2
exit /b 1
