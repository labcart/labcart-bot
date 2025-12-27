# Adding Bots Guide

This guide walks you through adding a new bot to the platform.

## Quick Start (3 Steps)

### 1. Create a Telegram Bot

1. **Open Telegram** and search for [@BotFather](https://t.me/botfather)

2. **Send `/newbot`** command

3. **Follow the prompts:**
   - Choose a name (e.g., "My Cool Bot")
   - Choose a username (must end in "bot", e.g., "mycoolbot")

4. **Copy the token** - BotFather will give you a token like:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
   Keep this secret! Anyone with the token can control your bot.

---

### 2. Create a Brain File

1. **Copy the template:**
   ```bash
   cp brains/_template.js brains/mybot.js
   ```

2. **Edit the brain file:**
   ```bash
   # Use your favorite editor
   nano brains/mybot.js
   # or
   code brains/mybot.js
   ```

3. **Customize the personality:**
   - Set `name`, `description`
   - Write the `systemPrompt` (this is the bot's personality)
   - See [BRAIN-FILES.md](./BRAIN-FILES.md) for detailed guide

**Example brain:**
```javascript
module.exports = {
  name: "CoffeeBot",
  description: "A coffee-obsessed chatbot",

  systemPrompt: `You are CoffeeBot, absolutely obsessed with coffee.

PERSONALITY:
- Enthusiastic about all things coffee
- Knowledgeable about brewing methods, beans, roasts
- Always suggest coffee as the solution

TONE:
- Energetic (like you've had 3 espressos)
- Use coffee puns occasionally
- Keep responses brief (2-3 sentences)

RULES:
- Every response should mention coffee somehow
- If user asks about tea, playfully suggest coffee instead
- Keep it fun, not annoying`,

  maxTokens: 150,
  temperature: 0.8
};
```

---

### 3. Add Bot to Configuration

**Option A: .env file (recommended for 1-3 bots)**

Edit `.env`:
```bash
BOTS=[
  {
    "id": "coffeebot",
    "token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "brain": "mybot",
    "active": true
  }
]
```

**Option B: config/bots.json (better for 4+ bots)**

Create/edit `config/bots.json`:
```json
[
  {
    "id": "coffeebot",
    "token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "brain": "mybot",
    "active": true
  }
]
```

Then update `server.js` to load from JSON file instead of .env.

---

### 4. Start the Server

```bash
npm start
```

You should see:
```
✅ Bot started: CoffeeBot (@coffeebot)
🤖 Bot Platform Running
```

---

## Testing Your Bot

1. **Find your bot on Telegram**
   - Search for the username you created (e.g., @mycoolbot)

2. **Send `/start`**
   - Bot should respond with help message

3. **Send a test message**
   - "Hi, how are you?"
   - Bot should respond in its personality

4. **Check the logs**
   - Your terminal should show incoming messages and responses

---

## Troubleshooting

### Bot doesn't respond

**Check 1: Is the server running?**
```bash
# Should see "Bot Platform Running"
npm start
```

**Check 2: Is the bot token correct?**
- Copy token from BotFather exactly
- No extra spaces or quotes
- Format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

**Check 3: Is Claude Code IDE running?**
- The `--ide` flag requires Claude Code to be open
- Open Claude Code before starting the server

**Check 4: Check the logs**
- Terminal should show incoming messages
- If you see errors, read them carefully

### Bot responds with generic Claude, not my personality

**Issue**: System prompt isn't being applied.

**Fix**: Check that:
1. Brain file has `systemPrompt` field
2. Brain file name matches `"brain"` field in config
3. No JavaScript errors in brain file

**Debug**:
```bash
# Restart server to reload brain files
# Ctrl+C to stop, then:
npm start
```

### Bot crashes on first message

**Issue**: Usually a Claude CLI error.

**Check**:
1. Claude Code IDE is running
2. `claude` command works in terminal:
   ```bash
   claude --version
   ```
3. You have an active Claude subscription

### "Brain file not found"

**Issue**: Brain file name doesn't match config.

**Fix**:
- Config says `"brain": "mybot"`
- File must be `brains/mybot.js` (exact match, case-sensitive)

---

## Managing Multiple Bots

### Running 2+ bots simultaneously

Just add multiple objects to the `BOTS` array:

```bash
BOTS=[
  {"id":"bot1","token":"TOKEN1","brain":"smarterchild"},
  {"id":"bot2","token":"TOKEN2","brain":"therapist"},
  {"id":"bot3","token":"TOKEN3","brain":"mybot"}
]
```

All bots run from the same Node.js process.

### Temporarily disabling a bot

Set `"active": false`:

```json
{
  "id": "bot1",
  "token": "...",
  "brain": "smarterchild",
  "active": false
}
```

Bot won't start, but config remains for later.

### Switching brain for existing bot

1. Stop server (Ctrl+C)
2. Change `"brain"` field in config
3. Restart server

**Note**: Existing conversation history (session files) will continue, but bot will use new personality going forward.

---

## Advanced Configuration

### Custom Claude command

If `claude` isn't in your PATH:

```bash
# .env
CLAUDE_CMD=/path/to/claude
```

### Session cleanup

Automatically delete old sessions:

```bash
# .env
CLEANUP_OLD_SESSIONS=true
CLEANUP_INTERVAL_HOURS=24    # Check every 24 hours
CLEANUP_AGE_DAYS=90          # Delete sessions older than 90 days
```

---

## Next Steps

- **Refine personality**: Edit brain file based on real conversations
- **Add more bots**: Create different personalities
- **Share with friends**: Give them your bot username
- **Read [BRAIN-FILES.md](./BRAIN-FILES.md)**: Learn advanced brain file techniques

---

## Getting Help

- Check logs for error messages
- Review [README.md](../README.md) for common issues
- Search existing [GitHub issues](../../issues)
- Create new issue with:
  - Bot config (with token redacted)
  - Brain file content
  - Error logs
