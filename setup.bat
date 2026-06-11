@echo off
REM ============================================================
REM MAINFRAME — setup automatico
REM ============================================================
REM Instala Python, Node.js e Git via winget (se ainda nao
REM tiverem) e roda os installs de dependencias do backend
REM (pip) e frontend (npm). Por fim cria atalho no Desktop.
REM
REM Requisito: Windows 11 (winget vem por padrao).
REM Tambem funciona no Windows 10 1709+ se o winget estiver instalado.
REM
REM Se algum comando falhar com "nao reconhecido" apos a
REM instalacao, FECHE este terminal e abra outro — o Windows
REM precisa de uma sessao nova pra ver os PATHs novos.
REM ============================================================

setlocal
set "PROJECT_DIR=%~dp0"
echo.
echo === MAINFRAME setup ===
echo Pasta: %PROJECT_DIR%
echo.

REM ---- Verifica winget ----
where winget >nul 2>nul
if errorlevel 1 (
    echo [ERRO] `winget` nao foi encontrado. Voce precisa do Windows 10
    echo        versao 1709+ ou Windows 11. Instale o "App Installer"
    echo        pela Microsoft Store e rode este script de novo.
    pause
    exit /b 1
)

REM ---- Python 3.12 ----
where python >nul 2>nul
if errorlevel 1 (
    echo [1/5] Instalando Python 3.12 via winget...
    winget install --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar Python. Tente manualmente: https://www.python.org/downloads/
        pause
        exit /b 1
    )
) else (
    echo [1/5] Python ja instalado: ok
)

REM ---- Node.js LTS ----
where node >nul 2>nul
if errorlevel 1 (
    echo [2/5] Instalando Node.js LTS via winget...
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar Node.js. Tente manualmente: https://nodejs.org/
        pause
        exit /b 1
    )
) else (
    echo [2/5] Node.js ja instalado: ok
)

REM ---- Git ----
where git >nul 2>nul
if errorlevel 1 (
    echo [3/5] Instalando Git via winget...
    winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo [AVISO] Falha ao instalar Git. Continuando — clonagem do repo deve ter
        echo         sido feita antes deste script. Se precisar, instale manualmente.
    )
) else (
    echo [3/5] Git ja instalado: ok
)

echo.
echo === Instalando dependencias Python (backend) ===
cd /d "%PROJECT_DIR%apps\api"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERRO] Falha no pip install. Verifique se o Python esta no PATH.
    echo        Se acabou de instalar, FECHE este terminal e abra outro.
    pause
    exit /b 1
)

echo.
echo === Instalando dependencias Node (frontend) ===
cd /d "%PROJECT_DIR%apps\web"
call npm install
if errorlevel 1 (
    echo [ERRO] Falha no npm install. Verifique se o Node esta no PATH.
    echo        Se acabou de instalar, FECHE este terminal e abra outro.
    pause
    exit /b 1
)

echo.
echo === Criando atalho no Desktop ===
cd /d "%PROJECT_DIR%"
powershell -ExecutionPolicy Bypass -File "%PROJECT_DIR%tools\create-shortcut.ps1"

echo.
echo ============================================================
echo  Setup concluido com sucesso.
echo.
echo  Pra iniciar o MAINFRAME:
echo    - Duplo clique em "MAINFRAME" no Desktop, OU
echo    - Duplo clique em start-MainFrame.bat aqui na raiz
echo.
echo  O app vai abrir em http://localhost:5174/
echo ============================================================
endlocal
pause
