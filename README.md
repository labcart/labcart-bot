# Claude Bot Platform

A multi-bot Telegram platform powered by Claude Code CLI. Run multiple Telegram bots with different personalities from a single Node.js process.

## Features

- 🤖 **Multi-bot support** - Run unlimited bots from one server
- 🧠 **Brain files** - Define bot personalities with simple JavaScript configs
- 💬 **Session persistence** - Conversations saved automatically via Claude sessions
- 🎭 **MCP tools** - Bots have access to Claude's MCP tools (image gen, web search, etc)
- ⚡ **Streaming responses** - Real-time message updates
- 🎤 **Text-to-Speech** - Bots can respond with voice messages using OpenAI TTS
- 🔧 **Easy configuration** - JSON-based bot setup via .env

## Quick Start

### Prerequisites

- Node.js 14+ installed
- Claude Code IDE installed and running
- Active Claude subscription
- Telegram account

### Installation

```bash
# Clone or download this repo
cd claude-bot-platform

# Install dependencies
npm install

# Copy example env file
cp .env.example .env
```

### Setup

1. **Create a Telegram bot** via [@BotFather](https://t.me/botfather)
   - Send `/newbot`
   - Choose name and username
   - Copy the token

2. **Configure your first bot** in `.env`:
   ```bash
   BOTS=[{"id":"smarterchild","token":"YOUR_TOKEN_HERE","brain":"smarterchild"}]
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Message your bot** on Telegram!

## Configuration

### Environment Variables

Create a `.env` file with:

```bash
# Claude CLI command (default: claude)
CLAUDE_CMD=claude

# Bot configurations (JSON array)
BOTS=[
  {
    "id": "smarterchild",
    "token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "brain": "smarterchild",
    "active": true
  }
]

# Optional: Session cleanup
CLEANUP_OLD_SESSIONS=false
CLEANUP_INTERVAL_HOURS=24
CLEANUP_AGE_DAYS=90
```

### Adding More Bots

Just add more objects to the `BOTS` array:

```bash
BOTS=[
  {"id":"bot1","token":"TOKEN1","brain":"smarterchild"},
  {"id":"bot2","token":"TOKEN2","brain":"therapist"}
]
```

See [docs/ADDING-BOTS.md](docs/ADDING-BOTS.md) for detailed guide.

## Brain Files

Brain files define bot personalities. They're simple JavaScript modules:

```javascript
// brains/mybot.js
module.exports = {
  name: "MyBot",
  systemPrompt: `You are a helpful assistant...`,
  maxTokens: 200,
  temperature: 0.7
};
```

**Included brains:**
- `smarterchild.js` - Witty, nostalgic chatbot (inspired by 2001 AIM bot)
- `therapist.js` - Empathetic listener for emotional support
- `_template.js` - Template for creating new brains

**Create your own:**

```bash
cp brains/_template.js brains/mybot.js
# Edit brains/mybot.js
```

See [docs/BRAIN-FILES.md](docs/BRAIN-FILES.md) for comprehensive guide.

## Text-to-Speech (TTS)

Bots can respond with voice messages using OpenAI's Text-to-Speech. Enable it per-brain:

```javascript
// In your brain file
module.exports = {
  name: "VoiceBot",
  systemPrompt: "You are a friendly voice assistant...",

  tts: {
    enabled: true,           // Enable TTS for this bot
    voice: "nova",           // Voice: alloy, echo, fable, onyx, nova, shimmer
    speed: 1.0,              // Speed: 0.25 to 4.0 (1.0 = normal)
    sendTextToo: true        // Also send text version (accessibility)
  }
};
```

**Available voices:**
- `alloy` - Neutral and balanced
- `echo` - Male voice
- `fable` - Expressive and dramatic
- `onyx` - Deep male voice
- `nova` - Female voice (default)
- `shimmer` - Soft female voice

**Prerequisites:**
- TTS MCP server must be configured in Claude Code
- See the [MCP TTS documentation](https://github.com/modelcontextprotocol/servers/tree/main/src/tts) for setup

**How it works:**
1. Bot generates text response via Claude
2. If TTS is enabled, text is converted to audio using OpenAI TTS
3. Audio is sent as a voice message on Telegram
4. Optionally, text is also sent for accessibility

## Project Structure

```
claude-bot/
├── server.js              # Main entry point
├── package.json           # Dependencies
├── .env                   # Configuration (you create this)
│
├── brains/                # Bot personality files
│   ├── smarterchild.js   # Example: SmarterChild bot
│   ├── therapist.js      # Example: Therapy bot
│   └── _template.js      # Template for new brains
│
├── lib/                   # Core modules
│   ├── bot-manager.js    # Manages Telegram bots
│   ├── brain-loader.js   # Loads brain files
│   ├── session-manager.js # Claude session handling
│   ├── claude-client.js  # Claude CLI wrapper
│   └── tts-client.js     # Text-to-speech integration
│
└── docs/                  # Documentation
    ├── BRAIN-FILES.md    # Brain file guide
    └── ADDING-BOTS.md    # How to add bots
```

## How It Works

1. **User messages bot** on Telegram
2. **Bot Manager** routes message to correct bot
3. **Brain Loader** injects personality (system prompt)
4. **Session Manager** resumes user's Claude session
5. **Claude Client** sends to Claude Code CLI with `--ide` flag
6. **Response streams back** to Telegram in real-time

Each user gets their own Claude session file:
```
~/.claude/projects/bot-<botId>/user-<telegramId>.jsonl
```

This means:
- ✅ Conversations persist across restarts
- ✅ Full context maintained
- ✅ No database needed (for basic usage)

## Bot Commands

All bots support these commands:

- `/start` or `/help` - Show help message
- `/reset` - Start a new conversation (deletes session)
- `/stats` - Show conversation statistics

## Development

### Run with auto-reload

```bash
npm run dev
```

Changes to code will restart the server automatically.

### Testing a brain

1. Edit brain file
2. Restart server (or use brain reload feature)
3. Send `/reset` to bot to start fresh
4. Test new personality

### Logs

Server logs all activity:
```
📨 [bot1] User 123456 (alice): Hey there
✅ [bot1] Response sent (142 chars)
```

## Troubleshooting

### Bot doesn't respond

1. **Is Claude Code IDE running?**
   - The `--ide` flag requires Claude Code to be open
   - Open Claude Code before starting the server

2. **Is the token correct?**
   - Check `.env` for typos
   - Get new token from [@BotFather](https://t.me/botfather) if needed

3. **Check logs**
   - Terminal should show incoming messages
   - Error messages will explain what's wrong

### Bot has wrong personality

1. **Check brain file name** matches config:
   - Config: `"brain": "mybot"`
   - File: `brains/mybot.js`

2. **Restart server** to reload brain files

3. **Reset conversation** (send `/reset` to bot)

### Session files growing too large

Enable automatic cleanup in `.env`:
```bash
CLEANUP_OLD_SESSIONS=true
CLEANUP_AGE_DAYS=90
```

Or manually delete:
```bash
rm -rf ~/.claude/projects/bot-*/
```

## Advanced Usage

### Multiple Claude accounts (not implemented yet)

Phase 1 uses a single Claude account. Load balancing across multiple accounts is planned for Phase 2.

### Rate limiting (not implemented yet)

Basic rate limiting via Supabase is planned for Phase 1b. For now, all users have unlimited messages.

### MCP Tools

Bots automatically have access to any MCP tools available in your Claude Code IDE:
- Image generation
- Web search
- Code execution
- Custom tools you've installed

No configuration needed - just works via `--ide` flag.

## Roadmap

### Phase 1 (Current)
- ✅ Multi-bot platform
- ✅ Brain file system
- ✅ Session persistence
- ✅ MCP tools support
- ⏳ Rate limiting (optional)

### Phase 2 (Future)
- Web dashboard for bot creation
- Bot-as-a-Service (public offering)
- Stripe payments
- Analytics

### Phase 3 (Future)
- Platform-as-a-Service (enterprise licensing)
- Docker deployment
- White-label dashboard

See [PROJECT-OUTLINE.md](PROJECT-OUTLINE.md) for full roadmap.

## Contributing

This is currently a personal project. If you'd like to contribute:

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- 📖 Read the [docs](docs/)
- 🐛 [Report bugs](../../issues)
- 💡 [Request features](../../issues)

## Credits

Built with:
- [Claude Code CLI](https://claude.com/claude-code) by Anthropic
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

Inspired by:
- SmarterChild (the legendary AIM bot from 2001)
- The telecode proof-of-concept

---

**Made with ☕ and 🤖**
