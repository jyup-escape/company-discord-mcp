@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\share.ps1 start
echo 再起動するとURLが変わります。DiscordのOAuth2 Redirectsを更新して npm run employees を実行してください。
pause
