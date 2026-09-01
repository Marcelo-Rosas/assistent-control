@echo off
cd /d "%~dp0.."
set DELAY_MS=500
set CHECKPOINT_EVERY=25
set LIMIT=
echo [%DATE% %TIME%] starting enrich-totalpass-details >> data\raw\totalpass-enrich.out.log
call npx --yes tsx scripts/enrich-totalpass-details.ts >> data\raw\totalpass-enrich.out.log 2>> data\raw\totalpass-enrich.err.log
echo [%DATE% %TIME%] exit=%ERRORLEVEL% >> data\raw\totalpass-enrich.out.log
