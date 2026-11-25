#!/bin/bash
# 교무실 전광판 — 동기화 서버 실행 (macOS: 더블클릭)
cd "$(dirname "$0")" || exit 1

echo ""
echo "  교무실 전광판을 시작합니다..."
echo ""

if command -v python3 >/dev/null 2>&1; then
  python3 server.py
elif command -v python >/dev/null 2>&1; then
  python server.py
else
  echo "  ⚠  파이썬(python3)을 찾을 수 없습니다."
  echo ""
  echo "     macOS: 터미널에서  xcode-select --install  을 실행한 뒤 다시 시도해 주세요."
  echo "     또는 https://www.python.org/downloads/ 에서 설치할 수 있습니다."
  echo ""
  echo "  파이썬이 없어도 index.html 을 더블클릭하면 전광판은 켜집니다."
  echo "  (다만 그 경우에는 이 컴퓨터에만 저장됩니다.)"
  echo ""
  read -r -p "  엔터를 누르면 닫힙니다..." _
  exit 1
fi

echo ""
read -r -p "  서버가 꺼졌습니다. 엔터를 누르면 창을 닫습니다..." _
