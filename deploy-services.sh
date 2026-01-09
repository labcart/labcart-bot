#!/bin/bash

# Deploy HTTP Services Script (Machine-Agnostic)
#
# Works on ANY machine with the labcart installation:
# - Pulls latest code from git
# - Restarts PM2 services
#
# Usage:
#   ./deploy-services.sh          # Deploy all services
#   ./deploy-services.sh tts      # Deploy only TTS service
#   ./deploy-services.sh image    # Deploy only Image Gen service
#   ./deploy-services.sh chat     # Deploy only Chat Context service
#   ./deploy-services.sh live     # Deploy only Live Data service
#   ./deploy-services.sh router   # Deploy only MCP Router
#   ./deploy-services.sh --status # Just show PM2 status
#   ./deploy-services.sh --local  # Sync from local dev repo (dev machine only)

set -e

# Find the installed services directory (works on any machine)
INSTALLED_DIR="$HOME/.labcart/labcart-bot"
SERVICES_DIR="$INSTALLED_DIR/services"
MCP_ROUTER_DIR="$INSTALLED_DIR/mcp-router"

# Fallback to claude-bot if labcart-bot doesn't exist (legacy support)
if [ ! -d "$INSTALLED_DIR" ]; then
  INSTALLED_DIR="$HOME/.labcart/claude-bot"
  SERVICES_DIR="$INSTALLED_DIR/services"
  MCP_ROUTER_DIR="$INSTALLED_DIR/mcp-router"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  HTTP Services Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if installed directory exists
if [ ! -d "$INSTALLED_DIR" ]; then
  echo -e "${RED}Error: Installed directory not found at $INSTALLED_DIR${NC}"
  echo "Make sure labcart is installed (run the install script first)"
  exit 1
fi

# Handle --status flag
if [ "$1" = "--status" ]; then
  echo -e "${YELLOW}PM2 Service Status:${NC}"
  pm2 list | grep -E "(tts-service|image-service|chat-service|live-data-service|mcp-router|Name)" || echo "No services running"
  exit 0
fi

# Handle --local flag (dev machine only - sync from local dev repo)
LOCAL_MODE=false
DEV_DIR=""
DEV_SERVICES=""
DEV_MCP_ROUTER=""

if [ "$1" = "--local" ]; then
  LOCAL_MODE=true
  shift  # Remove --local from args

  # Try to find dev repo (check labcart-bot first, then claude-bot)
  for path in "$HOME/play/lab/labcart-bot" "/Users/macbook/play/lab/labcart-bot" "$HOME/play/lab/claude-bot" "/Users/macbook/play/lab/claude-bot"; do
    if [ -d "$path/services" ]; then
      DEV_DIR="$path"
      DEV_SERVICES="$path/services"
      DEV_MCP_ROUTER="$path/mcp-router"
      break
    fi
  done

  if [ -z "$DEV_SERVICES" ]; then
    echo -e "${RED}Error: Dev repo not found. --local only works on dev machine.${NC}"
    exit 1
  fi

  echo -e "${YELLOW}Local mode: syncing from $DEV_DIR${NC}"
  echo ""
fi

# Function to deploy a single service
deploy_service() {
  local key=$1
  local folder=$2
  local pm2_name=$3

  local dst="$SERVICES_DIR/$folder"

  echo -e "${YELLOW}Deploying $folder...${NC}"

  if [ "$LOCAL_MODE" = true ]; then
    # Local mode: rsync from dev repo
    local src="$DEV_SERVICES/$folder"

    if [ ! -d "$src" ]; then
      echo -e "${RED}  Error: Source not found: $src${NC}"
      return 1
    fi

    # Create destination if it doesn't exist
    mkdir -p "$dst"

    rsync -av --delete \
      --exclude 'node_modules' \
      --exclude '.env' \
      --exclude 'logs' \
      --exclude '*.log' \
      --exclude 'audio-output' \
      --exclude 'image-output' \
      "$src/" "$dst/"
    echo -e "${GREEN}  Files synced from dev repo${NC}"

    # Run npm install if package.json exists
    if [ -f "$dst/package.json" ]; then
      echo -e "${YELLOW}  Running npm install...${NC}"
      cd "$dst" && npm install --production 2>/dev/null || npm install
      echo -e "${GREEN}  Dependencies installed${NC}"
    fi
  else
    # Production mode: git pull
    if [ ! -d "$dst" ]; then
      echo -e "${RED}  Error: Service not found: $dst${NC}"
      return 1
    fi
    cd "$dst"
    git pull origin main 2>/dev/null || git pull 2>/dev/null || echo -e "${YELLOW}  (git pull skipped - not a git repo or no remote)${NC}"
    echo -e "${GREEN}  Git pull complete${NC}"
  fi

  # Stop existing PM2 process if running
  if pm2 describe "$pm2_name" > /dev/null 2>&1; then
    echo -e "${YELLOW}  Stopping $pm2_name...${NC}"
    pm2 delete "$pm2_name" > /dev/null 2>&1
  fi

  # Start service with correct cwd
  echo -e "${YELLOW}  Starting $pm2_name...${NC}"
  pm2 start "$dst/index.js" --name "$pm2_name" --cwd "$dst"
  echo -e "${GREEN}  $pm2_name started${NC}"

  echo ""
}

# Function to deploy MCP router (special case - not in services dir)
deploy_mcp_router() {
  local dst="$MCP_ROUTER_DIR"

  echo -e "${YELLOW}Deploying mcp-router...${NC}"

  if [ "$LOCAL_MODE" = true ]; then
    local src="$DEV_MCP_ROUTER"

    if [ ! -d "$src" ]; then
      echo -e "${RED}  Error: Source not found: $src${NC}"
      return 1
    fi

    # Create destination if it doesn't exist
    mkdir -p "$dst"

    rsync -av --delete \
      --exclude 'node_modules' \
      --exclude '.env' \
      --exclude 'logs' \
      --exclude '*.log' \
      "$src/" "$dst/"
    echo -e "${GREEN}  Files synced from dev repo${NC}"

    # Run npm install if package.json exists
    if [ -f "$dst/package.json" ]; then
      echo -e "${YELLOW}  Running npm install...${NC}"
      cd "$dst" && npm install --production 2>/dev/null || npm install
      echo -e "${GREEN}  Dependencies installed${NC}"
    fi
  else
    if [ ! -d "$dst" ]; then
      echo -e "${RED}  Error: MCP Router not found: $dst${NC}"
      return 1
    fi
    cd "$dst"
    git pull origin main 2>/dev/null || git pull 2>/dev/null || echo -e "${YELLOW}  (git pull skipped - not a git repo or no remote)${NC}"
    echo -e "${GREEN}  Git pull complete${NC}"
  fi

  # Stop existing PM2 process if running
  if pm2 describe "mcp-router" > /dev/null 2>&1; then
    echo -e "${YELLOW}  Stopping mcp-router...${NC}"
    pm2 delete "mcp-router" > /dev/null 2>&1
  fi

  # Start MCP router with correct cwd
  echo -e "${YELLOW}  Starting mcp-router...${NC}"
  pm2 start "$dst/index.js" --name "mcp-router" --cwd "$dst"
  echo -e "${GREEN}  mcp-router started${NC}"

  echo ""
}

# Function to pull entire repo (for production deployments)
pull_repo() {
  echo -e "${YELLOW}Pulling latest code from git...${NC}"
  cd "$INSTALLED_DIR"
  git pull origin main 2>/dev/null || git pull 2>/dev/null || true
  echo -e "${GREEN}  Repository updated${NC}"
  echo ""
}

# If not local mode, pull the entire repo first
if [ "$LOCAL_MODE" = false ]; then
  pull_repo
fi

# Determine which services to deploy
case "$1" in
  ""|"all")
    echo -e "${BLUE}Deploying ALL services...${NC}"
    echo ""
    deploy_service "tts" "tts-http-service" "tts-service"
    deploy_service "image" "image-gen-http-service" "image-service"
    deploy_service "chat" "chat-context-http-service" "chat-service"
    deploy_service "live" "live-data-http-service" "live-data-service"
    deploy_mcp_router
    ;;
  "tts")
    deploy_service "tts" "tts-http-service" "tts-service"
    ;;
  "image")
    deploy_service "image" "image-gen-http-service" "image-service"
    ;;
  "chat")
    deploy_service "chat" "chat-context-http-service" "chat-service"
    ;;
  "live")
    deploy_service "live" "live-data-http-service" "live-data-service"
    ;;
  "router")
    deploy_mcp_router
    ;;
  *)
    echo -e "${RED}Unknown service: $1${NC}"
    echo ""
    echo "Available services:"
    echo "  tts    - TTS HTTP Service (port 3001)"
    echo "  image  - Image Gen HTTP Service (port 3002)"
    echo "  chat   - Chat Context HTTP Service (port 3003)"
    echo "  live   - Live Data HTTP Service (port 3004)"
    echo "  router - MCP Router"
    echo "  all    - All services (default)"
    echo ""
    echo "Options:"
    echo "  --status  Show PM2 status"
    echo "  --local   Sync from local dev repo (dev machine only)"
    exit 1
    ;;
esac

# Save PM2 state
pm2 save --force > /dev/null 2>&1

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Service Status:${NC}"
pm2 list | grep -E "(tts-service|image-service|chat-service|live-data-service|mcp-router|Name)" || true
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  pm2 logs tts-service --lines 20"
echo "  pm2 logs image-service --lines 20"
echo "  pm2 logs chat-service --lines 20"
echo "  pm2 logs live-data-service --lines 20"
echo "  pm2 logs mcp-router --lines 20"
