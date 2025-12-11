# Nudge System Implementation

## Overview
Intelligent, LLM-powered follow-up messages that bots send after periods of user inactivity. Unlike fixed automated messages, nudges are **dynamically generated** by the bot's LLM based on conversation context.

## Core Concept

**Instead of:**
```
24h no contact → Send fixed message: "Still stuck?"
```

**We do:**
```
24h no contact → Ask bot LLM: "Review your last conversation with this user and craft a witty, contextual follow-up"
Bot generates: "So... did you end up shipping those tests or are we still 'thinking about it'?"
```

The bot **remembers the conversation** and creates a personalized nudge.

---

## Architecture

### 1. Nudge Configuration (Per Brain)

**Location:** `brains/*.js`

```javascript
// Example: mattyatlas.js
module.exports = {
  name: "MattyAtlas",
  systemPrompt: "...",

  // Nudge configuration
  nudges: {
    enabled: true,
    triggers: [
      {
        delayHours: 24,
        type: 'dynamic', // LLM generates message
        promptTemplate: `Review your last conversation with this user. They haven't responded in 24 hours.

Generate a sharp, direct follow-up message (1-2 sentences max) that:
- References what they were working on
- Calls out lack of action (if relevant)
- Forces a decision or response
- Matches your brutally honest personality

Do NOT:
- Be generic or automated-sounding
- Apologize or soften your tone
- Ask "how are you doing?"

Generate the message now:`,
        condition: 'no_user_message' // Only if user hasn't replied
      },
      {
        delayHours: 72,
        type: 'dynamic',
        promptTemplate: `It's been 3 days since this user responded. Review the conversation context.

Generate a final check-in message (1 sentence) that:
- Acknowledges the silence
- Leaves door open without being needy
- Maintains your sharp tone

Example: "Let me know when you're ready to move."

Generate the message now:`,
        stopSequence: true // Don't nudge after this
      }
    ]
  }
};
```

### 2. Nudge Manager Module

**Location:** `lib/nudge-manager.js`

**Responsibilities:**
- Run periodic checks (every hour via cron)
- Identify users who need nudges
- Generate dynamic nudge messages via LLM
- Send nudges via Telegram
- Update Claude session with sent nudge (so bot remembers)

**Class Structure:**
```javascript
class NudgeManager {
  constructor(botManager, sessionManager, claudeClient)

  // Main loop - runs every hour
  async checkNudges()

  // Check if specific user needs a nudge
  async checkUserNudges(botId, userId, nudgeConfig)

  // Determine which nudge trigger to fire
  getNextNudgeTrigger(triggers, hoursSinceLastMessage, lastNudgeSent)

  // Generate dynamic message using bot's LLM
  async generateNudgeMessage(botId, userId, trigger)

  // Send nudge to user + update session
  async sendNudge(botId, userId, message)

  // Optional: Manual nudge triggering
  async scheduleCustomNudge(botId, userId, delayHours, promptOverride)
}
```

### 3. Session Metadata Extensions

**Location:** `lib/session-manager.js`

**Add to session metadata:**
```javascript
{
  "sessionUuid": "abc-123",
  "messageCount": 45,
  "lastMessageTime": 1730000000000,

  // NEW: Nudge tracking
  "lastNudgeSent": 24, // Hours after last message when last nudge was sent
  "nudgeHistory": [
    {
      "timestamp": 1730000000000,
      "delayHours": 24,
      "message": "So... did you ship those tests or still 'thinking about it'?",
      "userResponded": false
    },
    {
      "timestamp": 1730086400000,
      "delayHours": 48,
      "message": "Let me know when you're ready to execute.",
      "userResponded": true // User replied after this nudge
    }
  ]
}
```

**New methods:**
```javascript
// Get all users for a bot (for nudge checking)
getAllUsersForBot(botId): userId[]

// Update last message time (called on every user message)
updateLastMessageTime(botId, userId)

// Record sent nudge
recordNudge(botId, userId, nudgeData)

// Mark nudge as responded
markNudgeResponded(botId, userId, nudgeTimestamp)
```

### 4. Integration with Message Handler

**Location:** `lib/bot-manager.js`

**On every user message:**
```javascript
// Update last message time
this.sessionManager.updateLastMessageTime(botId, msg.from.id);

// If this is a response to a nudge, mark it
const metadata = this.sessionManager.loadSessionMetadata(botId, msg.from.id);
if (metadata.nudgeHistory?.length > 0) {
  const lastNudge = metadata.nudgeHistory[metadata.nudgeHistory.length - 1];
  if (!lastNudge.userResponded) {
    this.sessionManager.markNudgeResponded(botId, msg.from.id, lastNudge.timestamp);
  }
}
```

---

## Implementation Steps

### Phase 1: Core Nudge System (3-4 hours)

**Step 1.1: Add nudge config to one brain (30min)**
- [ ] Add nudges config to `brains/mattyatlas.js`
- [ ] Define 2 triggers (24h, 72h)
- [ ] Write prompt templates for dynamic message generation

**Step 1.2: Extend session-manager (1 hour)**
- [ ] Add nudge tracking fields to metadata structure
- [ ] Implement `getAllUsersForBot()`
- [ ] Implement `updateLastMessageTime()`
- [ ] Implement `recordNudge()`
- [ ] Implement `markNudgeResponded()`
- [ ] Update message handler to track last message time

**Step 1.3: Build NudgeManager class (1.5 hours)**
- [ ] Create `lib/nudge-manager.js`
- [ ] Implement constructor with cron job (every hour)
- [ ] Implement `checkNudges()` - main loop
- [ ] Implement `checkUserNudges()` - per-user logic
- [ ] Implement `getNextNudgeTrigger()` - determine which trigger fires
- [ ] Implement `generateNudgeMessage()` - call bot LLM with context
- [ ] Implement `sendNudge()` - send to Telegram + update session

**Step 1.4: Integrate with server (30min)**
- [ ] Initialize NudgeManager in `server.js`
- [ ] Pass dependencies (botManager, sessionManager)
- [ ] Test cron job fires correctly

**Step 1.5: Testing (30min)**
- [ ] Manually set lastMessageTime to 25 hours ago
- [ ] Trigger nudge check
- [ ] Verify dynamic message generation
- [ ] Verify message sent to Telegram
- [ ] Verify session updated with nudge

### Phase 2: Advanced Features (2-3 hours)

**Step 2.1: Per-user custom nudges (1 hour)**
- [ ] Add `/nudge` command handler
- [ ] Parse user input: `/nudge 4h Check on task progress`
- [ ] Store custom nudge in metadata
- [ ] Extend NudgeManager to check custom nudges

**Step 2.2: Context-aware auto-scheduling (1.5 hours)**
- [ ] Add commitment detection to bot system prompts
- [ ] When bot detects user commitment (e.g., "I'll do X by Friday"), auto-schedule nudge
- [ ] Add tool/function for bot to call: `schedule_followup(delay, context)`
- [ ] Store auto-scheduled nudges in metadata

**Step 2.3: Analytics (30min)**
- [ ] Track nudge effectiveness (did user respond?)
- [ ] Log nudge metrics (sent count, response rate)
- [ ] Add `/nudgestats` command for debugging

---

## Key Implementation Details

### Generating Dynamic Nudge Messages

```javascript
async generateNudgeMessage(botId, userId, trigger) {
  const botInfo = this.botManager.bots.get(botId);
  const brain = botInfo.config.brain;

  // Get session UUID
  const sessionId = this.sessionManager.getCurrentUuid(botId, userId);
  if (!sessionId) {
    console.warn(`No session found for ${botId}/${userId}, skipping nudge`);
    return null;
  }

  // Build prompt for LLM
  const nudgePrompt = trigger.promptTemplate;

  // Call Claude with session context to generate message
  const result = await sendToClaudeSession({
    message: nudgePrompt,
    sessionId: sessionId,
    claudeCmd: this.claudeCmd,
    botId: botId
  });

  // Extract just the message text (no verbose explanations)
  const message = result.text.trim();

  console.log(`🎯 Generated dynamic nudge for ${botId}/${userId}: "${message}"`);

  return message;
}
```

### Sending Nudge + Updating Session

```javascript
async sendNudge(botId, userId, message) {
  const botInfo = this.botManager.bots.get(botId);
  const bot = botInfo.bot;

  console.log(`📬 Sending nudge from ${botId} to user ${userId}`);

  // 1. Send via Telegram
  await bot.sendMessage(userId, message);

  // 2. Update Claude session so bot "remembers" it sent this
  const sessionId = this.sessionManager.getCurrentUuid(botId, userId);
  if (sessionId) {
    // Inject into session as an assistant message
    await sendToClaudeSession({
      message: `[SYSTEM: You just sent a follow-up nudge to the user: "${message}"]\n\nUser's response (if any):`,
      sessionId: sessionId,
      claudeCmd: this.claudeCmd,
      botId: botId
    });
  }

  // 3. Record in metadata
  const metadata = this.sessionManager.loadSessionMetadata(botId, userId);
  const nudgeData = {
    timestamp: Date.now(),
    delayHours: trigger.delayHours,
    message: message,
    userResponded: false
  };

  this.sessionManager.recordNudge(botId, userId, nudgeData);
}
```

### Cron Job Setup

```javascript
// In NudgeManager constructor
constructor(botManager, sessionManager, claudeCmd) {
  this.botManager = botManager;
  this.sessionManager = sessionManager;
  this.claudeCmd = claudeCmd;

  // Check for nudges every hour
  this.cronJob = setInterval(() => {
    console.log('⏰ Running nudge check...');
    this.checkNudges().catch(err => {
      console.error('❌ Nudge check failed:', err);
    });
  }, 60 * 60 * 1000); // 1 hour

  console.log('✅ NudgeManager initialized with hourly checks');
}
```

---

## Configuration Examples

### MattyAtlas (Sharp Follow-ups)
```javascript
nudges: {
  enabled: true,
  triggers: [
    {
      delayHours: 24,
      type: 'dynamic',
      promptTemplate: `User hasn't responded in 24h. Review your last conversation.

Generate ONE sharp, direct sentence calling them out or checking in on their commitment. No fluff.`
    }
  ]
}
```

### Finn (Technical Check-ins)
```javascript
nudges: {
  enabled: true,
  triggers: [
    {
      delayHours: 48,
      type: 'dynamic',
      promptTemplate: `User hasn't responded in 2 days. They were working on something technical.

Generate a casual, friendly follow-up (1 sentence) asking if they're stuck or need help.`
    }
  ]
}
```

### RickD (Reality Checks)
```javascript
nudges: {
  enabled: true,
  triggers: [
    {
      delayHours: 12,
      type: 'dynamic',
      promptTemplate: `User went silent 12 hours ago. Review the conversation - did they commit to something?

Generate a blunt reality-check message (1 sentence) calling out inaction or checking progress.`
    }
  ]
}
```

---

## Testing Plan

### Manual Testing
1. Create test user session with MattyAtlas
2. Set `lastMessageTime` to 25 hours ago via direct metadata edit
3. Trigger nudge check manually: `nudgeManager.checkNudges()`
4. Verify:
   - LLM generates contextual message
   - Message sent to Telegram
   - Session updated with nudge
   - Metadata records nudge

### Automated Testing
1. Mock Telegram sendMessage
2. Mock Claude API responses
3. Test nudge trigger logic with various time delays
4. Test that responding marks nudge as responded
5. Test stopSequence prevents further nudges

---

## Success Metrics

**Technical:**
- [ ] Nudges fire at correct intervals
- [ ] Messages are contextual (not generic)
- [ ] Bot remembers sending nudges
- [ ] No duplicate nudges sent
- [ ] Cron job runs reliably

**User Experience:**
- [ ] Nudges feel personal, not automated
- [ ] Users respond to nudges (engagement boost)
- [ ] Messages match bot personality
- [ ] Timing feels natural

---

## Future Enhancements

1. **Smart timing:** Learn best nudge times per user
2. **A/B testing:** Test different prompt templates
3. **Escalation:** Increase urgency if multiple nudges ignored
4. **Opt-out:** `/nonudge` command to disable
5. **Analytics dashboard:** Track nudge performance across bots
