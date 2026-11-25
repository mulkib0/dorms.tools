@echo off
chcp 65001 >nul
title 교무실 전광판
cd /d "%~dp0"

echo.
echo   교무실 전광판을 시작합니다...
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto done
)

where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto done
)

echo   [경고] 파이썬(python)을 찾을 수 없습니다.
echo.
echo   https://www.python.org/downloads/ 에서 설치할 때
echo   "Add python.exe to PATH" 를 꼭 체크해 주세요.
echo.
echo   파이썬이 없어도 index.html 을 더블클릭하면 전광판은 켜집니다.
echo   (다만 그 경우에는 이 컴퓨터에만 저장됩니다.)
echo.

:done
echo.
pause
