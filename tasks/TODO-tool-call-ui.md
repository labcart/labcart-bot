# Tool Call UI Enhancement

## Current State
- TTS calls show "🎙️ Recording..." during generation ✅
- Image generation shows "🎨 Drawing..." during generation ✅
- Other tool calls show generic "🤔 Thinking..." state

## Opportunity
All tool calls appear in the stream with identifiable names:
- `<invoke name="WebSearch">` — web searches
- `<invoke name="mcp__tts__text_to_speech">` — audio generation
- `<invoke name="mcp__image-gen__generate_image">` — image generation
- `<invoke name="mcp__playwright__*">` — browser automation
- etc.

## Implementation Goal
Intercept tool call invocations in the stream and display contextual status messages:
- WebSearch → "🔍 Searching the web..."
- TTS → "🎙️ Recording..." ✅ (implemented via onTurn2Start callback)
- Image generation → "🎨 Drawing..." ✅ (implemented via onTurn2Start callback)
- Playwright actions → "🤖 Automating browser..."
- File operations → "📁 Reading/Writing files..."
- Bash commands → "⚙️ Running command..."

## Benefits
- Better user feedback and transparency
- Shows what's actually happening under the hood
- More polished UX

## Technical Approach
1. Parse streaming response for `<invoke name="...">` patterns
2. Map tool names to friendly UI strings
3. Display contextual status during tool execution
4. Clear status when `</invoke>` or results received
