# Bot Delegation System (Context Injection)

## Overview
Allows one bot to delegate tasks to another bot by injecting conversation context. Users can ask one bot (e.g., MattyAtlas) to "tell another bot (e.g., Finn) to do X", and the context automatically carries over.

## Core Concept

**User workflow:**
```
You → MattyAtlas: "We need to build a landing page for Product X. Here's the strategy..."
[Discussion continues for 10 messages]

You → MattyAtlas: "Tell Finn to implement this landing page"

MattyAtlas → System: Delegates task to Finn with last 10 messages as context

Finn (in your DM with Finn): "Got it. Implementing landing page for Product X based on MattyAtlas's strategy..."
```

**Key insight:** No shared session needed. Just copy context from Source Bot → Target Bot on-demand.

---

## Architecture

### 1. Trigger Detection (In Bot Brains)

**Location:** Brain system prompts (e.g., `brains/mattyatlas.js`)

**Add to system prompt:**
```javascript
systemPrompt: `You are MattyAtlas...

[existing personality]

DELEGATION:
If the user asks you to "tell [bot name] to do X" or "have [bot] do Y", respond with EXACTLY this format:

DELEGATE: [bot_name]
TASK: [clear description of what they should do]
CONTEXT: [brief summary if needed]

Example:
User: "Tell Finn to implement this"
You: "DELEGATE: finn
TASK: Implement the landing page we discussed with Product X strategy
CONTEXT: Use the positioning we agreed on: fast, simple, no-code"

Bot names available: mattyatlas, finn, rickd, cartoongen, smarterchild, penseller, priest
`
```

### 2. Delegation Parser

**Location:** `lib/delegation-parser.js`

**Purpose:** Extract delegation commands from bot responses

```javascript
class DelegationParser {
  static parse(botResponse) {
    // Look for DELEGATE: pattern
    const delegateMatch = botResponse.match(/DELEGATE:\s*(\w+)/i);
    const taskMatch = botResponse.match(/TASK:\s*([^\n]+)/i);
    const contextMatch = botResponse.match(/CONTEXT:\s*([^\n]+)/i);

    if (!delegateMatch || !taskMatch) {
      return null; // Not a delegation
    }

    return {
      targetBot: delegateMatch[1].toLowerCase(),
      task: taskMatch[1].trim(),
      context: contextMatch ? contextMatch[1].trim() : null
    };
  }

  static isDelegation(botResponse) {
    return /DELEGATE:/i.test(botResponse);
  }
}
```

### 3. Context Injection Logic

**Location:** `lib/bot-manager.js`

**New method:**
```javascript
async delegateToBot(sourceBotId, targetBotId, userId, task, contextMessageCount = 10) {
  console.log(`🔀 Delegation: ${sourceBotId} → ${targetBotId} for user ${userId}`);

  // 1. Get recent messages from source bot session
  const sourceContext = this.sessionManager.getRecentMessages(
    sourceBotId,
    userId,
    contextMessageCount
  );

  // 2. Get target bot info
  const targetBotInfo = this.bots.get(targetBotId);
  if (!targetBotInfo) {
    throw new Error(`Target bot ${targetBotId} not found`);
  }

  // 3. Get or create target bot session
  let targetSessionId = this.sessionManager.getCurrentUuid(targetBotId, userId);
  const isNewSession = !targetSessionId;

  if (isNewSession) {
    targetSessionId = this.sessionManager.createNewSession(targetBotId, userId);
    console.log(`🆕 Created new session for ${targetBotId}: ${targetSessionId}`);
  }

  // 4. Build delegation message with context
  const delegationMessage = this.buildDelegationMessage(
    sourceBotId,
    sourceContext,
    task
  );

  // 5. Send to target bot
  const result = await sendToClaudeSession({
    message: delegationMessage,
    sessionId: isNewSession ? null : targetSessionId, // null for new, ID for resume
    claudeCmd: this.claudeCmd,
    botId: targetBotId
  });

  // 6. Save session UUID
  if (isNewSession) {
    const sessionInfo = result.metadata?.sessionInfo;
    if (sessionInfo?.sessionId) {
      this.sessionManager.saveUuid(targetBotId, userId, sessionInfo.sessionId);
    }
  }

  // 7. Send target bot's response to user in their DM
  const targetBot = targetBotInfo.bot;
  await targetBot.sendMessage(userId, result.text);

  console.log(`✅ Delegation complete: ${targetBotId} responded to user`);

  return {
    success: true,
    targetBot: targetBotId,
    response: result.text
  };
}

buildDelegationMessage(sourceBotId, context, task) {
  return `[DELEGATED FROM ${sourceBotId.toUpperCase()}]

CONTEXT FROM PREVIOUS CONVERSATION:
${context}

YOUR TASK:
${task}

Please acknowledge and complete this task. You have full context from the conversation above.`;
}
```

### 4. Session Manager Extensions

**Location:** `lib/session-manager.js`

**New method:**
```javascript
getRecentMessages(botId, userId, limit = 10) {
  // Get session file
  const sessionDir = this.getSessionDir(botId, userId);
  const metadata = this.loadSessionMetadata(botId, userId);

  if (!metadata || !metadata.sessionUuid) {
    return "No previous conversation found.";
  }

  const sessionFile = path.join(sessionDir, `${metadata.sessionUuid}.json`);

  if (!fs.existsSync(sessionFile)) {
    return "Session file not found.";
  }

  // Read session data
  const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));

  // Extract last N messages (user + assistant exchanges)
  const messages = this.extractMessages(sessionData, limit);

  // Format as readable context
  return this.formatMessagesAsContext(messages);
}

extractMessages(sessionData, limit) {
  const messages = [];

  // Session data structure may vary, adapt as needed
  // This is a simplified example
  if (sessionData.messages) {
    for (const msg of sessionData.messages.slice(-limit * 2)) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  return messages.slice(-limit); // Ensure we don't exceed limit
}

formatMessagesAsContext(messages) {
  let formatted = '';

  for (const msg of messages) {
    if (msg.role === 'user') {
      formatted += `User: ${msg.content}\n\n`;
    } else {
      formatted += `Bot: ${msg.content}\n\n`;
    }
  }

  return formatted.trim();
}
```

### 5. Integration with Message Handler

**Location:** `lib/bot-manager.js` in `handleMessage()`

**After getting bot response, check for delegation:**

```javascript
// After Claude responds
const result = await sendToClaudeSession({ ... });

// Check if response contains delegation command
if (DelegationParser.isDelegation(result.text)) {
  const delegation = DelegationParser.parse(result.text);

  if (delegation) {
    console.log(`🔀 Detected delegation to ${delegation.targetBot}`);

    try {
      // Execute delegation
      await this.delegateToBot(
        botId,
        delegation.targetBot,
        msg.from.id,
        delegation.task
      );

      // Respond to user confirming delegation
      await bot.sendMessage(
        chatId,
        `✅ Task delegated to ${delegation.targetBot}. They'll respond in your DM.`
      );

      return; // Don't send the raw delegation response to user
    } catch (err) {
      console.error(`❌ Delegation failed:`, err);
      await bot.sendMessage(
        chatId,
        `⚠️ Failed to delegate to ${delegation.targetBot}: ${err.message}`
      );
    }
  }
}

// Otherwise, send normal response to user
await bot.sendMessage(chatId, cleanResponse);
```

---

## Implementation Steps

### Phase 1: Basic Delegation (2-3 hours)

**Step 1.1: Update brain system prompts (30min)**
- [ ] Add delegation instructions to MattyAtlas brain
- [ ] Define delegation format (DELEGATE/TASK/CONTEXT)
- [ ] Test that bot follows format in responses

**Step 1.2: Build delegation parser (30min)**
- [ ] Create `lib/delegation-parser.js`
- [ ] Implement `parse()` method
- [ ] Implement `isDelegation()` method
- [ ] Write unit tests

**Step 1.3: Extend session-manager (45min)**
- [ ] Implement `getRecentMessages()`
- [ ] Implement `extractMessages()`
- [ ] Implement `formatMessagesAsContext()`
- [ ] Test with real session files

**Step 1.4: Build delegateToBot() (45min)**
- [ ] Add method to bot-manager.js
- [ ] Implement context retrieval
- [ ] Implement message building
- [ ] Implement target bot invocation
- [ ] Test with manual delegation

**Step 1.5: Integrate with message handler (30min)**
- [ ] Add delegation detection to handleMessage()
- [ ] Call delegateToBot() when detected
- [ ] Send confirmation message to user
- [ ] Test end-to-end flow

### Phase 2: Advanced Features (1-2 hours)

**Step 2.1: Custom context depth (30min)**
- [ ] Allow user to specify context size: "Tell Finn [context:5] to do X"
- [ ] Parse context parameter
- [ ] Pass to delegateToBot()

**Step 2.2: Multi-bot delegation (30min)**
- [ ] Support: "Tell Finn and RickD to review this"
- [ ] Parse multiple targets
- [ ] Delegate to each in parallel

**Step 2.3: Delegation with file attachments (30min)**
- [ ] If source conversation had images/files, pass URLs to target
- [ ] Add to delegation message context

---

## Testing Plan

### Manual Testing
1. Start conversation with MattyAtlas
2. Discuss a project for 5-10 messages
3. Say: "Tell Finn to implement this"
4. Verify:
   - MattyAtlas generates DELEGATE command
   - Delegation parser extracts target + task
   - Context copied from MattyAtlas session
   - Finn receives message with full context
   - Finn responds in your DM with him

### Edge Cases
- [ ] Delegation to non-existent bot
- [ ] Delegation with no prior context
- [ ] Delegation format not followed by bot
- [ ] Target bot session doesn't exist yet
- [ ] Multiple delegations in one message

---

## Configuration Examples

### MattyAtlas (Strategic Delegator)
```javascript
systemPrompt: `...

DELEGATION:
You can delegate tasks to specialist bots:
- finn: Technical implementation, coding, building
- rickd: Reality checks, constraint analysis
- cartoongen: Visual content creation

When user asks you to delegate, use:
DELEGATE: [bot]
TASK: [clear instruction]
CONTEXT: [1 sentence summary if needed]
`
```

### Finn (Implementation Specialist)
```javascript
systemPrompt: `...

When you receive delegated tasks from other bots, you'll see:
[DELEGATED FROM X] with context and your task.

Acknowledge the context, then execute the task.
`
```

---

## User Experience

### Before (Manual Context Copy)
```
User → MattyAtlas: "Let's plan this feature..."
[10 messages of discussion]

User → Finn: "Hey Finn, MattyAtlas and I discussed a feature. Here's what we said: [copy-paste]"
```

### After (Automatic Delegation)
```
User → MattyAtlas: "Let's plan this feature..."
[10 messages of discussion]

User → MattyAtlas: "Tell Finn to build this"
MattyAtlas: "✅ Task delegated to Finn"

Finn (in DM): "Got it. I see MattyAtlas wants me to build [feature]. I'll start with..."
```

**Zero context switching. Zero copy-paste.**

---

## Future Enhancements

1. **Bidirectional updates:** Finn can update MattyAtlas on progress
2. **Delegation chains:** Finn can sub-delegate to CartoonGen
3. **Task tracking:** See all delegated tasks across bots
4. **Approval flow:** User must approve delegation before it happens
5. **Smart routing:** Bot automatically chooses best specialist for task

---

## Success Metrics

**Technical:**
- [ ] Delegation detected 100% of time when format used
- [ ] Context copied accurately
- [ ] Target bot receives full context
- [ ] No duplicate messages
- [ ] Session state preserved

**User Experience:**
- [ ] Users understand delegation flow
- [ ] Context feels seamless (no repetition needed)
- [ ] Bots acknowledge context appropriately
- [ ] Delegation saves time vs manual switching
