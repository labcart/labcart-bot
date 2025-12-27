#!/bin/bash

#
# Claude Bot Platform - Setup Script
#
# This script sets up symlinks and directories needed for the bot platform
# to work properly across different environments. Run this once after cloning
# the repo on a new machine.
#

set -e  # Exit on error

echo "🔧 Setting up Claude Bot Platform dependencies..."
echo ""

# Get the absolute path to the claude-bot directory
CLAUDE_BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📂 Claude Bot directory: $CLAUDE_BOT_DIR"

# Create audio-output directory if it doesn't exist
echo "📁 Creating audio-output directory..."
mkdir -p "$CLAUDE_BOT_DIR/audio-output"

# Create image-output directory if it doesn't exist
echo "📁 Creating image-output directory..."
mkdir -p "$CLAUDE_BOT_DIR/image-output"

# Create logs directory if it doesn't exist
echo "📁 Creating logs directory..."
mkdir -p "$CLAUDE_BOT_DIR/logs"

# Setup TTS-mcp symlink if TTS-mcp exists
TTS_MCP_DIR="$(dirname "$CLAUDE_BOT_DIR")/TTS-mcp"
if [ -d "$TTS_MCP_DIR" ]; then
    echo "🔗 Setting up TTS-mcp audio-output symlink..."

    # Remove old audio-output directory/symlink if it exists
    if [ -e "$TTS_MCP_DIR/audio-output" ]; then
        rm -rf "$TTS_MCP_DIR/audio-output"
    fi

    # Create symlink from TTS-mcp to claude-bot audio-output
    ln -s "$CLAUDE_BOT_DIR/audio-output" "$TTS_MCP_DIR/audio-output"
    echo "   ✅ TTS-mcp → claude-bot/audio-output"
else
    echo "   ⚠️  TTS-mcp directory not found at: $TTS_MCP_DIR"
    echo "      Skipping TTS symlink setup"
fi

# Setup image-gen-mcp symlink if it exists
IMAGE_GEN_MCP_DIR="$(dirname "$CLAUDE_BOT_DIR")/image-gen-mcp"
if [ -d "$IMAGE_GEN_MCP_DIR" ]; then
    echo "🔗 Setting up image-gen-mcp image-output symlink..."

    # Remove old image-output directory/symlink if it exists
    if [ -e "$IMAGE_GEN_MCP_DIR/image-output" ]; then
        rm -rf "$IMAGE_GEN_MCP_DIR/image-output"
    fi

    # Create symlink from image-gen-mcp to claude-bot image-output
    ln -s "$CLAUDE_BOT_DIR/image-output" "$IMAGE_GEN_MCP_DIR/image-output"
    echo "   ✅ image-gen-mcp → claude-bot/image-output"
else
    echo "   ⚠️  image-gen-mcp directory not found at: $IMAGE_GEN_MCP_DIR"
    echo "      Skipping image-gen symlink setup"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and configure your API keys"
echo "2. Copy bots.json.example to bots.json and configure your bots"
echo "3. Run: npm install"
echo "4. Run: node server.js"
echo ""
