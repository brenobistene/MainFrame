@echo off
REM ============================================================
REM MAINFRAME launcher (com auto-setup)
REM ============================================================
REM UM duplo clique resolve tudo: verifica as dependencias e,
REM se faltar algo, roda o setup.bat ANTES de abrir o app.
REM
REM Com tudo instalado, sobe backend (uvicorn :8001) + frontend
REM (Vite :5174) em 2 abas do Windows Terminal e abre o Chrome
REM em http://localhost:5174/.
REM
REM Reload rapido: clica na aba "MAINFRAME API" -> Ctrl+C ->
REM seta cima + Enter. O frontend tem HMR proprio.
REM
REM Usa %~dp0 (caminho do proprio .bat), entao funciona de
REM qualquer pasta.
REM ============================================================

setlocal
set "PROJECT_DIR=%~dp0"
set "NEED_SETUP="

REM ---- Python no PATH? ----
where python >nul 2>nul || set "NEED_SETUP=1"

REM ---- Node no PATH? ----
where node >nul 2>nul || set "NEED_SETUP=1"

REM ---- Dependencias do backend instaladas? (fastapi + uvicorn) ----
REM So checa se o python existe; senao o comando falharia por outro motivo.
if not defined NEED_SETUP (
    python -c "import fastapi, uvicorn" >nul 2>nul || set "NEED_SETUP=1"
)

REM ---- Dependencias do frontend instaladas? (node_modules existe) ----
if not exist "%PROJECT_DIR%apps\web\node_modules\" set "NEED_SETUP=1"

if defined NEED_SETUP (
    echo.
    echo [MAINFRAME] Falta instalar dependencias. Rodando o setup primeiro...
    echo.
    call "%PROJECT_DIR%setup.bat"

    REM Revalida apos o setup. Se Python/Node acabaram de ser instalados
    REM via winget, o PATH desta janela pode estar velho e precisa de uma
    REM sessao nova pra enxergar os comandos.
    set "STILL_MISSING="
    where python >nul 2>nul || set "STILL_MISSING=1"
    where node >nul 2>nul || set "STILL_MISSING=1"
    if not exist "%PROJECT_DIR%apps\web\node_modules\" set "STILL_MISSING=1"
    if defined STILL_MISSING (
        echo.
        echo ============================================================
        echo  Setup concluido. Esta janela pode nao enxergar o Python/Node
        echo  recem-instalados ^(PATH antigo^). FECHE esta janela e rode o
        echo  start-MainFrame.bat de novo pra abrir o app.
        echo ============================================================
        pause
        exit /b 0
    )
)

REM ---- Tudo pronto: sobe os servidores e abre o navegador ----
REM `;` precisa ser escapado com `^` pro Windows Terminal enxergar
REM como separador de comandos dele (e nao do cmd).
start "" wt -w 0 ^
  new-tab --title "MAINFRAME API" -d "%PROJECT_DIR%apps\api" cmd /k "python -m uvicorn main:app --reload --port 8001" ^; ^
  new-tab --title "MAINFRAME Web" -d "%PROJECT_DIR%apps\web" cmd /k "npm run dev"

REM Espera ~6s pros 2 servidores ficarem aceitando conexao.
REM Aumente se sua maquina demora mais; reduza se demora menos.
timeout /t 6 /nobreak >nul

REM Abre o Chrome na URL do app. Se o Chrome nao for o navegador
REM padrao, descomente a linha com o caminho absoluto abaixo.
start chrome http://localhost:5174/
REM start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5174/

endlocal
