# Brain Files Guide

Brain files are the personality configuration for each bot. They're simple JavaScript modules that define how your bot thinks, speaks, and behaves.

## Quick Start

1. **Copy the template:**
   ```bash
   cp brains/_template.js brains/mybot.js
   ```

2. **Edit the brain file:**
   - Define `systemPrompt` (the bot's personality)
   - Optionally customize `contextPrefix`, `maxTokens`, `temperature`
   - Set rate limits if using Supabase

3. **Add bot to `.env`:**
   ```bash
   BOTS=[{"id":"mybot","token":"YOUR_TOKEN","brain":"mybot"}]
   ```

4. **Start server:**
   ```bash
   npm start
   ```

---

## Brain File Structure

### Required Fields

#### `systemPrompt` (string)
The core personality definition. This gets injected into every conversation with Claude.

**Best practices:**
- Be specific about personality traits, tone, and rules
- Include examples of desired responses
- Aim for 200-500 words (too short = inconsistent, too long = wasted tokens)
- Use clear sections (PERSONALITY, TONE, RULES, EXAMPLES)

**Example:**
```javascript
systemPrompt: `You are a helpful coding assistant.

PERSONALITY:
- Patient and encouraging
- Detail-oriented but concise
- Assumes user is learning

TONE:
- Friendly and approachable
- Use simple language
- Avoid jargon unless necessary

RULES:
- Always explain code with comments
- Suggest best practices
- If unsure, say so

EXAMPLES:
User: "How do I reverse a string in JavaScript?"
You: "Here's a simple way: str.split('').reverse().join('') - this splits the string into an array, reverses it, then joins it back together."`
```

---

### Optional Fields

#### `name` (string)
Human-readable bot name. Used in logs.

#### `version` (string)
Brain version for tracking changes.

#### `description` (string)
Brief description of bot's purpose.

#### `contextPrefix` (function)
Function that generates additional context for each conversation.

**Signature:**
```javascript
contextPrefix: (user) => {
  // user object has: id, username, first_name, last_name
  return `Additional context here`;
}
```

**Example - Personalization:**
```javascript
contextPrefix: (user) => {
  const name = user.first_name || user.username || 'there';
  return `You're chatting with ${name}. Remember to use their name occasionally.`;
}
```

**Example - Timezone awareness:**
```javascript
contextPrefix: (user) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Current time context: It's ${greeting} for the user.`;
}
```

#### `maxTokens` (number)
Suggested maximum response length. (Note: Claude CLI doesn't directly support this yet, but useful for documentation)

**Guidelines:**
- 50-150: Very brief responses (like SmarterChild)
- 150-300: Normal conversation
- 300-500: Detailed explanations
- 500+: Long-form content (essays, code)

#### `temperature` (number, 0.0-1.0)
Suggested creativity level. (Note: Claude CLI doesn't directly support this yet)

**Guidelines:**
- 0.0-0.3: Deterministic, factual (math tutor, code reviewer)
- 0.4-0.7: Balanced (general assistant)
- 0.8-1.0: Creative (storyteller, poet)

#### `rateLimits` (object)
Message limits per user tier. Only used if Supabase rate limiting is enabled.

```javascript
rateLimits: {
  free: 10,    // Free users: 10 messages/day
  paid: 1000   // Paid users: 1000 messages/day
}
```

---

## Writing Great System Prompts

### 1. Define Personality Clearly

**Bad:**
```javascript
systemPrompt: "You are helpful."
```

**Good:**
```javascript
systemPrompt: `You are a helpful assistant.

PERSONALITY:
- Patient and encouraging
- Enthusiastic about learning
- Never condescending

TONE:
- Warm and friendly
- Use simple language
- Occasional emoji (max 1-2 per message)`
```

---

### 2. Set Clear Constraints

**Examples:**

**Response length:**
```
- Keep responses under 100 words
- If user asks for more detail, you can be longer
```

**Behavior rules:**
```
- Never break character
- If you don't know something, admit it
- Don't make up facts
```

**Content boundaries:**
```
- Avoid controversial topics (politics, religion)
- Keep conversation light and fun
```

---

### 3. Provide Examples

Examples help Claude understand the exact vibe you want.

```javascript
EXAMPLES:
User: "I'm stuck on this bug"
You: "Debugging can be frustrating! Let's work through it together. What error are you seeing?"

User: "Thanks for your help!"
You: "Happy to help! Feel free to come back anytime you're stuck 😊"
```

---

### 4. Use Sections for Clarity

Organize your prompt into clear sections:

```javascript
systemPrompt: `You are [CHARACTER].

PERSONALITY:
[Traits]

TONE:
[How you speak]

RULES:
[Constraints]

EXAMPLES:
[Sample interactions]
```

---

## Common Patterns

### Pattern 1: The Sarcastic Assistant
```javascript
systemPrompt: `You are a sarcastic but helpful assistant.

PERSONALITY:
- Witty and sarcastic
- Helpful despite the snark
- Self-aware about being AI

TONE:
- Dry humor
- Brief responses
- Use "lol" and "tbh" sparingly

RULES:
- Be sarcastic, not mean
- Still provide helpful answers
- Keep responses under 3 sentences`
```

### Pattern 2: The Domain Expert
```javascript
systemPrompt: `You are a fitness coach.

PERSONALITY:
- Motivating and energetic
- Knowledgeable about exercise and nutrition
- Safety-focused

TONE:
- Encouraging and positive
- Use fitness terminology but explain it
- Celebrate user progress

RULES:
- Always emphasize safety (warm-up, form, etc)
- Never diagnose injuries - recommend seeing a doctor
- Provide actionable advice`
```

### Pattern 3: The Creative Writer
```javascript
systemPrompt: `You are a creative writing assistant.

PERSONALITY:
- Imaginative and expressive
- Encouraging of creativity
- Knowledgeable about storytelling techniques

TONE:
- Inspirational and supportive
- Use vivid language
- Ask thought-provoking questions

RULES:
- Help develop ideas, don't write entire stories
- Suggest techniques (show don't tell, character arcs, etc)
- Encourage user's unique voice`
```

---

## Testing Your Brain

### Quick Test Checklist

1. **Start bot with new brain:**
   ```bash
   npm start
   ```

2. **Send test messages:**
   - Normal question: "Hello, how are you?"
   - Edge case: "I don't know what to ask"
   - Boundary test: Send very long message
   - Character test: Try to make bot break character

3. **Check for:**
   - [ ] Consistent personality
   - [ ] Appropriate response length
   - [ ] Tone matches your intent
   - [ ] Bot doesn't break character

### Iterating on Brains

Brain files are hot-reloadable in development:

```javascript
// In your code
brainLoader.reload('mybot'); // Reloads brain from disk
```

Or just restart the server:
```bash
# Ctrl+C to stop
npm start
```

---

## Examples

See these brain files for inspiration:
- [brains/smarterchild.js](../brains/smarterchild.js) - Witty, nostalgic chatbot
- [brains/therapist.js](../brains/therapist.js) - Empathetic listener
- [brains/mattyatlas.js](../brains/mattyatlas.js) - Strategic clarity weapon
- [brains/rickd.js](../brains/rickd.js) - Brutal truth-teller
- [brains/priest.js](../brains/priest.js) - Compassionate spiritual guide
- [brains/finnshipley.js](../brains/finnshipley.js) - Pure execution developer
- [brains/penseller.js](../brains/penseller.js) - Sales-focused personality
- [brains/cartoonedbot.js](../brains/cartoonedbot.js) - 2D cartoon generator
- [brains/_template.js](../brains/_template.js) - Fully commented template

---

## Possible Future Bot Ideas

Based on common user needs and gaps in the current bot lineup:

**Business & Professional:**
- Sales Coach - Negotiation tactics, deal closing, pipeline management
- Career Coach - Resume reviews, interview prep, career path guidance
- Negotiation Expert - Contract discussions, salary talks, conflict resolution

**Health & Wellness:**
- Fitness Coach - Workout plans, form checks, nutrition guidance
- Habit Coach - Behavior change, streak tracking, accountability

**Finance & Learning:**
- Finance Advisor - Budgeting, investment basics, financial literacy
- Book Summarizer - Condensed insights from business/self-help books
- Philosophy Guide - Stoicism, existentialism, practical wisdom

**Relationships:**
- Relationship Advisor - Communication skills, conflict resolution, dating advice

---

## Troubleshooting

### "Brain file not found"
- Check file is in `brains/` directory
- Ensure filename matches brain name in config (without `.js`)
- Filename is case-sensitive

### "Brain is missing required field: systemPrompt"
- Add `systemPrompt: "..."` to your brain file
- Make sure it's a string, not a function

### Bot responses are inconsistent
- System prompt may be too vague
- Add more specific personality traits and examples
- Check prompt length (aim for 200-500 words)

### Bot breaks character
- Add explicit rule: "Never break character"
- Provide examples of staying in character
- Make personality description more specific

---

## Best Practices

1. **Start simple, iterate:** Begin with a basic personality, test, then refine
2. **Use examples:** Show Claude the exact vibe you want
3. **Set constraints:** Be explicit about response length, tone, boundaries
4. **Test edge cases:** Try to break your bot, then fix the prompt
5. **Version your brains:** Increment `version` when making changes
6. **Document changes:** Add comments explaining why you made changes

---

## Advanced: Dynamic System Prompts

For advanced use cases, you can make system prompts dynamic:

```javascript
contextPrefix: (user) => {
  // Load user preferences from database
  const prefs = loadUserPreferences(user.id);

  return `User preferences: ${prefs.language}, interests: ${prefs.interests.join(', ')}`;
}
```

This allows personalizing the bot's behavior per user while keeping the core personality consistent.
