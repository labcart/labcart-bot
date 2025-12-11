# Setup Checklist

## ✅ Phase 1 Complete!

All core files have been created. Here's what you have:

### Project Structure
```
claude-bot/
├── 📄 server.js              ✅ Main entry point
├── 📄 package.json           ✅ Dependencies installed
├── 📄 .env.example           ✅ Template ready
├── 📄 .gitignore             ✅ Git config
│
├── 🧠 brains/
│   ├── _template.js          ✅ Brain template
│   ├── smarterchild.js       ✅ SmarterChild personality
│   └── therapist.js          ✅ Therapy bot personality
│
├── ⚙️  lib/
│   ├── bot-manager.js        ✅ Multi-bot orchestration
│   ├── brain-loader.js       ✅ Personality loading
│   ├── session-manager.js    ✅ Claude session handling
│   └── claude-client.js      ✅ CLI wrapper (from telecode)
│
└── 📚 docs/
    ├── BRAIN-FILES.md        ✅ Brain creation guide
    └── ADDING-BOTS.md        ✅ Bot setup tutorial
```

---

## Next Steps to Run Your First Bot

### 1. Create Telegram Bot

1. Open Telegram, search for [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow prompts (name + username)
4. **Copy the token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Configure Environment

```bash
# Copy example file
cp .env.example .env

# Edit .env with your token
nano .env
```

Replace `YOUR_BOT_TOKEN_HERE` with your actual token:
```bash
BOTS=[{"id":"smarterchild","token":"123456789:ABCdefGHIjklMNOpqrsTUVwxyz","brain":"smarterchild"}]
```

### 3. Start Claude Code IDE

**IMPORTANT**: The `--ide` flag requires Claude Code to be running.

1. Open Claude Code app
2. Make sure you're logged in
3. Leave it running in the background

### 4. Start the Bot Server

```bash
npm start
```

You should see:
```
╔═══════════════════════════════════════╗
║   🤖 Claude Bot Platform v1.0         ║
║   Multi-Bot Telegram Manager          ║
╚═══════════════════════════════════════╝

🚀 Loading bots...

✅ Loaded brain: SmarterChild v2.0
✅ Bot started: SmarterChild (@smarterchild)

🤖 Bot Platform Running
📊 Active bots: 1
   - SmarterChild (brain: 2.0)

✨ Ready to receive messages!
```

### 5. Test Your Bot

1. Find your bot on Telegram (search for username)
2. Send `/start`
3. Chat with it!

---

## Troubleshooting

### "BOTS environment variable not set"

- Make sure you created `.env` file (not `.env.example`)
- Check that `BOTS` line is present and valid JSON

### "Failed to spawn: claude"

**Most likely cause**: Claude Code IDE not running
- Open Claude Code app
- Make sure you're logged in
- Keep it running in background

The `claude` CLI command is already installed on your system.

### "Polling error" or bot doesn't respond

- Check token is correct (no extra spaces)
- Make sure bot username is available
- Try creating new bot with BotFather

---

## What Works Now

✅ **Multi-bot support** - Add more bots by adding to BOTS array
✅ **Brain personalities** - Each bot has its own personality
✅ **Session persistence** - Conversations saved automatically
✅ **Streaming responses** - Real-time message updates
✅ **MCP tools** - Bots can use image gen, web search, etc
✅ **Bot commands** - `/start`, `/help`, `/reset`, `/stats`

## What's Next (Optional)

### Add a Second Bot

1. Create new bot with BotFather
2. Copy therapist brain or create new one
3. Add to BOTS array in `.env`:

```bash
BOTS=[
  {"id":"smarterchild","token":"TOKEN1","brain":"smarterchild"},
  {"id":"therapist","token":"TOKEN2","brain":"therapist"}
]
```

### Create Custom Brain

```bash
# Copy template
cp brains/_template.js brains/mybot.js

# Edit it
nano brains/mybot.js

# Add to .env with new bot token
```

See [docs/BRAIN-FILES.md](docs/BRAIN-FILES.md) for detailed guide.

### Enable Session Cleanup

In `.env`:
```bash
CLEANUP_OLD_SESSIONS=true
CLEANUP_INTERVAL_HOURS=24
CLEANUP_AGE_DAYS=90
```

This automatically deletes old session files to save disk space.

---

## Files You Need to Edit

- ✏️  `.env` - Add your Telegram bot tokens
- ✏️  `brains/*.js` - Customize personalities (optional)

## Files You DON'T Need to Touch

- ✅ `server.js` - Works as-is
- ✅ `lib/*.js` - Core logic, already complete
- ✅ `package.json` - Dependencies installed

---

## Testing Checklist

- [ ] Created Telegram bot via BotFather
- [ ] Copied token to `.env`
- [ ] Claude Code IDE is running
- [ ] Ran `npm start` successfully
- [ ] Found bot on Telegram
- [ ] Sent `/start` → got response
- [ ] Sent message → got personality response
- [ ] Restarted server → conversation continued

---

## Getting Help

- 📖 **README.md** - Overview and quick start
- 📖 **docs/BRAIN-FILES.md** - How to create personalities
- 📖 **docs/ADDING-BOTS.md** - Step-by-step bot setup
- 📖 **PROJECT-OUTLINE.md** - Full project roadmap

**Ready to build?** Start with step 1 above! 🚀
