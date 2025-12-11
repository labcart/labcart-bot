# Two-Turn Flow for MCP Tools

## Overview

Some MCP tools require a **2-turn conversation flow** where we need to:
1. Get Claude's understanding/response (Turn 1)
2. Call an MCP tool with that understanding (Turn 2)
3. Send ONLY the tool output to the user (not Claude's text)

This pattern is used for **Text-to-Speech (TTS)** and **Image Generation**.

## Why 2-Turn?

The key requirement: **We need to suppress Claude's text response and send only the generated file (audio or image).**

If we used a 1-turn flow, Claude would narrate what it's doing:
- TTS: "I'll convert this to audio for you..." (text sent to user ❌)
- Images: "I'll create that image..." (text sent to user ❌)

With 2-turn flow:
- Turn 1: Claude responds with text → **we capture it but don't send it**
- Turn 2: We inject a tool call → tool generates file → **we send only the file**

## TTS Flow (Text-to-Speech)

### Purpose
Convert Claude's text response into audio using OpenAI TTS.

### The Flow

**Turn 1:**
1. User sends message
2. Claude generates text response
3. We capture `fullResponse` from `content_block_delta` events
4. When `message_stop` arrives, Turn 1 is complete

**Turn 2:**
1. We inject a new message asking Claude to call `mcp__tts__text_to_speech`
2. We pass the exact text from Turn 1 to convert to audio
3. Tool generates MP3 file to disk with filename: `bot-{botId}-user-{userId}-{timestamp1}-{timestamp2}.mp3`
4. We search directory for files matching our prefix
5. We organize/move the file
6. We send ONLY the audio file to Telegram (no text)

### Key Implementation Details

```javascript
// Turn 1: Capture text response
if (turn === 1 && data.delta?.text) {
  fullResponse += data.delta.text;
}

// Turn 2: Call TTS with the captured text
const ttsRequestText = `Please use the mcp__tts__text_to_speech tool to convert this text to audio:

"${fullResponse}"

Use these exact parameters:
- text: the text above
- voice: "${ttsVoice}"
- speed: ${ttsSpeed}
- filename: "${audioFilename}"
- include_base64: false

Only call the tool, no additional response needed.`;
```

### Critical Points
- **MUST include `--input-format stream-json`** for both new and resumed sessions
- Text from Turn 1 is required (audio is generated FROM this text)
- Result includes: `{ success: true, text: fullResponse, audioPath: '/path/to/file.mp3' }`

---

## Image Generation Flow

### Purpose
Generate images based on user requests using OpenAI DALL-E.

### The Flow

**Turn 1:**
1. User sends message asking for an image
2. Claude responds (may or may not include text explanation)
3. We capture `fullResponse` from `content_block_delta` events (might be empty!)
4. When `message_stop` arrives, Turn 1 is complete

**Turn 2:**
1. We inject a new message asking Claude to call `mcp__image-gen__generate_image`
2. Claude generates its own prompt based on user's request
3. Tool generates PNG file to disk with filename: `bot-{botId}-user-{userId}-{timestamp1}-{timestamp2}.png`
4. We search directory for files matching our prefix
5. We organize/move the file
6. We send ONLY the image file to Telegram (no text)

### Key Implementation Details

```javascript
// Turn 1: Capture text response (might be empty for images!)
if (turn === 1 && data.delta?.text) {
  fullResponse += data.delta.text;
}

// Turn 2: Ask Claude to generate image
const imageRequestText = `Please use the mcp__image-gen__generate_image tool to create an image based on the user's request.

Use these exact parameters:
- prompt: based on the user's request for the image
- model: "${imageModel || 'dall-e-2'}"
- size: "${imageSize || '256x256'}"
- filename: "${imageFilename}"
- include_base64: false

Only call the tool, no additional response needed.`;
```

### Critical Points
- **MUST include `--input-format stream-json`** for both new and resumed sessions
- Text from Turn 1 might be EMPTY (Claude may not generate text when just acknowledging an image request)
- Result includes: `{ success: true, text: fullResponse, imagePath: '/path/to/file.png' }`
- Bot-manager must check: `if (result.success && (result.text || result.imagePath || result.audioPath))`

---

## Key Differences: TTS vs Images

| Aspect | TTS | Images |
|--------|-----|--------|
| **Turn 1 Text** | Required (this is what gets converted to audio) | Optional (Claude might not respond with text) |
| **Turn 2 Input** | We pass Claude's exact text to TTS tool | Claude generates its own image prompt |
| **File Location** | `audio-output/bot-{id}/user-{id}/` | `image-output/bot-{id}/user-{id}/` |
| **File Extension** | `.mp3` | `.png` or `.jpg` |
| **MCP Tool** | `mcp__tts__text_to_speech` | `mcp__image-gen__generate_image` |
| **Result Validation** | MUST have `result.text` | Can have empty `result.text` |

---

## Common Implementation Pattern

Both flows share the same structure:

### 1. Command Building
```javascript
let cmd = claudeCmd;
if (sessionId) {
  cmd = `${claudeCmd} --ide --resume ${sessionId} --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions`;
} else {
  cmd = `${claudeCmd} --ide --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions`;
}
```

**Critical:** `--input-format stream-json` is required for BOTH new and resumed sessions.

### 2. File Naming
```javascript
// Pre-generate filename BEFORE calling tool
const filename = `bot-${botId}-user-${telegramUserId}-${Date.now()}`;
```

We pass this filename to the MCP tool, which appends its own timestamp:
- We pass: `bot-mattyatlas-user-7764813487-1761837889351`
- MCP creates: `bot-mattyatlas-user-7764813487-1761837889351-1761837902984.png`

### 3. File Finding
```javascript
const files = fs.readdirSync(outputDir)
  .filter(f => f.startsWith(expectedFilename) && f.endsWith('.ext'))
  .map(f => ({
    name: f,
    path: path.join(outputDir, f),
    time: fs.statSync(path.join(outputDir, f)).mtime
  }))
  .sort((a, b) => b.time - a.time);

if (files.length > 0) {
  const file = files[0]; // Get newest matching file
  // Move to organized location
}
```

### 4. Promise Resolution Guard
```javascript
let resolved = false;

// When resolving
resolved = true;
resolve({ success: true, text: fullResponse, filePath: path, metadata });

// In close handler
child.on('close', (code) => {
  if (!resolved && code !== 0) {
    reject({ success: false, error: `Process exited with code ${code}` });
  }
});
```

This prevents trying to reject an already-resolved Promise when the child process closes.

---

## Bot-Manager Integration

### Result Handling
```javascript
// Accept result if success AND has any output (text, image, or audio)
if (result.success && (result.text || result.imagePath || result.audioPath)) {
  let cleanResponse = result.text || ''; // Handle empty text for images

  // Check what we have
  const hasAudio = result.audioPath && result.audioPath !== null;
  const hasImageFrom2Turn = result.imagePath && result.imagePath !== null;

  // Send the appropriate output
  if (hasAudio) {
    await bot.sendVoice(chatId, result.audioPath);
  }
  if (hasImageFrom2Turn) {
    await bot.sendPhoto(chatId, result.imagePath);
  }
}
```

### Mode Detection

**TTS:** Always uses 2-turn flow when `tts.enabled === true` for the bot

**Images:** Only uses 2-turn flow when user's message contains image keywords:
```javascript
const isImageRequest = imageGenEnabled && (
  text.toLowerCase().includes('image') ||
  text.toLowerCase().includes('picture') ||
  text.toLowerCase().includes('photo') ||
  text.toLowerCase().includes('draw') ||
  text.toLowerCase().includes('generate') ||
  text.toLowerCase().includes('create a')
);
```

---

## Implementing New 2-Turn MCP Tools

To add a new tool that requires 2-turn flow:

### 1. Create the Function (in `lib/claude-client.js`)

Copy either `sendToClaudeWithTTS` or `sendToClaudeWithImage` as a template.

### 2. Key Things to Change
- Tool name in Turn 2 request
- File extension in file finding (`.mp3`, `.png`, `.pdf`, etc.)
- Output directory name
- Parameters passed to tool
- Whether Turn 1 text is required or optional

### 3. Update Bot-Manager (in `lib/bot-manager.js`)
- Add mode detection logic
- Call your new function
- Handle the result in the response section
- Update response type logging

### 4. Update Brain Configuration
```javascript
// In brains/yourbot.js
module.exports = {
  name: "YourBot",
  systemPrompt: "...",

  yourTool: {
    enabled: true,
    // tool-specific config
    sendTextToo: false  // Whether to also send text with the file
  }
};
```

---

## Troubleshooting

### "Claude error: undefined"
- Check if `result.text` is empty when it shouldn't be
- For images: this is normal, add `|| result.imagePath || result.audioPath` to validation

### "Image file organized" but no image sent
- Check bot-manager condition: must accept results with empty text
- Verify result validation allows `imagePath` without `text`

### "Process hangs after spawning"
- Missing `--input-format stream-json` flag
- Child process never sends output to stdout

### "Cannot read properties of undefined (reading 'length')"
- Trying to access `result.generatedImages.length` for 2-turn flow
- Should check `hasImageFrom2Turn` vs `hasImagesFrom1Turn`

### Duplicate Promise Resolution
- Add `resolved` flag to track state
- Check `!resolved` before rejecting in close handler

---

## File Organization

Both flows organize files into structured directories:

```
audio-output/
  bot-{botId}/
    user-{telegramUserId}/
      bot-{botId}-user-{telegramUserId}-{timestamp1}-{timestamp2}.mp3

image-output/
  bot-{botId}/
    user-{telegramUserId}/
      bot-{botId}-user-{telegramUserId}-{timestamp1}-{timestamp2}.png
```

This allows:
- Easy cleanup per bot
- Easy cleanup per user
- Chronological tracking
- Unique filenames (dual timestamp prevents collisions)

---

## Summary

**When to use 2-turn flow:**
- You need to suppress Claude's text response
- You want to send ONLY the tool output (file, data, etc.)
- The tool generates output files that need to be organized and sent

**Core pattern:**
1. Turn 1: Get Claude's understanding
2. Turn 2: Call MCP tool with that understanding
3. Find the generated file using our pre-generated filename prefix
4. Organize the file
5. Send ONLY the file to the user (optionally with text if configured)

**Both TTS and Image generation follow this exact pattern** - the only differences are:
- Which MCP tool is called
- Whether Turn 1 text is required
- File extensions and output directories
