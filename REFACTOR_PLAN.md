# Refactor Plan: Modular FastAPI Backend

## Problem

`WebSocketManager` currently owns too many responsibilities:
- WebSocket I/O (send/receive)
- Message routing (giant if/elif chain)
- Pipeline orchestration (start/stop/interrupt)
- STT callback handling
- LLM event forwarding (text chunks, stream start/stop)
- Audio streaming to client
- All CRUD operations for characters, voices, conversations, messages

This makes it hard to reason about the conversation turn lifecycle and difficult to modify the pipeline without touching unrelated code.

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────┐
│                   FastAPI App                        │
│                                                      │
│  /ws endpoint                                        │
│    │                                                 │
│    ▼                                                 │
│  WebSocketRouter                                     │
│    ├── routes text messages to handlers              │
│    ├── routes audio bytes to Transcribe              │
│    └── owns the WebSocket send function              │
│         │                                            │
│         ├── DB handlers (thin CRUD dispatch)         │
│         │                                            │
│         └── ConversationTurn (one per user turn)     │
│              ├── drives LLM streaming                │
│              ├── feeds sentence_queue                 │
│              ├── emits client events via callback     │
│              └── waitable / cancellable               │
│                                                      │
│  Speech (long-lived background worker, unchanged)    │
│    └── sentence_queue → audio_queue                  │
│                                                      │
│  AudioStreamer (long-lived background task)           │
│    └── audio_queue → websocket.send_bytes            │
└─────────────────────────────────────────────────────┘
```

### Core idea

**One `ConversationTurn` per user message.** It is a short-lived object that orchestrates a single request→response cycle. The `WebSocketRouter` creates one, awaits it, and can cancel it for interrupts.

---

## New Components

### 1. `ConversationTurn`

Replaces `get_user_message` loop + the callbacks threaded through `process_message_prompt`. A turn owns the full lifecycle of one user message through all responding characters.

```python
@dataclass
class ConversationTurn:
    """Orchestrates one user-message → character-responses cycle."""

    user_message: str
    chat: ChatLLM
    sentence_queue: asyncio.Queue
    send: Callable[[dict], Awaitable[None]]  # websocket send function

    async def run(self) -> None:
        """Execute the full turn. Cancel-safe."""

        responding = self.chat.parse_character_mentions(
            self.user_message, self.chat.active_characters
        )

        # Append user message to history + persist
        self.chat.conversation_history.append(
            {"role": "user", "name": "Jay", "content": self.user_message}
        )
        if self.chat.conversation_id:
            db.create_message_background(MessageCreate(
                conversation_id=self.chat.conversation_id,
                role="user", name="Jay", content=self.user_message,
            ))

        model_settings = self.chat.get_model_settings()

        for character in responding:
            message_id = str(uuid.uuid4())
            await self._run_character(character, message_id, model_settings)

    async def _run_character(self, character: Character, message_id: str,
                             model_settings: ModelSettings) -> None:
        """Stream one character's response: LLM → sentences → queue."""

        messages = self.chat.build_messages_for_character(character)

        # Notify client: text stream starting
        await self.send({
            "type": "text_stream_start",
            "data": {"character_id": character.id,
                     "character_name": character.name,
                     "message_id": message_id},
        })

        full_response = await self.chat.stream_character_response(
            messages=messages,
            character=character,
            message_id=message_id,
            model_settings=model_settings,
            sentence_queue=self.sentence_queue,
            on_text_chunk=self._on_text_chunk,
        )

        # Notify client: text stream done
        await self.send({
            "type": "text_chunk",
            "data": {"text": "", "character_id": character.id,
                     "character_name": character.name,
                     "message_id": message_id, "is_final": True},
        })
        await self.send({
            "type": "text_stream_stop",
            "data": {"character_id": character.id,
                     "character_name": character.name,
                     "message_id": message_id, "text": full_response},
        })

        # Update history + persist
        if full_response:
            wrapped = self.chat.wrap_character_tags(full_response, character.name)
            self.chat.conversation_history.append(
                {"role": "assistant", "name": character.name, "content": wrapped}
            )
            if self.chat.conversation_id:
                db.create_message_background(MessageCreate(
                    conversation_id=self.chat.conversation_id,
                    role="assistant", name=character.name,
                    content=full_response, character_id=character.id,
                ))

    async def _on_text_chunk(self, text: str, character: Character,
                             message_id: str) -> None:
        await self.send({
            "type": "text_chunk",
            "data": {"text": text, "character_id": character.id,
                     "character_name": character.name,
                     "message_id": message_id, "is_final": False},
        })
```

**Why this matters for latency:** Nothing changes about the streaming itself. LLM chunks still flow token-by-token into `generate_sentences_async`, sentences still go into `sentence_queue` immediately, and `Speech` picks them up concurrently. The only difference is *who creates and awaits* the work — a dedicated turn object instead of a callback spaghetti chain.

---

### 2. `AudioStreamer` (extracted from WebSocketManager)

A standalone async task that drains `audio_queue` and pushes to the websocket. Currently lives as `stream_audio_to_client` inside WebSocketManager — just pull it out as a function.

```python
async def audio_streamer(audio_queue: asyncio.Queue,
                         send_json: Callable[[dict], Awaitable[None]],
                         send_bytes: Callable[[bytes], Awaitable[None]],
                         get_sample_rate: Callable[[], int]) -> None:
    """Long-running task: drain audio_queue → websocket."""
    current_message_id: Optional[str] = None

    while True:
        try:
            chunk: AudioChunk = await asyncio.wait_for(audio_queue.get(), timeout=0.1)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            break

        if chunk.is_final:
            await send_json({
                "type": "audio_stream_stop",
                "data": {"character_id": chunk.character_id,
                         "character_name": chunk.character_name,
                         "message_id": chunk.message_id},
            })
            current_message_id = None
            continue

        if current_message_id != chunk.message_id:
            await send_json({
                "type": "audio_stream_start",
                "data": {"character_id": chunk.character_id,
                         "character_name": chunk.character_name,
                         "message_id": chunk.message_id,
                         "sample_rate": get_sample_rate()},
            })
            current_message_id = chunk.message_id

        await send_json({
            "type": "audio_chunk",
            "data": {"character_id": chunk.character_id,
                     "character_name": chunk.character_name,
                     "message_id": chunk.message_id,
                     "sentence_index": chunk.sentence_index,
                     "chunk_index": chunk.chunk_index},
        })
        await send_bytes(chunk.audio_bytes)
```

---

### 3. `WebSocketRouter` (replaces WebSocketManager)

Slim class that holds the websocket, dispatches messages, and manages the current turn.

```python
class WebSocketRouter:
    """Routes WebSocket messages and manages the active conversation turn."""

    def __init__(self, transcribe: Transcribe, chat: ChatLLM,
                 speech: Speech, queues: PipeQueues):
        self.transcribe = transcribe
        self.chat = chat
        self.speech = speech
        self.queues = queues

        self.websocket: Optional[WebSocket] = None
        self._current_turn: Optional[asyncio.Task] = None
        self._audio_task: Optional[asyncio.Task] = None
        self._turn_queue: asyncio.Queue[str] = asyncio.Queue()
        self._turn_loop_task: Optional[asyncio.Task] = None

    # -- connection lifecycle --

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.websocket = websocket
        await self.chat.start_new_chat()
        await self.speech.start()
        self._audio_task = asyncio.create_task(
            audio_streamer(self.queues.audio_queue, self.send_json,
                           self._send_bytes, self._sample_rate)
        )
        self._turn_loop_task = asyncio.create_task(self._turn_loop())

    async def disconnect(self):
        self.transcribe.stop_listening()
        await self._cancel_current_turn()
        for task in (self._audio_task, self._turn_loop_task):
            if task and not task.done():
                task.cancel()
                try: await task
                except asyncio.CancelledError: pass
        await self.speech.stop()
        self.websocket = None

    # -- message dispatch --

    async def handle_text(self, raw: str):
        data = json.loads(raw)
        msg_type = data.get("type", "")
        payload = data.get("data", {})

        handler = self._HANDLERS.get(msg_type)
        if handler:
            await handler(self, payload)
        elif msg_type.startswith(("get_", "create_", "update_", "delete_")):
            await handle_db_message(msg_type, payload, self.send_json)

    async def handle_audio(self, audio_bytes: bytes):
        self.transcribe.feed_audio(audio_bytes)

    # -- pipeline handlers (registered in _HANDLERS) --

    async def _handle_user_message(self, payload: dict):
        text = payload.get("text", "")
        if text.strip():
            await self._turn_queue.put(text)

    async def _handle_interrupt(self, _payload: dict):
        await self._cancel_current_turn()
        clear_queue(self.queues.transcribe_queue)
        clear_queue(self.queues.sentence_queue)
        clear_queue(self.queues.audio_queue)
        await self.send_json({"type": "interrupt_ack"})

    async def _handle_start_listening(self, _p: dict):
        self.transcribe.start_listening()

    async def _handle_stop_listening(self, _p: dict):
        self.transcribe.stop_listening()

    async def _handle_model_settings(self, payload: dict):
        self.chat.set_model_settings(ModelSettings(
            model=payload.get("model", "meta-llama/llama-3.1-8b-instruct"),
            temperature=float(payload.get("temperature", 0.7)),
            top_p=float(payload.get("top_p", 0.9)),
            min_p=float(payload.get("min_p", 0.0)),
            top_k=int(payload.get("top_k", 40)),
            frequency_penalty=float(payload.get("frequency_penalty", 0.0)),
            presence_penalty=float(payload.get("presence_penalty", 0.0)),
            repetition_penalty=float(payload.get("repetition_penalty", 1.0)),
        ))

    async def _handle_clear_history(self, _p: dict):
        self.chat.clear_conversation_history()
        await self.chat.start_new_chat()
        await self.send_json({"type": "history_cleared"})

    async def _handle_refresh_characters(self, _p: dict):
        self.chat.active_characters = await self.chat.get_active_characters()

    _HANDLERS = {
        "ping":                      lambda self, p: self.send_json({"type": "pong"}),
        "user_message":              _handle_user_message,
        "start_listening":           _handle_start_listening,
        "stop_listening":            _handle_stop_listening,
        "model_settings":            _handle_model_settings,
        "clear_history":             _handle_clear_history,
        "interrupt":                 _handle_interrupt,
        "refresh_characters":        _handle_refresh_characters,
        "refresh_active_characters": _handle_refresh_characters,
    }

    # -- turn loop --

    async def _turn_loop(self):
        """Sequentially process user messages via ConversationTurn."""
        while True:
            try:
                user_message = await self._turn_queue.get()
            except asyncio.CancelledError:
                break

            turn = ConversationTurn(
                user_message=user_message,
                chat=self.chat,
                sentence_queue=self.queues.sentence_queue,
                send=self.send_json,
            )
            self._current_turn = asyncio.create_task(turn.run())
            try:
                await self._current_turn
            except asyncio.CancelledError:
                pass
            self._current_turn = None

    async def _cancel_current_turn(self):
        if self._current_turn and not self._current_turn.done():
            self._current_turn.cancel()
            try: await self._current_turn
            except asyncio.CancelledError: pass

    # -- send helpers --

    async def send_json(self, data: dict):
        if self.websocket:
            await self.websocket.send_text(json.dumps(data))

    async def _send_bytes(self, data: bytes):
        if self.websocket:
            await self.websocket.send_bytes(data)

    def _sample_rate(self) -> int:
        return self.speech.sample_rate if self.speech else 24000
```

---

### 4. `handle_db_message` (extracted CRUD dispatch)

All the character/voice/conversation/message CRUD handlers pulled out of the class into a single function. This is ~200 lines of mechanical dispatch that doesn't belong in the router.

```python
async def handle_db_message(msg_type: str, payload: dict,
                            send: Callable[[dict], Awaitable[None]]) -> None:
    """Dispatch CRUD operations. Keeps WebSocketRouter clean."""
    try:
        if msg_type == "get_characters":
            characters = await db.get_all_characters()
            await send({"type": "characters_data",
                        "data": [c.model_dump() for c in characters]})

        elif msg_type == "create_character":
            c = await db.create_character(CharacterCreate(**payload))
            await send({"type": "character_created", "data": c.model_dump()})

        # ... same pattern for all other CRUD ops ...

    except HTTPException as e:
        await send({"type": "db_error", "error": e.detail})
```

This could also be a dict-based dispatch table mapping message types to `(db_method, response_type)` tuples to eliminate the repetition entirely, but the straightforward approach is fine for now.

---

## What Stays the Same

| Component | Changes? | Notes |
|-----------|----------|-------|
| `Transcribe` | No | Already well-isolated. Feeds `_turn_queue` via callback. |
| `ChatLLM` | Minor | Remove `process_message_prompt` — that logic moves to `ConversationTurn`. Keep `stream_character_response`, `build_messages_for_character`, history management, etc. |
| `Speech` | No | Already a clean queue consumer. |
| `PipeQueues` | No | Unchanged. |
| Data classes (`TTSSentence`, `AudioChunk`, `ModelSettings`) | No | Unchanged. |
| `revert_delay_pattern` | No | Standalone function, stays as-is. |

---

## What Changes in `ChatLLM`

Remove `process_message_prompt`. That method currently:
1. Appends user message to history
2. Persists to DB
3. Parses mentions → character order
4. Loops over characters, calling `stream_character_response`
5. Fires callbacks (on_text_stream_start/stop)
6. Appends assistant messages to history
7. Persists assistant messages

All of that becomes `ConversationTurn.run()` and `_run_character()`. `ChatLLM` keeps:
- `stream_character_response` (the actual LLM streaming + sentence extraction)
- `build_messages_for_character`
- `parse_character_mentions`
- `conversation_history` and `conversation_id` state
- `wrap_character_tags`
- Model settings

---

## Streaming / Latency Analysis

The current pipeline has three concurrent stages connected by queues:

```
[LLM tokens] → generate_sentences_async → sentence_queue → [Speech worker] → audio_queue → [AudioStreamer] → websocket
```

**Nothing in this refactor changes the concurrency model.** The three stages still run as independent async tasks/loops connected by the same `asyncio.Queue` instances. The only structural change is *who starts* the LLM streaming:

- **Before:** `get_user_message` loop → `process_message_prompt` → `stream_character_response`
- **After:** `_turn_loop` → `ConversationTurn.run()` → `stream_character_response`

Same call depth, same async flow, same queues. No additional awaits or synchronization points in the hot path.

---

## Interrupt Handling

Currently: cancel tasks, clear queues, restart pipeline.

After refactor: cancel `_current_turn` task only. `Speech` worker and `AudioStreamer` are long-lived and don't need restart — just clear the queues. This is simpler and faster.

```python
async def _handle_interrupt(self, _payload: dict):
    await self._cancel_current_turn()
    clear_queue(self.queues.sentence_queue)
    clear_queue(self.queues.audio_queue)
    await self.send_json({"type": "interrupt_ack"})
```

---

## File Layout (Optional)

If you want to split into multiple files later:

```
backend/
├── fastserver.py          # FastAPI app, lifespan, /ws endpoint
├── router.py              # WebSocketRouter
├── turn.py                # ConversationTurn
├── chat.py                # ChatLLM
├── speech.py              # Speech + audio_streamer
├── transcribe.py          # Transcribe
├── db_handlers.py         # handle_db_message
├── models.py              # TTSSentence, AudioChunk, ModelSettings, PipeQueues
├── database_director.py   # (existing)
└── stream2sentence.py     # (existing)
```

This is optional. Everything can stay in one file during the refactor and be split later.

---

## Migration Steps

1. **Add `ConversationTurn`** — new class, no existing code modified yet.
2. **Add `audio_streamer` function** — extract from `WebSocketManager.stream_audio_to_client`.
3. **Add `handle_db_message` function** — extract CRUD dispatch.
4. **Create `WebSocketRouter`** — wire up to existing `Transcribe`, `ChatLLM`, `Speech`.
5. **Remove `process_message_prompt` from `ChatLLM`** — the turn object now owns that logic.
6. **Delete `WebSocketManager`** — replaced by `WebSocketRouter`.
7. **Update lifespan + `/ws` endpoint** to use the new router.
8. **Test end-to-end** — voice turn, text turn, interrupt, CRUD operations.

Each step is independently testable. Steps 1–3 are pure additions with no breakage.

---

## Open Questions

1. **STT callback routing:** Currently `on_transcription_finished` puts text into `transcribe_queue`, which feeds `get_user_message`. In the new design it should put into `_turn_queue` on the router. Do you want the Transcribe callbacks to target the router directly, or keep an intermediate queue?

2. **`_suppress_audio` flag:** This is set during interrupts but the current logic around it seems incomplete (set to `False` on init/interrupt, never set to `True`). Should we drop it or is there planned usage?

3. **Multi-file split:** Do you want to split into separate files as part of this refactor, or keep everything in `fastserver.py` first and split later?
