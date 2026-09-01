@echo off
cd /d "%~dp0.."
set CHECKPOINT_EVERY=10
set CITY_TIMEOUT_MS=180000
set LIMIT=
echo [%DATE% %TIME%] starting scrape-wellhub-brasil >> data\raw\wellhub-scrape.out.log
call npx --yes tsx scripts/scrape-wellhub-brasil.ts >> data\raw\wellhub-scrape.out.log 2>> data\raw\wellhub-scrape.err.log
echo [%DATE% %TIME%] exit=%ERRORLEVEL% >> data\raw\wellhub-scrape.out.log
