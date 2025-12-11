#!/bin/bash

# Claude Bot Platform - Process Monitor
# Monitors Claude CLI and MCP server processes in real-time

while true; do
  clear
  echo "╔═══════════════════════════════════════════════════════╗"
  echo "║  🔍 Claude Bot Platform - Process Monitor            ║"
  echo "║  Press Ctrl+C to exit                                 ║"
  echo "╚═══════════════════════════════════════════════════════╝"
  echo ""

  # Bot server status
  BOT_SERVER=$(ps aux | grep "node server.js" | grep -v grep | wc -l | tr -d ' ')
  if [ "$BOT_SERVER" -eq 1 ]; then
    BOT_PID=$(ps aux | grep "node server.js" | grep -v grep | awk '{print $2}')
    echo "🤖 Bot Server: ✅ Running (PID: $BOT_PID)"
  else
    echo "🤖 Bot Server: ❌ Not running"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Count processes
  CLAUDE_COUNT=$(ps aux | grep "claude --ide" | grep -v grep | wc -l | tr -d ' ')
  IMAGE_MCP_COUNT=$(ps aux | grep "image-gen-mcp/index.js" | grep -v grep | wc -l | tr -d ' ')
  TTS_MCP_COUNT=$(ps aux | grep "TTS-mcp/index.js" | grep -v grep | wc -l | tr -d ' ')
  CONTEXT_MCP_COUNT=$(ps aux | grep "chat-context-mcp.*index.js" | grep -v grep | wc -l | tr -d ' ')
  PLAYWRIGHT_MCP_COUNT=$(ps aux | grep "playwright-mcp" | grep -v grep | wc -l | tr -d ' ')

  TOTAL_MCP=$((IMAGE_MCP_COUNT + TTS_MCP_COUNT + CONTEXT_MCP_COUNT + PLAYWRIGHT_MCP_COUNT))

  echo "📊 Active Processes:"
  echo "   Claude CLI (--ide):     $CLAUDE_COUNT"
  echo "   Image-Gen MCP:          $IMAGE_MCP_COUNT"
  echo "   TTS MCP:                $TTS_MCP_COUNT"
  echo "   Chat-Context MCP:       $CONTEXT_MCP_COUNT"
  echo "   Playwright MCP:         $PLAYWRIGHT_MCP_COUNT"
  echo "   ─────────────────────────────"
  echo "   Total MCP Servers:      $TOTAL_MCP"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Show Claude processes with CPU usage
  if [ "$CLAUDE_COUNT" -gt 0 ]; then
    echo "🔧 Claude Processes:"
    ps aux | grep "claude --ide" | grep -v grep | awk '{printf "   PID %-6s CPU %-5s MEM %-5s TIME %-8s\n", $2, $3"%", $4"%", $10}'
    echo ""
  fi

  # Show MCP processes grouped by type
  if [ "$TOTAL_MCP" -gt 0 ]; then
    echo "🔌 MCP Server Processes:"

    if [ "$IMAGE_MCP_COUNT" -gt 0 ]; then
      echo "   📸 Image-Gen:"
      ps aux | grep "image-gen-mcp/index.js" | grep -v grep | awk '{printf "      PID %-6s PPID %-6s MEM %-5s\n", $2, $3, $4"%"}'
    fi

    if [ "$TTS_MCP_COUNT" -gt 0 ]; then
      echo "   🔊 TTS:"
      ps aux | grep "TTS-mcp/index.js" | grep -v grep | awk '{printf "      PID %-6s PPID %-6s MEM %-5s\n", $2, $3, $4"%"}'
    fi

    if [ "$CONTEXT_MCP_COUNT" -gt 0 ]; then
      echo "   💬 Chat-Context:"
      ps aux | grep "chat-context-mcp.*index.js" | grep -v grep | awk '{printf "      PID %-6s PPID %-6s MEM %-5s\n", $2, $3, $4"%"}'
    fi

    if [ "$PLAYWRIGHT_MCP_COUNT" -gt 0 ]; then
      echo "   🎭 Playwright:"
      ps aux | grep "playwright-mcp" | grep -v grep | awk '{printf "      PID %-6s PPID %-6s MEM %-5s\n", $2, $3, $4"%"}'
    fi

    echo ""
  fi

  # Warning if too many processes
  if [ "$TOTAL_MCP" -gt 10 ]; then
    echo "⚠️  WARNING: High number of MCP processes detected!"
    echo "   This may indicate zombie processes accumulating."
    echo "   Consider running ./restart.sh to clean up."
    echo ""
  fi

  # Show timestamp
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Last updated: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Refreshing in 2 seconds..."

  sleep 2
done
