# VPS Deployment Guide for Claude Bot Platform

**Created:** October 30, 2025

## Overview

This guide covers deploying the Claude Bot Platform to a VPS with all MCP servers, including setup, pricing comparison, and step-by-step instructions.

---

## Why VPS instead of Docker?

**Docker is NOT recommended for this setup because:**

1. **Claude CLI requires interactive browser authentication** - Would need VNC/desktop in Docker just to run `claude login`
2. **Playwright MCP needs full browser** - Adds 500MB+ to image and complexity
3. **Your use case doesn't benefit from Docker** - You're running a single instance, not scaling

**VPS with direct install is simpler, cheaper, and easier to maintain.**

---

## System Requirements

Based on current resource usage:

- **RAM**: 4GB (currently using ~2GB, need headroom for VS Code/Cursor)
- **Storage**: 20GB minimum (code ~500MB + node_modules + audio output + OS + browser)
- **CPU**: 2-3 cores (Claude CLI + Node.js + MCP servers + occasional browser)

---

## VPS Provider Comparison

### 🏆 **Hetzner (RECOMMENDED)**

**CPX21 - $9.10/month** ⭐
- 3 vCPU, 4GB RAM, 80GB SSD
- Location: Germany (fast globally)
- Best value for your needs

**CPX31 - $16.30/month**
- 4 vCPU, 8GB RAM, 160GB SSD
- Future-proof option if you want extra headroom

### **DigitalOcean**

**Basic Droplet 4GB - $24/month**
- 2 vCPU, 4GB RAM, 80GB SSD
- More expensive than Hetzner for same specs

### **AWS Lightsail**

**$24/month**
- 2 vCPU, 4GB RAM, 80GB SSD
- Same price as DigitalOcean, worse than Hetzner

### **Contabo (Ultra Budget)**

**VPS S - $4.90/month**
- 4 vCPU, 6GB RAM, 100GB SSD
- Amazing specs for price
- ⚠️ Mixed reviews on support quality
- Worth trying if you want cheapest option

---

## Deployment Steps

### **Step 1: Backup and Transfer (2 minutes)**

On your local Mac:

```bash
# Navigate to projects directory
cd ~/play

# Create compressed backup of all projects
tar -czf claude-bot-backup.tar.gz \
  claude-bot/ \
  TTS-mcp/ \
  image-gen-mcp/ \
  chat-context-mcp/ \
  claude-cli-mcp/ \
  notebooklm-mcp/

# Transfer to VPS (replace with your VPS IP)
scp claude-bot-backup.tar.gz root@YOUR_VPS_IP:/root/
```

---

### **Step 2: VPS Setup (10 minutes)**

SSH into your VPS:

```bash
ssh root@YOUR_VPS_IP
```

#### Install Node.js

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify installation
node --version
npm --version
```

#### Install Claude CLI

```bash
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version
```

#### Extract Projects

```bash
# Extract backup
cd ~
tar -xzf claude-bot-backup.tar.gz

# Create play directory
mkdir -p ~/play

# Move projects
mv claude-bot TTS-mcp image-gen-mcp chat-context-mcp claude-cli-mcp notebooklm-mcp ~/play/
```

#### Install Dependencies

```bash
# Main bot
cd ~/play/claude-bot
npm install

# TTS MCP
cd ~/play/TTS-mcp
npm install

# Image Gen MCP
cd ~/play/image-gen-mcp
npm install

# Chat Context MCP
cd ~/play/chat-context-mcp
npm install

# Other MCP servers as needed
cd ~/play/claude-cli-mcp
npm install
```

#### Configure Environment Variables

Create `.env` files for each project with your API keys:

```bash
# Bot platform
nano ~/play/claude-bot/.env
```

Add:
```
TELEGRAM_TOKEN_SMARTERBUD=your_token_here
TELEGRAM_TOKEN_MATTYATLAS=your_token_here
TELEGRAM_TOKEN_PENSELLER=your_token_here
TELEGRAM_TOKEN_PRIEST=your_token_here
TELEGRAM_TOKEN_RICKD=your_token_here
CLAUDE_CMD=claude
```

```bash
# TTS MCP
nano ~/play/TTS-mcp/.env
```

Add:
```
OPENAI_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
GOOGLE_APPLICATION_CREDENTIALS=/path/to/google-credentials.json
```

```bash
# Image Gen MCP
nano ~/play/image-gen-mcp/.env
```

Add:
```
OPENAI_API_KEY=your_key_here
```

#### Login to Claude CLI

```bash
claude login
```

This will open a browser for authentication. If you're using SSH without a desktop environment, you have two options:

1. **Install desktop + VNC** (for GUI access)
2. **Use SSH port forwarding** to authenticate via your local browser

For SSH port forwarding:
```bash
# On your local Mac, reconnect with port forwarding
ssh -L 8080:localhost:8080 root@YOUR_VPS_IP

# Then run claude login on VPS
# It will give you a URL to open locally
```

#### Configure MCP Servers

Claude CLI needs to know where your MCP servers are. Check/create the MCP config:

```bash
# Find Claude config directory
claude --print-mcp-config

# If it doesn't exist, you may need to configure it manually
# This should happen automatically when you first use MCP tools
```

---

### **Step 3: Start the Bot (2 minutes)**

#### Test Run

```bash
cd ~/play/claude-bot
npm start
```

Check logs to ensure everything works. Press `Ctrl+C` to stop.

#### Make it Persistent with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start bot with PM2
cd ~/play/claude-bot
pm2 start server.js --name claude-bot

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command it outputs (usually something like: sudo env PATH=...)

# View logs
pm2 logs claude-bot

# Monitor status
pm2 status
```

---

## Common PM2 Commands

```bash
# Restart bot
pm2 restart claude-bot

# Stop bot
pm2 stop claude-bot

# View logs
pm2 logs claude-bot

# View real-time logs
pm2 logs claude-bot --lines 100

# Check status
pm2 status

# Delete from PM2
pm2 delete claude-bot
```

---

## Optional: Install Desktop Environment + VS Code

If you want a full desktop experience via VNC:

### Install Desktop

```bash
# Install Ubuntu Desktop (lightweight option: XFCE)
apt update
apt install -y xfce4 xfce4-goodies

# Install VNC server
apt install -y tigervnc-standalone-server

# Start VNC server
vncserver

# Set VNC password when prompted
```

### Or Use VS Code Remote SSH (RECOMMENDED)

This is way easier than VNC:

1. Install **Remote - SSH** extension in VS Code on your Mac
2. Connect to your VPS: `ssh root@YOUR_VPS_IP`
3. Open folder: `~/play/claude-bot`
4. Edit files directly on the server

---

## Troubleshooting

### Bot won't start

```bash
# Check logs
pm2 logs claude-bot

# Check if MCP servers are configured
claude --print-mcp-config

# Manually test bot
cd ~/play/claude-bot
node server.js
```

### MCP servers not working

```bash
# Check if MCP servers have dependencies installed
cd ~/play/TTS-mcp && npm install
cd ~/play/image-gen-mcp && npm install

# Check .env files exist and have correct keys
ls -la ~/play/TTS-mcp/.env
ls -la ~/play/image-gen-mcp/.env
```

### Playwright issues

```bash
# Install browser dependencies
apt install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2
```

### Out of memory

```bash
# Check memory usage
free -h

# Consider upgrading to larger VPS (8GB RAM)
```

---

## Important Files to Backup

If you make changes on the VPS, remember to backup:

- `.env` files (all projects)
- `brains/*.js` (bot personalities)
- `bots.json` (bot configurations)
- `.sessions/` directory (conversation history)
- `telegram-session.json` (if using test tools)

---

## Estimated Costs

| Provider | Plan | Price/month | RAM | CPU | Storage |
|----------|------|-------------|-----|-----|---------|
| **Hetzner** | CPX21 | **$9.10** | 4GB | 3 vCPU | 80GB |
| **Contabo** | VPS S | **$4.90** | 6GB | 4 vCPU | 100GB |
| DigitalOcean | Basic 4GB | $24.00 | 4GB | 2 vCPU | 80GB |
| AWS Lightsail | - | $24.00 | 4GB | 2 vCPU | 80GB |

**Recommended: Hetzner CPX21 at $9.10/month**

---

## Summary

**Total deployment time: ~15 minutes**

1. ✅ Tar + scp your code (2 min)
2. ✅ Install Node.js + Claude CLI (3 min)
3. ✅ npm install all projects (5 min)
4. ✅ Configure .env files (2 min)
5. ✅ Login to Claude CLI (1 min)
6. ✅ Start bot with PM2 (2 min)

**It's literally just copy-paste and install. No complicated Docker setup needed.**
