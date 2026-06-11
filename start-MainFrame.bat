@echo off
REM ============================================================
REM MAINFRAME launcher
REM ============================================================
REM Sobe backend (uvicorn :8001) + frontend (Vite :5174) num
REM Windows Terminal com 2 abas, espera os servidores ficarem
REM prontos e abre o Chrome em http://localhost:5174/.
REM
REM Reload rapido: clica na aba "Backend" -> Ctrl+C -> seta cima
REM + Enter (reinicia uvicorn). O frontend tem HMR proprio.
REM
REM Se este .bat for movido pra outro lugar, ele continua
REM funcionando porque usa %~dp0 (caminho do proprio .bat).
REM ============================================================

setlocal
set "PROJECT_DIR=%~dp0"

REM `;` precisa ser escapado com `^` no cmd pra o wt enxergar
REM como separador de comandos do proprio Windows Terminal.
start "" wt -w 0 ^
  new-tab --title "MAINFRAME API" -d "%PROJECT_DIR%apps\api" cmd /k "python -m uvicorn main:app --reload --port 8001" ^; ^
  new-tab --title "MAINFRAME Web" -d "%PROJECT_DIR%apps\web" cmd /k "npm run dev"

REM Espera ~6s pros 2 servidores ficarem aceitando conexao.
REM Se sua maquina demora mais, aumente. Se demora menos, reduz.
timeout /t 6 /nobreak >nul

REM Abre o Chrome direto na URL do app (se o Chrome nao for o
REM browser default, use o caminho absoluto comentado abaixo).
start chrome http://localhost:5174/
REM start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5174/

endlocal
