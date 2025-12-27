# TODO - Add /restart Command to CartoonGen Bot

**Date:** 2025-10-30

## Objective
Add a user-facing `/restart` command specifically for the CartoonGen (cartooner) bot that clears conversation context and resets the session.

## Tasks

1. **Add restart flag to CartoonGen menu**
   - Update the menu system for cartooner brain
   - Add restart option that's visible to users

2. **Implement /restart command handler**
   - Create command handler for `/restart`
   - Command should clear conversation history
   - Reset session context for the user
   - Only active for CartoonGen bot (not other brains)

3. **User-facing behavior**
   - Send confirmation message when restart is triggered
   - Clear any image generation context/state
   - Reset to fresh conversation state

## Notes
- This is specifically for CartoonGen/cartooner brain only
- User-initiated action (not admin)
- Similar behavior to /start but preserves user identity
- Should work from both menu button and text command
