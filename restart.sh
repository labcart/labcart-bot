#!/bin/bash

# Claude Bot Platform - Restart Script
# Cleanly stops all bot processes and restarts the server

echo "🛑 Stopping all bot servers..."

# Step 1: Get all PIDs first (before killing anything)
NODE_PIDS=$(ps aux | grep "node server.js" | grep -v grep | awk '{print $2}')
NPM_PIDS=$(ps aux | grep "npm.*start" | grep -v grep | awk '{print $2}')

# Step 2: Kill them all (graceful first)
for pid in $NODE_PIDS; do
  echo "Killing node server.js (PID: $pid)"
  kill $pid 2>/dev/null
done

for pid in $NPM_PIDS; do
  echo "Killing npm start (PID: $pid)"
  kill $pid 2>/dev/null
done

# Wait for graceful shutdown
sleep 2

# Step 3: Force kill anything that survived
REMAINING_NODE=$(ps aux | grep "node server.js" | grep -v grep | awk '{print $2}')
REMAINING_NPM=$(ps aux | grep "npm.*start" | grep -v grep | awk '{print $2}')

if [ -n "$REMAINING_NODE" ] || [ -n "$REMAINING_NPM" ]; then
  echo "⚠️  Some processes still running, force killing..."

  for pid in $REMAINING_NODE; do
    echo "Force killing node (PID: $pid)"
    kill -9 $pid 2>/dev/null
  done

  for pid in $REMAINING_NPM; do
    echo "Force killing npm (PID: $pid)"
    kill -9 $pid 2>/dev/null
  done

  sleep 1
fi

# Step 4: Clean up MCP server processes
echo "🧹 Cleaning up MCP servers..."
MCP_KILLED=0

# Kill image-gen MCP servers
if pkill -f "image-gen-mcp/index.js" 2>/dev/null; then
  MCP_COUNT=$(pgrep -f "image-gen-mcp/index.js" 2>/dev/null | wc -l)
  echo "   Killed image-gen-mcp servers"
  MCP_KILLED=$((MCP_KILLED + MCP_COUNT))
fi

# Kill TTS MCP servers
if pkill -f "TTS-mcp/index.js" 2>/dev/null; then
  MCP_COUNT=$(pgrep -f "TTS-mcp/index.js" 2>/dev/null | wc -l)
  echo "   Killed TTS-mcp servers"
  MCP_KILLED=$((MCP_KILLED + MCP_COUNT))
fi

# Kill chat-context MCP servers
if pkill -f "chat-context-mcp.*index.js" 2>/dev/null; then
  MCP_COUNT=$(pgrep -f "chat-context-mcp.*index.js" 2>/dev/null | wc -l)
  echo "   Killed chat-context-mcp servers"
  MCP_KILLED=$((MCP_KILLED + MCP_COUNT))
fi

# Kill any other MCP servers (playwright, notebooklm, etc)
if pkill -f "playwright-mcp-server" 2>/dev/null; then
  echo "   Killed playwright-mcp servers"
fi

if pkill -f "notebooklm-mcp.*index.js" 2>/dev/null; then
  echo "   Killed notebooklm-mcp servers"
fi

if [ $MCP_KILLED -gt 0 ]; then
  echo "✅ Cleaned up MCP servers"
  sleep 1
else
  echo "   No MCP servers to clean up"
fi

# Step 5: Restart HTTP Services
echo "🔄 Restarting HTTP Services..."

# Get base directory for HTTP services
# Get the parent directory of claude-bot (where all services live)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

echo "   Base directory: $BASE_DIR"

# TTS HTTP Service (port 3001)
TTS_HTTP_PID=$(lsof -ti :3001 2>/dev/null)
if [ -n "$TTS_HTTP_PID" ]; then
  echo "   Killing old TTS HTTP service (PID: $TTS_HTTP_PID)"
  kill -9 $TTS_HTTP_PID 2>/dev/null
  sleep 1
fi

if [ -d "$BASE_DIR/tts-http-service" ]; then
  cd "$BASE_DIR/tts-http-service"
  node index.js > /tmp/tts-http.log 2>&1 &
  TTS_PID=$!
  echo "✅ TTS HTTP Service started (PID: $TTS_PID, port 3001)"
else
  echo "⚠️  tts-http-service not found at $BASE_DIR/tts-http-service"
fi

# Image Gen HTTP Service (port 3002)
IMAGE_HTTP_PID=$(lsof -ti :3002 2>/dev/null)
if [ -n "$IMAGE_HTTP_PID" ]; then
  echo "   Killing old Image Gen HTTP service (PID: $IMAGE_HTTP_PID)"
  kill -9 $IMAGE_HTTP_PID 2>/dev/null
  sleep 1
fi

if [ -d "$BASE_DIR/image-gen-http-service" ]; then
  cd "$BASE_DIR/image-gen-http-service"
  node index.js > /tmp/image-http.log 2>&1 &
  IMAGE_PID=$!
  echo "✅ Image Gen HTTP Service started (PID: $IMAGE_PID, port 3002)"
else
  echo "⚠️  image-gen-http-service not found at $BASE_DIR/image-gen-http-service"
fi

# Chat Context HTTP Service (port 3003)
CHAT_HTTP_PID=$(lsof -ti :3003 2>/dev/null)
if [ -n "$CHAT_HTTP_PID" ]; then
  echo "   Killing old Chat Context HTTP service (PID: $CHAT_HTTP_PID)"
  kill -9 $CHAT_HTTP_PID 2>/dev/null
  sleep 1
fi

if [ -d "$BASE_DIR/chat-context-http-service" ]; then
  cd "$BASE_DIR/chat-context-http-service"
  node index.js > /tmp/chat-context-http.log 2>&1 &
  CHAT_PID=$!
  echo "✅ Chat Context HTTP Service started (PID: $CHAT_PID, port 3003)"
else
  echo "⚠️  chat-context-http-service not found at $BASE_DIR/chat-context-http-service"
fi

# Return to bot directory
cd "$SCRIPT_DIR"

echo "🚀 Starting bot server..."

# Create logs directory if it doesn't exist
mkdir -p logs

# Start server directly (not via npm to avoid wrapper process)
node server.js >> logs/server.log 2>&1 &
SERVER_PID=$!

# Wait for startup
sleep 3

# Verify it started
if ps -p $SERVER_PID > /dev/null 2>&1; then
  echo "✅ Bot server restarted successfully!"
  echo "📊 Process: $SERVER_PID"
  echo ""
  echo "📋 To view logs:"
  echo "   tail -f logs/combined.log    # Bot activity logs"
  echo "   tail -f logs/server.log      # Server startup logs"
else
  echo "❌ Failed to start - process died"
  echo "📋 Check logs/server.log for errors"
  exit 1
fi
