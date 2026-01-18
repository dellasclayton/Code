# Frontend Code Analysis

Scope: frontend JavaScript modules and `frontend/index.html` (CSS excluded).

## frontend/characterCache.js
Overview: In-memory cache for characters and voices with optimistic updates and a small event emitter.

Notable functions:
- `CharacterCache.initialize`: Loads characters and voices from `db.js` in parallel, populates the cache, emits `cache:initialized`.
- `CharacterCache.getAll`: Returns cached characters and voices as arrays.
- `CharacterCache.getCharacter` / `getAllCharacters`: Read helpers for characters.
- `CharacterCache.getVoice` / `getAllVoices`: Read helpers for voices.
- `CharacterCache.createCharacter`: Creates a character via DB, updates cache, emits `character:created`.
- `CharacterCache.updateCharacter`: Optimistic update with rollback; emits `character:updated` and `character:updated:confirmed`.
- `CharacterCache.deleteCharacter`: Optimistic delete with rollback; emits `character:deleted` and `character:deleted:confirmed`.
- `CharacterCache.createVoice`: Creates voice via DB, updates cache, emits `voice:created`.
- `CharacterCache.updateVoice`: Optimistic update with optional rename; updates affected characters; emits `voice:updated` and `voice:updated:confirmed`.
- `CharacterCache.deleteVoice`: Optimistic delete with rollback; clears voice for affected characters; emits `voice:deleted`.
- `CharacterCache.refresh`: Full refresh from DB with cache rebuild; emits `cache:refreshed`.
- `CharacterCache.on` / `off` / `emit`: Lightweight event system.
- `CharacterCache.clear` / `getStats`: Cache maintenance helpers.

Outcome and effectiveness:
- Positive: The optimistic flow keeps the UI fast and responsive and centralizes DB writes.
- Concern: The cache is a class, which is at odds with the functional style guidance. The event system is minimal but ad hoc.
- Efficiency: Rebuilding arrays for each `getAll` is fine at this scale; update logic is O(n) for voice rename/delete.

## frontend/characters.js
Overview: Characters UI with modal editing, search, active list, and notifications; uses `characterCache`.

Notable functions:
- `initCharacters`: Initializes UI, cache handlers, and loads data.
- `loadData`: Initializes cache if needed; populates `characters`/`voices` and renders lists.
- `setupCacheEventHandlers`: Reacts to cache events to re-render UI.
- `createNotificationContainer`: Creates a shared notification container in DOM.
- `showLoadingState`: Inserts a loading card while data loads.
- `populateVoiceDropdown`: Fills the voice dropdown from cache.
- `setupEventListeners`: Wires UI actions for search, modal, file upload, save/delete, and tab switching.
- `renderCharacterGrid`: Renders filtered grid cards or empty states.
- `renderActiveCharacterList`: Renders active character list or empty state.
- `createCharacterCard`: Builds a single grid card; toggles active state.
- `createActiveCharacterItem`: Builds a single active list item; toggles active state.
- `getFilteredCharacters`: Filters by name/system prompt.
- `getCharacterInitials`: Builds initials for placeholders.
- `filterCharacters`: Updates the search query and re-renders.
- `openCharacterModal`: Loads character data into modal and handles transitions.
- `showCharacterModal` / `hideCharacterModal`: Modal visibility and state resets.
- `updateModalChatButtonState`: Syncs chat button state with active character state.
- `loadCharacterData`: Populates modal fields and avatar preview.
- `handleImageUpload`: Reads image file and stores base64 data as `image_url`.
- `switchTab`: Handles tab switching and layout toggles.
- `saveCharacter`: Validates and creates/updates via cache; shows notifications.
- `deleteCharacter`: Deletes via cache with confirm and UI feedback.
- `handleChatWithCharacter`: Toggles active state for current character.
- `updateCharacterActiveState`: Updates active state and notifies server via websocket.
- `getCharacters` / `getSelectedCharacter`: Read helpers.
- `showNotification` / `removeNotification`: Notification UI.

Outcome and effectiveness:
- Positive: Cache events keep UI consistent and fast; UI flows are clear.
- Concern: This file is large and handles UI rendering, notifications, cache orchestration, and websocket triggers in one module.
- Efficiency: Full re-render on every cache event is simple but potentially wasteful if character counts grow.
- Maintenance: There is a large block of commented-out voice-related code and unused `voiceData` in new character defaults.
- Data: `image_url` stores base64 data; confirm whether the backend expects URLs or accepts base64 payloads.

## frontend/chat.js
Overview: Chat UI, streaming LLM responses, STT preview, and conversation state.

Notable functions:
- `initChat`: Subscribes to websocket messages and loads active characters.
- `loadActiveCharacters`: Populates `state.activeCharacters` from cache.
- `handleServerMessage`: Routes server message types.
- `handleResponseChunk`: Streams assistant response text into a message element.
- `updateSTTPreview`: Updates the live STT preview bubble.
- `createSTTPreviewElement` / `removeSTTPreview`: Manages preview UI.
- `finalizeUserMessage`: Converts final STT text into a user message.
- `addUserMessage`: Appends a user message to the chat.
- `createAssistantMessageElement`: Creates assistant message container with avatar.
- `renderMessageContent`: Basic markdown-like rendering.
- `sendMessage`: Adds user message then sends to server.
- `clearChat`: Clears UI and local conversation state, sends `clear_history`.
- `getConversation`: Returns conversation history.
- `setTypingIndicator` / `createTypingIndicator`: Typing UI.
- `getMessagesArea` / `scrollToBottom` / `escapeHtml` / `formatTime`: Utilities.
- `refreshCharacters`: Reloads active characters.

Outcome and effectiveness:
- Positive: Streaming flow is straightforward and easy to follow.
- Concern: `activeCharacters` only loads once unless `refreshCharacters` is called; there is no direct hook from character changes, so avatars can go stale.
- Risk: Mapping active characters by both id and name can collide if names are not unique.
- Rendering: Regex-based markdown is minimal and can mis-handle nested patterns; acceptable for simple formatting.

## frontend/db.js
Overview: Promise-based WebSocket DB request wrapper.

Notable functions:
- `ensureListener`: Registers a single websocket listener for DB responses.
- `request`: Sends a request and resolves on a matching response type or timeout.
- `getCharacters` / `getCharacter` / `createCharacter` / `updateCharacter` / `deleteCharacter`.
- `getVoices` / `getVoice` / `createVoice` / `updateVoice` / `deleteVoice`.
- `getConversations` / `getConversation` / `createConversation` / `updateConversation` / `deleteConversation`.
- `getMessages` / `createMessage` / `deleteMessage`.
- `handleDbError`: Converts error messages into user-friendly strings.

Outcome and effectiveness:
- Positive: Simple, consistent API for DB reads/writes.
- Concern: `pendingRequests` is keyed by `responseType`, so concurrent requests of the same type can collide or resolve the wrong promise.
- Risk: `db_error` handling rejects the most recent pending request, which can mismatch the failing request.

## frontend/editor.js
Overview: Tiptap editor setup, toolbar UI, and mic/send controls.

Notable functions:
- `initEditor`: Initializes Tiptap editor, toolbar, and global click handling.
- `createToolbar`: Builds toolbar UI from a config array.
- `createButton` / `createDropdown` / `createColorPicker` / `createLinkButton`: UI factory helpers.
- `updateToolbar`: Rebuilds toolbar to reflect current state.
- `addImage`: Prompts for image URL and inserts it.
- `handleMic`: Initializes audio capture and toggles STT.
- `updateMicButtonState`: Updates mic button CSS state.
- `handleSend`: Sends editor text via chat and clears editor.
- `getEditor` / `getEditorContent` / `setEditorContent` / `clearEditorContent`: Editor accessors.

Outcome and effectiveness:
- Positive: Toolbar creation is data-driven and readable.
- Concern: `updateToolbar` rebuilds the entire toolbar on each action; fine now but heavy if the toolbar grows.
- Risk: CDN imports for Tiptap modules are not pinned; this can break builds or behavior unpredictably.

## frontend/index.html
Overview: App shell, sidebar navigation, and links to modules and styles.

Notable elements:
- Loads Tailwind and Preline via CDN.
- Mounts `main.js` as module entrypoint.
- Defines sidebar layout and an empty `.content-area` for dynamic page content.

Outcome and effectiveness:
- Positive: Simple static shell; easy to understand.
- Concern: Heavy reliance on dynamic HTML injection from `main.js` makes this file minimal but pushes a lot of DOM structure into JS strings.

## frontend/main.js
Overview: Router-like page loader, sidebar behavior, model settings UI, and chat system bootstrap.

Notable functions:
- `initSidebar`: Collapse state and persistence.
- `initNavigation`: Handles navigation clicks, hash routing, and back/forward.
- `loadPage`: Injects large HTML templates for each page, initializes page-specific modules.
- `initDrawer` / `initInfoDrawer`: Toggle drawers and persist state.
- `formatModelName`: Formats model IDs for display.
- `fetchOpenRouterModels`: Fetches model list from OpenRouter.
- `initModelSettings`: Loads settings, dropdown, and slider handlers.
- `initModelDropdown`: Builds model dropdown and selection persistence.
- `initSliders`: Wires slider inputs to localStorage.
- `loadSettings` / `saveSettings`: Persist settings and sync to server.
- `initChatSystem`: Orchestrates TTS, WebSocket connect, and chat UI.
- `syncModelSettings`: Sends model settings to backend.

Outcome and effectiveness:
- Positive: Single entrypoint controls navigation and app boot sequence.
- Concern: `loadPage` contains very large HTML template strings, mixing markup and logic; changes are harder to diff and test.
- Risk: `fetchOpenRouterModels` uses a placeholder API key and runs client-side; this is not secure for real keys.
- Fragility: Page init uses `setTimeout` to wait for DOM injection; this can race with slower devices.

## frontend/speech.js
Overview: Voice management UI (create/update/delete) with cache integration.

Notable functions:
- `initSpeech`: One-time init for events, cache handlers, and voice list.
- `cacheButtonTemplates`: Preserves button HTML for restore.
- `ensureWebSocketConnected`: Connects if needed before DB use.
- `loadVoices`: Pulls voices from cache and renders.
- `setupCacheEventHandlers`: Keeps voice list in sync with cache.
- `setupEventListeners`: Wires radio buttons and create/delete/new buttons.
- `handleMethodChange`: Enables/disables fields based on method.
- `renderVoiceList`: Renders the voice directory.
- `setSelectedVoice`: Populates form from selected voice.
- `resetForm`: Clears form for new voice.
- `updateFormButtons`: Updates button state for edit vs create.
- `handleSaveVoice`: Validates and creates/updates via cache.
- `handleDeleteVoice`: Deletes voice via cache and resets UI.
- `createNotificationContainer` / `showNotification`: Notification UI.

Outcome and effectiveness:
- Positive: Clear flow for create/edit/delete and form state.
- Concern: Notification UI is duplicated with `characters.js` rather than shared.
- Behavior: `ensureWebSocketConnected` is defensive but may mask dependency on main app initialization.

## frontend/stt-audio.js
Overview: Microphone capture and streaming audio to server over WebSocket.

Notable functions:
- `initAudioCapture`: Creates audio context and loads the AudioWorklet.
- `startRecording`: Gets mic access, sets up worklet, streams PCM16 to server.
- `stopRecording`: Stops capture and notifies server.
- `cleanup`: Tears down nodes and tracks.
- `onStateChange` / `setState`: Simple state machine for UI updates.
- `getRecordingState` / `getStatus`: State getters.
- `setTTSPlaying`: Hook for echo suppression (currently logging).
- `destroy`: Full teardown of audio context.

Outcome and effectiveness:
- Positive: Clear capture pipeline with worklet downsampling.
- Concern: `startRecording` does not enforce an active websocket connection; if disconnected, audio is dropped.

## frontend/stt-processor.js
Overview: AudioWorklet for downsampling 48kHz to 16kHz PCM16.

Notable functions:
- `STTProcessor.process`: Downsamples using linear interpolation, emits 20ms PCM16 chunks.
- `registerProcessor`: Registers worklet by name.

Outcome and effectiveness:
- Positive: Simple and correct downsample for realtime STT.

## frontend/tts-audio.js
Overview: TTS audio playback, buffering, and coordination with STT.

Notable functions:
- `initTTSPlayback`: Initializes AudioContext, gain, and websocket subscriptions.
- `queueAudioChunk`: Converts PCM16 to AudioBuffer and queues for playback.
- `play` / `playNextChunk`: Handles buffered playback.
- `stop` / `pause` / `resume`: Playback controls and interrupt behavior.
- `isPlaying`: Playback state accessor.
- `setVolume` / `getVolume`: Volume control.
- `onPlaybackChange` / `onSpeakerChange`: Event subscriptions.
- `clearQueue` / `getStatus` / `cleanup`: Queue and lifecycle helpers.
- `int16ToFloat32`: Conversion utility.

Outcome and effectiveness:
- Positive: Simple queue-based playback with minimum buffer to reduce stutter.
- Concern: PCM16 conversion occurs on the main thread; acceptable for small loads but could become heavy with long TTS streams.

## frontend/websocket.js
Overview: WebSocket connection, reconnection, heartbeat, and message routing.

Notable functions:
- `connect` / `disconnect`: Connection lifecycle.
- `scheduleReconnect`: Exponential backoff reconnect.
- `startHeartbeat` / `stopHeartbeat` / `handlePong`: Connection health.
- `handleMessage`: Routes JSON messages vs binary audio.
- `sendText` / `sendAudio`: Low-level send helpers.
- `onMessage` / `onAudio` / `onConnectionChange`: Event subscriptions.
- `isConnected` / `getStatus` / `getState`: State helpers.
- Convenience messages: `sendUserMessage`, `startListening`, `stopListening`, `sendInterrupt`, `clearHistory`, `refreshActiveCharacters`, `updateModelSettings`, `setCharacters`.

Outcome and effectiveness:
- Positive: Heartbeat with pong timeout is a good reliability guard.
- Concern: `disconnect` sets `config.reconnect = false` permanently for the module unless manually reset.

## Attention Plan (what needs review or change)
1) Fix DB request correlation in `frontend/db.js` (`request`, `ensureListener`). The current Map is keyed by response type, so concurrent requests of the same type can collide or resolve the wrong promise. Proposal: add a `request_id` to every DB message, track by ID, and include it in server responses. This will also fix the ambiguous `db_error` handling.
2) Align cache module with functional style guidance. `frontend/characterCache.js` is class-based; decide if you want to keep it as-is or refactor into pure functions with closures. If refactoring, plan to adjust imports in `frontend/characters.js` and `frontend/speech.js`.
3) Make chat avatars reactive to character changes. `frontend/chat.js` only loads active characters once; `refreshCharacters` is not wired. Add a cache event hook or call `chat.refreshCharacters()` from `frontend/characters.js` after `updateCharacterActiveState`, or listen for a server message that carries active character updates.
4) Unify notifications. `showNotification` and container setup are duplicated in `frontend/characters.js` and `frontend/speech.js`. Consider a shared `frontend/notifications.js` module to keep style and behavior consistent.
5) Decide how to handle character images. `handleImageUpload` stores base64 data in `image_url`. If this should be a URL or a stored file, plan a new upload flow (local file storage or server upload) and keep `image_url` for URLs only.
6) Replace or secure OpenRouter model fetching. `frontend/main.js` uses a placeholder API key and fetches directly from the client. If real models are needed, move this to the backend or allow the user to set the key locally with clear UX. Otherwise remove or stub the dropdown.
7) Reduce fragility in `loadPage`. `frontend/main.js` injects very large HTML strings and uses `setTimeout` for initialization. Consider moving templates to `<template>` tags in `frontend/index.html` or separate partials, and initialize immediately after injection without arbitrary delays.
8) Prune or formalize commented-out blocks. `frontend/characters.js` has large commented voice creation and voice method logic. Either remove them or move them into `frontend/speech.js` where voice management now lives.

## Questions
- Should character images be stored as base64 strings in the DB, or should we implement a file/URL-based approach instead?
- Do you want to keep the class-based `CharacterCache`, or should I refactor it into a functional module?
- Should chat avatars update immediately when characters are toggled active/inactive, or is a manual refresh acceptable?
- Is the OpenRouter model dropdown intended to be functional in production, or is it a placeholder for now?
- Do you want voice creation to live only in the Speech page, or also in the Characters modal?
