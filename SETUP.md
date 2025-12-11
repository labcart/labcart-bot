# Claude Bot Platform - Setup Guide

## Quick Start (New Machine Setup)

When setting up this repo on a new machine, follow these steps:

### 1. Clone the Repositories

```bash
# Clone the main bot platform
git clone <your-repo-url> claude-bot

# Clone the MCP servers (if not using submodules)
git clone <tts-mcp-url> TTS-mcp
git clone <image-gen-mcp-url> image-gen-mcp
git clone <chat-context-mcp-url> chat-context-mcp
```

### 2. Run Setup Script

This creates all necessary directories and symlinks:

```bash
cd claude-bot
./setup-dependencies.sh
```

**What this does:**
- Creates `audio-output/`, `image-output/`, and `logs/` directories
- Creates symlinks from MCP servers to claude-bot output directories
- Ensures portable configuration across different machines

### 3. Install Dependencies

```bash
# In claude-bot directory
npm install

# In each MCP directory
cd ../TTS-mcp && npm install
cd ../image-gen-mcp && npm install
cd ../chat-context-mcp && npm install
```

### 4. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with your API keys and settings
nano .env
```

### 5. Configure Bots

```bash
# Copy bots configuration template
cp bots.json.example bots.json

# Edit with your bot tokens and brain configurations
nano bots.json
```

### 6. Start the Platform

```bash
# Option 1: Direct start
node server.js

# Option 2: With PM2 (production)
pm2 start server.js --name claude-bot

# Option 3: Development with auto-reload
npm run dev
```

## Architecture: How Symlinks Work

The platform uses symlinks to keep MCP servers independent while sharing output directories:

```
/opt/projects/
├── claude-bot/
│   ├── audio-output/          ← Real directory (shared storage)
│   ├── image-output/          ← Real directory (shared storage)
│   └── server.js
├── TTS-mcp/
│   ├── audio-output → ../claude-bot/audio-output  ← Symlink
│   └── index.js
└── image-gen-mcp/
    ├── image-output → ../claude-bot/image-output  ← Symlink
    └── index.js
```

**Benefits:**
- ✅ Portable across machines (no hardcoded paths)
- ✅ MCP servers remain independent repos
- ✅ Shared storage prevents duplication
- ✅ Works with git (symlinks in .gitignore)

## MCP Server Configuration

Each MCP server uses **relative paths** in their config.json:

**TTS-mcp/config.json:**
```json
{
  "output_dir": "./audio-output"  ← Resolves to symlink → claude-bot/audio-output
}
```

**image-gen-mcp/config.json:**
```json
{
  "output_dir": "./image-output"  ← Resolves to symlink → claude-bot/image-output
}
```

## Troubleshooting

### Audio files not being sent
```bash
# Check symlink exists
ls -la ../TTS-mcp/audio-output

# Should show: audio-output -> /path/to/claude-bot/audio-output

# If broken, re-run setup
./setup-dependencies.sh
```

### Images not being sent
```bash
# Check symlink exists
ls -la ../image-gen-mcp/image-output

# Re-run setup if needed
./setup-dependencies.sh
```

### Bot won't start
```bash
# Check logs
tail -f logs/combined.log

# Verify .env exists
ls -la .env

# Verify bots.json exists
ls -la bots.json
```

## Moving to a New Machine

1. Copy/clone the repos
2. Run `./setup-dependencies.sh`
3. Update `.env` with new API keys
4. Start the server

That's it! No path configuration needed.
