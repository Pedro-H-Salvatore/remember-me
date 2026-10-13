@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 24 ou superior para iniciar a Remember me.
  pause
  exit /b 1
)
echo Abra http://localhost:3000 no navegador.
echo Mantenha esta janela aberta enquanto usar a aplicacao.
node --env-file-if-exists=.env src/server.js
pause
