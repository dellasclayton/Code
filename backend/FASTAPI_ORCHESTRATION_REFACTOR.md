# FastAPI Pipeline Orchestration Refactor - Planning Document

## Problem Statement

The current `WebSocketManager` class in `fastserver.py` has grown to handle multiple responsibilities:
1. WebSocket connection lifecycle
2. Message routing and handling
3. Pipeline task creation and management
4. Event callbacks to clients
5. Component initialization

This makes it difficult to:
- Understand the pipeline flow at a glance
- Modify or extend pipeline stages
- Test individual components
- Reason about task lifetimes

## Goal

Create a dedicated orchestration layer that:
1. Centralizes all pipeline task management in one place
2. Makes the data flow explicit and easy to follow
3. Keeps the WebSocketManager focused on connection handling
4. Follows KISS/YAGNI - no unnecessary abstractions

---

## Current Architecture

```
WebSocketManager
├── initialize()           → creates Transcribe, ChatLLM, Speech
├── connect()              → calls start_pipeline()
├── start_pipeline()       → creates 2 asyncio tasks
│   ├── get_user_messages()      → reads transcribe_queue → calls ChatLLM
│   └── stream_audio_to_client() → reads audio_queue → sends to client
├── stop_pipeline()        → cancels tasks
├── handle_text_message()  → routes incoming messages
└── callbacks              → on_transcription_*, on_llm_*, on_audio_*
```

**Pain Points:**
- `start_pipeline()` only manages 2 of 3 pipeline stages (Speech.start() creates its own task)
- Task tracking is fragmented (`user_message_task`, `audio_streamer_task`, `speech._task`)
- No single view of "what's running"

---

## Proposed Architecture

### Option A: PipelineOrchestrator Class (Recommended)

A dedicated class that owns all pipeline tasks and provides clear lifecycle methods.

```python
class PipelineOrchestrator:
    """
    Coordinates the voice chat pipeline stages:

    [Audio In] → Transcribe → transcribe_queue
                                    ↓
                             get_user_messages (Task 1)
                                    ↓
                              ChatLLM.process_message_prompt
                                    ↓
                             sentence_queue
                                    ↓
                             Speech.process_sentences (Task 2)
                                    ↓
                             audio_queue
                                    ↓
                             stream_audio_to_client (Task 3)
                                    ↓
                             [Audio Out]
    """

    def __init__(self, queues: PipeQueues, websocket_sender: Callable):
        self.queues = queues
        self.send_to_client = websocket_sender

        # Pipeline components (set during initialization)
        self.transcribe: Optional[Transcribe] = None
        self.chat: Optional[ChatLLM] = None
        self.speech: Optional[Speech] = None

        # Task handles
        self._tasks: Dict[str, asyncio.Task] = {}
        self._running = False

    async def start(self):
        """Start all pipeline tasks"""
        if self._running:
            return

        self._running = True
        self._clear_all_queues()

        # Create all pipeline tasks in one place
        self._tasks = {
            "user_messages": asyncio.create_task(
                self._process_user_messages(),
                name="pipeline:user_messages"
            ),
            "tts_synthesis": asyncio.create_task(
                self._process_tts_synthesis(),
                name="pipeline:tts_synthesis"
            ),
            "audio_streaming": asyncio.create_task(
                self._stream_audio_to_client(),
                name="pipeline:audio_streaming"
            ),
        }

    async def stop(self):
        """Stop all pipeline tasks gracefully"""
        self._running = False

        for name, task in self._tasks.items():
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        self._tasks.clear()

    async def restart(self):
        """Restart pipeline (used for interrupts)"""
        await self.stop()
        self._clear_all_queues()
        await self.start()

    def _clear_all_queues(self):
        """Clear all pipeline queues"""
        for q in [self.queues.transcribe_queue,
                  self.queues.sentence_queue,
                  self.queues.audio_queue]:
            while not q.empty():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    break
```

### Option B: Functional Approach

If we prefer pure functions over classes (per CLAUDE.md guidance), we can use a module-level approach:

```python
# pipeline_orchestrator.py

_tasks: Dict[str, asyncio.Task] = {}
_running = False

async def start_pipeline(queues: PipeQueues, components: dict, callbacks: dict):
    """Start all pipeline tasks"""
    global _tasks, _running

    if _running:
        return

    _running = True
    clear_queues(queues)

    _tasks = {
        "user_messages": asyncio.create_task(
            process_user_messages(queues, components["chat"], callbacks)
        ),
        "tts_synthesis": asyncio.create_task(
            process_tts_synthesis(queues, components["speech"])
        ),
        "audio_streaming": asyncio.create_task(
            stream_audio_to_client(queues, callbacks)
        ),
    }

async def stop_pipeline():
    """Stop all pipeline tasks"""
    global _tasks, _running
    _running = False

    for task in _tasks.values():
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    _tasks.clear()
```

**Recommendation:** Go with **Option A** (class-based) because:
1. Pipeline state naturally groups together (tasks, running flag, queues)
2. Easier to have multiple independent pipelines if needed later
3. More explicit ownership of resources
4. Still simple - just one class with clear responsibilities

---

## Detailed Implementation Plan

### Step 1: Create PipelineOrchestrator Class

```python
# backend/pipeline_orchestrator.py

import asyncio
import logging
from typing import Dict, Optional, Callable, Awaitable, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class PipelineCallbacks:
    """Callbacks for pipeline events sent to the client"""
    on_transcription_update: Optional[Callable[[str], Awaitable[None]]] = None
    on_transcription_stabilized: Optional[Callable[[str], Awaitable[None]]] = None
    on_transcription_finished: Optional[Callable[[str], Awaitable[None]]] = None
    on_text_chunk: Optional[Callable[[str, Any, str], Awaitable[None]]] = None
    on_text_stream_start: Optional[Callable[[Any, str], Awaitable[None]]] = None
    on_text_stream_stop: Optional[Callable[[Any, str, str], Awaitable[None]]] = None
    on_audio_stream_start: Optional[Callable[[Any], Awaitable[None]]] = None
    on_audio_stream_stop: Optional[Callable[[Any], Awaitable[None]]] = None
    send_audio_chunk: Optional[Callable[[Any], Awaitable[None]]] = None


class PipelineOrchestrator:
    """
    Orchestrates the voice chat pipeline.

    Data Flow:
    ─────────

    [Microphone] ──→ Transcribe ──→ transcribe_queue
                                          │
                    ┌─────────────────────┘
                    ▼
              Task: process_user_messages
                    │
                    ▼
              ChatLLM.process_message_prompt ──→ sentence_queue
                                                      │
                    ┌─────────────────────────────────┘
                    ▼
              Task: process_tts_synthesis (Speech)
                    │
                    ▼
              audio_queue
                    │
                    ▼
              Task: stream_audio_to_client ──→ [Speaker]

    """

    def __init__(
        self,
        queues: 'PipeQueues',
        transcribe: 'Transcribe',
        chat: 'ChatLLM',
        speech: 'Speech',
        callbacks: PipelineCallbacks,
    ):
        self.queues = queues
        self.transcribe = transcribe
        self.chat = chat
        self.speech = speech
        self.callbacks = callbacks

        # Task registry
        self._tasks: Dict[str, asyncio.Task] = {}
        self._running = False
        self._suppress_audio = False

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def active_tasks(self) -> Dict[str, bool]:
        """Return status of each pipeline task"""
        return {
            name: (task is not None and not task.done())
            for name, task in self._tasks.items()
        }

    async def start(self):
        """
        Start the complete pipeline.

        Creates three concurrent tasks:
        1. process_user_messages - Reads transcriptions, sends to LLM
        2. process_tts_synthesis - Converts LLM sentences to audio
        3. stream_audio_to_client - Sends audio chunks to client
        """
        if self._running:
            logger.warning("Pipeline already running")
            return

        self._running = True
        self._suppress_audio = False
        self._clear_all_queues()

        # Create all tasks
        self._tasks = {
            "user_messages": asyncio.create_task(
                self._process_user_messages(),
                name="pipeline:user_messages"
            ),
            "tts_synthesis": asyncio.create_task(
                self._process_tts_synthesis(),
                name="pipeline:tts_synthesis"
            ),
            "audio_streaming": asyncio.create_task(
                self._stream_audio_to_client(),
                name="pipeline:audio_streaming"
            ),
        }

        logger.info("Pipeline started with 3 tasks")

    async def stop(self):
        """Stop all pipeline tasks gracefully"""
        if not self._running:
            return

        self._running = False

        # Cancel all tasks
        for name, task in self._tasks.items():
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    logger.debug(f"Task {name} cancelled")

        self._tasks.clear()
        logger.info("Pipeline stopped")

    async def restart(self):
        """Restart pipeline - used for interrupts"""
        await self.stop()
        self._clear_all_queues()
        await self.start()

    def suppress_audio(self):
        """Suppress audio output (e.g., during barge-in)"""
        self._suppress_audio = True

    def unsuppress_audio(self):
        """Resume audio output"""
        self._suppress_audio = False

    # ─────────────────────────────────────────────────────────────
    # Pipeline Task Implementations
    # ─────────────────────────────────────────────────────────────

    async def _process_user_messages(self):
        """
        Task 1: Read user messages from transcribe_queue and process through LLM.

        Produces: Sentences to sentence_queue (via ChatLLM)
        """
        while self._running:
            try:
                user_message: str = await self.queues.transcribe_queue.get()

                if user_message and user_message.strip():
                    await self.chat.process_message_prompt(
                        user_message=user_message,
                        sentence_queue=self.queues.sentence_queue,
                        on_text_chunk=self.callbacks.on_text_chunk,
                        on_text_stream_start=self.callbacks.on_text_stream_start,
                        on_text_stream_stop=self.callbacks.on_text_stream_stop,
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing user message: {e}")

    async def _process_tts_synthesis(self):
        """
        Task 2: Read sentences from sentence_queue and synthesize audio.

        Consumes: TTSSentence from sentence_queue
        Produces: AudioChunk to audio_queue
        """
        while self._running:
            try:
                sentence = await asyncio.wait_for(
                    self.queues.sentence_queue.get(),
                    timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            # Handle end-of-message sentinel
            if sentence.is_final:
                await self.queues.audio_queue.put(AudioChunk(
                    audio_bytes=b"",
                    sentence_index=sentence.index,
                    chunk_index=0,
                    message_id=sentence.message_id,
                    character_id=sentence.character_id,
                    character_name=sentence.character_name,
                    is_final=True,
                ))
                continue

            # Generate audio for sentence
            chunk_index = 0
            try:
                async for pcm_bytes in self.speech.generate_audio_for_sentence(
                    sentence.text,
                    sentence.voice_id
                ):
                    await self.queues.audio_queue.put(AudioChunk(
                        audio_bytes=pcm_bytes,
                        sentence_index=sentence.index,
                        chunk_index=chunk_index,
                        message_id=sentence.message_id,
                        character_id=sentence.character_id,
                        character_name=sentence.character_name,
                        is_final=False,
                    ))
                    chunk_index += 1
            except Exception as e:
                logger.error(f"TTS error for sentence {sentence.index}: {e}")

    async def _stream_audio_to_client(self):
        """
        Task 3: Read audio chunks from audio_queue and send to client.

        Consumes: AudioChunk from audio_queue
        Produces: WebSocket messages to client
        """
        current_message_id: Optional[str] = None

        while self._running:
            try:
                chunk = await asyncio.wait_for(
                    self.queues.audio_queue.get(),
                    timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            # Handle end-of-message
            if chunk.is_final:
                if self.callbacks.on_audio_stream_stop:
                    await self.callbacks.on_audio_stream_stop(chunk)
                current_message_id = None
                self._suppress_audio = False
                continue

            # Send stream start for new message
            if current_message_id != chunk.message_id:
                if self.callbacks.on_audio_stream_start:
                    await self.callbacks.on_audio_stream_start(chunk)
                current_message_id = chunk.message_id

            # Send audio (unless suppressed)
            if not self._suppress_audio and self.callbacks.send_audio_chunk:
                await self.callbacks.send_audio_chunk(chunk)

    # ─────────────────────────────────────────────────────────────
    # Utility Methods
    # ─────────────────────────────────────────────────────────────

    def _clear_all_queues(self):
        """Clear all pipeline queues"""
        for queue in [
            self.queues.transcribe_queue,
            self.queues.sentence_queue,
            self.queues.audio_queue,
        ]:
            while True:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
```

### Step 2: Simplify Speech Class

Remove the internal task management from `Speech` since orchestrator handles it:

```python
class Speech:
    """Synthesizes sentences using Higgs Audio"""

    def __init__(self, queues: PipeQueues):
        self.queues = queues
        self.engine: Optional[HiggsAudioServeEngine] = None
        # Remove: self.is_running, self._task

        self.sample_rate = 24000
        self._chunk_size = 14
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self.generation_chunk_buffer_size = 2
        self._voice_context: Dict[str, Dict[str, Any]] = {}
        self.voice_dir = "/workspace/tts/Code/backend/voices"

    async def initialize(self):
        """Initialize the TTS engine"""
        self.engine = HiggsAudioServeEngine(...)
        logger.info("Higgs Audio TTS initialized")

    # Remove: start(), stop(), process_sentences()
    # Keep: generate_audio_for_sentence() - called by orchestrator

    async def generate_audio_for_sentence(self, text: str, voice: str) -> AsyncGenerator[bytes, None]:
        """Generate audio for text - unchanged from current implementation"""
        # ... existing code ...
```

### Step 3: Refactor WebSocketManager

Simplify to focus on connection handling and message routing:

```python
class WebSocketManager:
    """Manages WebSocket connections and routes messages"""

    def __init__(self):
        # Shared queues
        self.queues = PipeQueues()

        # Connection
        self.websocket: Optional[WebSocket] = None

        # Components (initialized in initialize())
        self.transcribe: Optional[Transcribe] = None
        self.chat: Optional[ChatLLM] = None
        self.speech: Optional[Speech] = None

        # Pipeline orchestrator (initialized in initialize())
        self.pipeline: Optional[PipelineOrchestrator] = None

        self.user_name = "Jay"

    async def initialize(self):
        """Initialize all components at startup"""
        api_key = os.getenv("OPENROUTER_API_KEY", "...")

        # Initialize components
        self.transcribe = Transcribe(
            on_transcription_update=self.on_transcription_update,
            on_transcription_stabilized=self.on_transcription_stabilized,
            on_transcription_finished=self.on_transcription_finished,
        )
        self.transcribe.set_event_loop(asyncio.get_event_loop())

        self.chat = ChatLLM(queues=self.queues, api_key=api_key)
        self.chat.active_characters = await self.chat.get_active_characters()

        self.speech = Speech(queues=self.queues)
        await self.speech.initialize()

        # Create orchestrator with callbacks
        callbacks = PipelineCallbacks(
            on_transcription_update=self.on_transcription_update,
            on_transcription_stabilized=self.on_transcription_stabilized,
            on_transcription_finished=self.on_transcription_finished,
            on_text_chunk=self.on_llm_text_chunk,
            on_text_stream_start=self.on_text_stream_start,
            on_text_stream_stop=self.on_text_stream_stop,
            on_audio_stream_start=self.on_audio_stream_start,
            on_audio_stream_stop=self.on_audio_stream_stop,
            send_audio_chunk=self.send_audio_chunk,
        )

        self.pipeline = PipelineOrchestrator(
            queues=self.queues,
            transcribe=self.transcribe,
            chat=self.chat,
            speech=self.speech,
            callbacks=callbacks,
        )

        logger.info(f"Initialized with {len(self.chat.active_characters)} active characters")

    async def connect(self, websocket: WebSocket):
        """Accept connection and start pipeline"""
        await websocket.accept()
        self.websocket = websocket

        if self.chat:
            await self.chat.start_new_chat()

        # Start pipeline via orchestrator
        await self.pipeline.start()

        logger.info("WebSocket connected, pipeline started")

    async def disconnect(self):
        """Clean up connection"""
        if self.transcribe:
            self.transcribe.stop_listening()

        if self.pipeline:
            await self.pipeline.stop()

        self.websocket = None

    async def handle_interrupt(self):
        """Handle user interrupt"""
        if self.pipeline:
            await self.pipeline.restart()
        await self.send_text_to_client({"type": "interrupt_ack"})

    # ... rest of message handling unchanged ...
```

---

## File Structure After Refactor

```
backend/
├── fastserver.py              # Slimmed down - WebSocketManager + FastAPI routes
├── pipeline_orchestrator.py   # NEW - PipelineOrchestrator class
├── pipeline_components.py     # Could extract: Transcribe, ChatLLM, Speech
├── data_types.py              # Could extract: TTSSentence, AudioChunk, etc.
└── database_director.py       # Unchanged
```

**Minimal approach** (recommended for now): Just add `pipeline_orchestrator.py` and refactor `fastserver.py`. Don't over-extract until needed.

---

## Migration Steps

### Phase 1: Add Orchestrator (Non-Breaking)

1. Create `backend/pipeline_orchestrator.py` with `PipelineOrchestrator` class
2. Import into `fastserver.py`
3. Initialize orchestrator in `WebSocketManager.initialize()`
4. Replace `start_pipeline()`/`stop_pipeline()` calls with `pipeline.start()`/`pipeline.stop()`
5. Remove `Speech.start()`/`Speech.stop()` - orchestrator handles it

### Phase 2: Clean Up WebSocketManager

1. Remove `user_message_task` and `audio_streamer_task` attributes
2. Remove `get_user_messages()` and `stream_audio_to_client()` methods
3. Remove `_clear_queue()` helper (moved to orchestrator)
4. Keep callback methods (they just format and send WebSocket messages)

### Phase 3: Optional - Extract Components

Only if `fastserver.py` is still too large:
1. Move `Transcribe`, `ChatLLM`, `Speech` to `pipeline_components.py`
2. Move data classes to `data_types.py`

---

## Code Diff Preview

### Before (WebSocketManager.start_pipeline):
```python
async def start_pipeline(self):
    self._clear_queue(self.queues.transcribe_queue)
    self._clear_queue(self.queues.sentence_queue)
    self._clear_queue(self.queues.audio_queue)
    self._suppress_audio = False

    if self.speech and not self.speech.is_running:
        await self.speech.start()

    if self.user_message_task is None or self.user_message_task.done():
        self.user_message_task = asyncio.create_task(self.get_user_messages())

    if self.audio_streamer_task is None or self.audio_streamer_task.done():
        self.audio_streamer_task = asyncio.create_task(self.stream_audio_to_client())
```

### After (using orchestrator):
```python
async def connect(self, websocket: WebSocket):
    await websocket.accept()
    self.websocket = websocket

    if self.chat:
        await self.chat.start_new_chat()

    await self.pipeline.start()  # One line - clear intent
```

---

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Task visibility | Scattered across 3 places | All in `_tasks` dict |
| Pipeline control | Mixed with WebSocket code | Dedicated `start()`/`stop()`/`restart()` |
| Data flow | Implicit, spread across methods | Documented in class docstring |
| Testing | Hard to test pipeline in isolation | Can test orchestrator independently |
| Debugging | "Where are my tasks?" | `pipeline.active_tasks` shows status |

---

## Asyncio Task Lifecycle & Best Practices

Understanding how asyncio tasks complete and how to properly manage their lifecycle is critical for avoiding phantom generations and resource leaks.

### Task State Methods

Every `asyncio.Task` has these key methods for checking state:

```python
task = asyncio.create_task(some_coroutine())

# Check if task has completed (success, exception, OR cancelled)
task.done()       # Returns bool

# Check if task was cancelled
task.cancelled()  # Returns bool

# Get the result (raises exception if task failed or was cancelled)
task.result()     # Returns result or raises

# Get exception without re-raising (None if no exception)
task.exception()  # Returns Exception or None
```

### Task Completion States

A task transitions through these states:

```
PENDING ──┬──→ CANCELLED  (task.cancel() was called)
          │
          ├──→ FINISHED   (completed successfully, has result)
          │
          └──→ FAILED     (raised an exception)

task.done() returns True for ALL three end states
```

### Proper Task Cleanup with try/except/finally

**Current Problem:** We cancel tasks but don't properly wait for them or handle exceptions:

```python
# BAD: Current approach - no timeout, no exception handling
if task and not task.done():
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass  # Swallows all errors, no timeout
```

**Better:** Use `asyncio.wait_for` with timeout and proper exception handling:

```python
async def stop_task_safely(task: asyncio.Task, name: str, timeout: float = 5.0):
    """
    Safely stop a task with proper cleanup.

    1. Cancel the task
    2. Wait for it to finish with timeout
    3. Handle any exceptions
    4. Log the final state
    """
    if task is None or task.done():
        return

    task.cancel()

    try:
        # Wait for task to actually finish (with timeout)
        await asyncio.wait_for(task, timeout=timeout)

    except asyncio.TimeoutError:
        # Task didn't stop in time - this is a problem
        logger.error(f"Task {name} did not stop within {timeout}s timeout")
        # Task is still running! May need force cleanup

    except asyncio.CancelledError:
        # Expected - task was cancelled successfully
        logger.debug(f"Task {name} cancelled successfully")

    except Exception as e:
        # Task raised an exception during cancellation
        logger.error(f"Task {name} raised exception during shutdown: {e}")

    finally:
        # Always log final state for debugging
        if task.done():
            if task.cancelled():
                logger.info(f"Task {name}: CANCELLED")
            elif task.exception():
                logger.warning(f"Task {name}: FAILED with {task.exception()}")
            else:
                logger.info(f"Task {name}: FINISHED successfully")
        else:
            logger.error(f"Task {name}: STILL RUNNING after cleanup!")
```

### Updated PipelineOrchestrator.stop()

```python
class PipelineOrchestrator:

    async def stop(self, timeout: float = 5.0):
        """
        Stop all pipeline tasks gracefully with proper cleanup.

        Args:
            timeout: Max seconds to wait for each task to stop
        """
        if not self._running:
            return

        self._running = False
        logger.info("Stopping pipeline tasks...")

        # Cancel all tasks first (non-blocking)
        for name, task in self._tasks.items():
            if task and not task.done():
                task.cancel()
                logger.debug(f"Cancellation requested for {name}")

        # Now wait for all tasks to finish with timeout
        for name, task in self._tasks.items():
            if task is None:
                continue

            try:
                await asyncio.wait_for(task, timeout=timeout)

            except asyncio.TimeoutError:
                logger.error(f"Task {name} did not stop within {timeout}s")

            except asyncio.CancelledError:
                logger.debug(f"Task {name} cancelled")

            except Exception as e:
                logger.error(f"Task {name} error during shutdown: {e}")

            finally:
                # Log final state
                self._log_task_state(name, task)

        self._tasks.clear()
        logger.info("All pipeline tasks stopped")

    def _log_task_state(self, name: str, task: asyncio.Task):
        """Log the final state of a task for debugging"""
        if not task.done():
            logger.error(f"  {name}: STILL RUNNING (leak!)")
        elif task.cancelled():
            logger.debug(f"  {name}: cancelled ✓")
        elif task.exception():
            logger.warning(f"  {name}: failed with {task.exception()}")
        else:
            logger.debug(f"  {name}: completed ✓")
```

### Waiting for Multiple Tasks

Use `asyncio.gather()` or `asyncio.wait()` when stopping multiple tasks:

```python
async def stop_all_tasks(self, timeout: float = 10.0):
    """Stop all tasks concurrently with overall timeout"""

    if not self._tasks:
        return

    # Cancel all tasks
    for task in self._tasks.values():
        if task and not task.done():
            task.cancel()

    # Wait for all to finish (with overall timeout)
    pending_tasks = [t for t in self._tasks.values() if t and not t.done()]

    if pending_tasks:
        try:
            # return_exceptions=True prevents one exception from stopping others
            results = await asyncio.wait_for(
                asyncio.gather(*pending_tasks, return_exceptions=True),
                timeout=timeout
            )

            # Check results for any unexpected exceptions
            for task, result in zip(pending_tasks, results):
                if isinstance(result, asyncio.CancelledError):
                    pass  # Expected
                elif isinstance(result, Exception):
                    logger.error(f"Task {task.get_name()} failed: {result}")

        except asyncio.TimeoutError:
            logger.error(f"Some tasks did not stop within {timeout}s")
            # Log which tasks are still running
            for name, task in self._tasks.items():
                if task and not task.done():
                    logger.error(f"  {name} is STILL RUNNING")
```

### Alternative: asyncio.wait() with return_when

For more control over which tasks to wait for:

```python
async def stop_with_wait(self, timeout: float = 10.0):
    """Stop tasks using asyncio.wait for finer control"""

    pending_tasks = {t for t in self._tasks.values() if t and not t.done()}

    if not pending_tasks:
        return

    # Cancel all
    for task in pending_tasks:
        task.cancel()

    # Wait until ALL are done, or timeout
    done, still_pending = await asyncio.wait(
        pending_tasks,
        timeout=timeout,
        return_when=asyncio.ALL_COMPLETED
    )

    # Handle completed tasks
    for task in done:
        if task.cancelled():
            logger.debug(f"{task.get_name()}: cancelled")
        elif task.exception():
            logger.error(f"{task.get_name()}: {task.exception()}")

    # Warn about tasks that didn't stop
    for task in still_pending:
        logger.error(f"{task.get_name()}: TIMEOUT - still running!")
```

### Checking Task Status in active_tasks Property

```python
@property
def active_tasks(self) -> Dict[str, str]:
    """
    Return detailed status of each pipeline task.

    Returns dict like:
    {
        "user_messages": "running",
        "tts_synthesis": "cancelled",
        "audio_streaming": "failed: ConnectionError"
    }
    """
    status = {}
    for name, task in self._tasks.items():
        if task is None:
            status[name] = "not_created"
        elif not task.done():
            status[name] = "running"
        elif task.cancelled():
            status[name] = "cancelled"
        elif task.exception():
            status[name] = f"failed: {type(task.exception()).__name__}"
        else:
            status[name] = "completed"
    return status
```

### Key Takeaways

| Method | Use For |
|--------|---------|
| `task.done()` | Check if task finished (any reason) |
| `task.cancelled()` | Check if specifically cancelled |
| `task.exception()` | Get exception without re-raising |
| `task.result()` | Get return value (or raise exception) |
| `asyncio.wait_for(task, timeout)` | Wait with timeout |
| `asyncio.gather(*tasks, return_exceptions=True)` | Wait for multiple, collect results |
| `asyncio.wait(tasks, timeout, return_when)` | Fine-grained multi-task waiting |

### Pattern: Ensuring Clean Task Completion

```python
async def run_task_to_completion(
    coro,
    name: str,
    timeout: float = 30.0
) -> tuple[bool, Any]:
    """
    Run a coroutine as a task and ensure it completes cleanly.

    Returns: (success: bool, result_or_exception)
    """
    task = asyncio.create_task(coro, name=name)

    try:
        result = await asyncio.wait_for(task, timeout=timeout)
        logger.info(f"Task {name} completed successfully")
        return (True, result)

    except asyncio.TimeoutError:
        logger.error(f"Task {name} timed out after {timeout}s")
        task.cancel()
        try:
            await task  # Wait for cancellation to complete
        except asyncio.CancelledError:
            pass
        return (False, TimeoutError(f"Task {name} timed out"))

    except asyncio.CancelledError:
        logger.info(f"Task {name} was cancelled")
        return (False, asyncio.CancelledError())

    except Exception as e:
        logger.error(f"Task {name} failed: {e}")
        return (False, e)

    finally:
        # Always verify task is done
        if not task.done():
            logger.error(f"Task {name} cleanup failed - task still running!")
```

---

## Generation Lifecycle & Completion Tracking

This is critical for preventing phantom generations. The pipeline tasks are **long-running workers**, but each user message triggers a **generation cycle** that must complete cleanly before the next one starts.

### The Problem: No Explicit "Done" Signal

Currently, the pipeline has implicit completion via sentinels (`is_final=True`), but:
1. Nothing prevents a new generation from starting while the previous one is still in-flight
2. No explicit tracking of "generation N is complete, ready for N+1"
3. Queues can have items from multiple generations mixed together

### Solution: Generation Tracker

Add explicit generation lifecycle management:

```python
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional
import asyncio

class GenerationState(Enum):
    IDLE = auto()           # Ready for new user message
    PROCESSING_LLM = auto() # LLM is generating text
    PROCESSING_TTS = auto() # TTS is synthesizing (LLM done)
    STREAMING = auto()      # Audio streaming to client
    COMPLETE = auto()       # All done, transitioning to IDLE


@dataclass
class GenerationContext:
    """Tracks a single user message → response cycle"""
    generation_id: str
    user_message: str
    state: GenerationState = GenerationState.IDLE

    # Completion tracking
    llm_complete: bool = False
    tts_sentences_expected: int = 0
    tts_sentences_complete: int = 0
    audio_streams_complete: int = 0

    # Events for coordination
    llm_done_event: asyncio.Event = field(default_factory=asyncio.Event)
    tts_done_event: asyncio.Event = field(default_factory=asyncio.Event)
    audio_done_event: asyncio.Event = field(default_factory=asyncio.Event)

    def mark_llm_complete(self, sentence_count: int):
        """Called when LLM finishes streaming all characters"""
        self.llm_complete = True
        self.tts_sentences_expected = sentence_count
        self.state = GenerationState.PROCESSING_TTS
        self.llm_done_event.set()

    def mark_tts_sentence_complete(self):
        """Called when one sentence's audio is fully synthesized"""
        self.tts_sentences_complete += 1
        if self.tts_sentences_complete >= self.tts_sentences_expected:
            self.state = GenerationState.STREAMING
            self.tts_done_event.set()

    def mark_audio_stream_complete(self):
        """Called when final audio chunk is sent to client"""
        self.audio_streams_complete += 1
        # Check if all expected audio streams are done
        if self.audio_streams_complete >= self.tts_sentences_expected:
            self.state = GenerationState.COMPLETE
            self.audio_done_event.set()

    @property
    def is_complete(self) -> bool:
        return self.state == GenerationState.COMPLETE


class GenerationTracker:
    """
    Tracks generation lifecycle and ensures clean handoffs.

    Prevents phantom generations by:
    1. Only allowing one active generation at a time
    2. Explicitly tracking completion of each stage
    3. Providing clear "ready for next" signal
    """

    def __init__(self):
        self._current: Optional[GenerationContext] = None
        self._lock = asyncio.Lock()
        self._generation_counter = 0

    @property
    def is_idle(self) -> bool:
        """True if no generation is in progress"""
        return self._current is None or self._current.is_complete

    @property
    def current_generation(self) -> Optional[GenerationContext]:
        return self._current

    async def start_generation(self, user_message: str) -> GenerationContext:
        """
        Start a new generation cycle.

        If a previous generation is still running, wait for it to complete
        or raise an error (depending on desired behavior).
        """
        async with self._lock:
            # Option 1: Wait for previous generation (blocking)
            if self._current and not self._current.is_complete:
                logger.warning(f"Waiting for generation {self._current.generation_id} to complete")
                await self._current.audio_done_event.wait()

            # Option 2: Cancel previous generation (non-blocking, for interrupts)
            # if self._current and not self._current.is_complete:
            #     self._current.state = GenerationState.COMPLETE
            #     # Clear queues here if needed

            self._generation_counter += 1
            gen_id = f"gen_{self._generation_counter}"

            self._current = GenerationContext(
                generation_id=gen_id,
                user_message=user_message,
                state=GenerationState.PROCESSING_LLM,
            )

            logger.info(f"Started generation {gen_id}: '{user_message[:50]}...'")
            return self._current

    def complete_generation(self):
        """Mark current generation as complete and ready for cleanup"""
        if self._current:
            self._current.state = GenerationState.COMPLETE
            logger.info(f"Completed generation {self._current.generation_id}")
            # Don't clear _current yet - let start_generation handle the transition

    def reset(self):
        """Hard reset - used for interrupts"""
        if self._current:
            self._current.state = GenerationState.COMPLETE
            self._current.llm_done_event.set()
            self._current.tts_done_event.set()
            self._current.audio_done_event.set()
        self._current = None
```

### Integration with PipelineOrchestrator

```python
class PipelineOrchestrator:
    def __init__(self, ...):
        # ... existing init ...
        self.generation_tracker = GenerationTracker()

    async def _process_user_messages(self):
        """Task 1: Process user messages with generation tracking"""
        while self._running:
            try:
                user_message: str = await self.queues.transcribe_queue.get()

                if not user_message or not user_message.strip():
                    continue

                # Start a new tracked generation
                generation = await self.generation_tracker.start_generation(user_message)

                # Process through LLM
                sentence_count = await self.chat.process_message_prompt(
                    user_message=user_message,
                    sentence_queue=self.queues.sentence_queue,
                    on_text_chunk=self.callbacks.on_text_chunk,
                    on_text_stream_start=self.callbacks.on_text_stream_start,
                    on_text_stream_stop=self.callbacks.on_text_stream_stop,
                )

                # Mark LLM stage complete
                generation.mark_llm_complete(sentence_count)
                logger.info(f"[{generation.generation_id}] LLM complete, {sentence_count} sentences queued")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing user message: {e}")

    async def _process_tts_synthesis(self):
        """Task 2: TTS with completion tracking"""
        while self._running:
            try:
                sentence = await asyncio.wait_for(
                    self.queues.sentence_queue.get(),
                    timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            generation = self.generation_tracker.current_generation

            if sentence.is_final:
                # Pass through sentinel
                await self.queues.audio_queue.put(AudioChunk(
                    audio_bytes=b"",
                    sentence_index=sentence.index,
                    chunk_index=0,
                    message_id=sentence.message_id,
                    character_id=sentence.character_id,
                    character_name=sentence.character_name,
                    is_final=True,
                ))

                # Mark this sentence's TTS as complete
                if generation:
                    generation.mark_tts_sentence_complete()
                    logger.info(f"[{generation.generation_id}] TTS sentence {sentence.index} complete")
                continue

            # Generate audio for sentence
            chunk_index = 0
            try:
                async for pcm_bytes in self.speech.generate_audio_for_sentence(
                    sentence.text,
                    sentence.voice_id
                ):
                    await self.queues.audio_queue.put(AudioChunk(
                        audio_bytes=pcm_bytes,
                        sentence_index=sentence.index,
                        chunk_index=chunk_index,
                        message_id=sentence.message_id,
                        character_id=sentence.character_id,
                        character_name=sentence.character_name,
                        is_final=False,
                    ))
                    chunk_index += 1
            except Exception as e:
                logger.error(f"TTS error for sentence {sentence.index}: {e}")

    async def _stream_audio_to_client(self):
        """Task 3: Audio streaming with completion tracking"""
        current_message_id: Optional[str] = None

        while self._running:
            try:
                chunk = await asyncio.wait_for(
                    self.queues.audio_queue.get(),
                    timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            generation = self.generation_tracker.current_generation

            if chunk.is_final:
                if self.callbacks.on_audio_stream_stop:
                    await self.callbacks.on_audio_stream_stop(chunk)
                current_message_id = None
                self._suppress_audio = False

                # Mark audio stream complete
                if generation:
                    generation.mark_audio_stream_complete()
                    logger.info(f"[{generation.generation_id}] Audio stream complete for message {chunk.message_id}")

                    # Check if entire generation is done
                    if generation.is_complete:
                        self.generation_tracker.complete_generation()
                        logger.info(f"[{generation.generation_id}] ✓ Generation fully complete")
                continue

            # ... rest unchanged ...
```

### Updated ChatLLM to Return Sentence Count

```python
class ChatLLM:
    async def process_message_prompt(self, ...) -> int:
        """
        Process user message and generate responses.

        Returns: Total number of sentences queued for TTS
        """
        total_sentences = 0

        for character in responding_characters:
            message_id = str(uuid.uuid4())
            messages = self.build_messages_for_character(character)

            if on_text_stream_start:
                await on_text_stream_start(character, message_id)

            sentence_count, full_response = await self.stream_character_response(...)
            total_sentences += sentence_count

            if on_text_stream_stop:
                await on_text_stream_stop(character, message_id, full_response)

            # ... save to history ...

        return total_sentences

    async def stream_character_response(self, ...) -> tuple[int, str]:
        """
        Stream LLM response for a character.

        Returns: (sentence_count, full_response_text)
        """
        sentence_index = 0
        full_response = ""

        # ... existing streaming code ...

        # Final sentinel
        await sentence_queue.put(TTSSentence(..., is_final=True))

        return (sentence_index, full_response)  # Return count for tracking
```

### Generation Flow Diagram

```
User says: "Hey Alice and Bob"

┌─────────────────────────────────────────────────────────────────┐
│ Generation gen_1                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  State: PROCESSING_LLM                                          │
│  ├── ChatLLM streams Alice's response                           │
│  │   └── Queues sentences [0, 1, 2] + is_final sentinel         │
│  ├── ChatLLM streams Bob's response                             │
│  │   └── Queues sentences [0, 1] + is_final sentinel            │
│  └── mark_llm_complete(sentence_count=5)                        │
│                                                                 │
│  State: PROCESSING_TTS                                          │
│  ├── TTS processes Alice sentence 0 → audio chunks              │
│  │   └── mark_tts_sentence_complete() [1/5]                     │
│  ├── TTS processes Alice sentence 1 → audio chunks              │
│  │   └── mark_tts_sentence_complete() [2/5]                     │
│  ├── ... (continues for all sentences)                          │
│  └── tts_done_event.set() when 5/5 complete                     │
│                                                                 │
│  State: STREAMING                                               │
│  ├── Audio streamer sends Alice's audio                         │
│  │   └── is_final → mark_audio_stream_complete() [1/2]          │
│  ├── Audio streamer sends Bob's audio                           │
│  │   └── is_final → mark_audio_stream_complete() [2/2]          │
│  └── audio_done_event.set()                                     │
│                                                                 │
│  State: COMPLETE ✓                                              │
│  └── Ready for gen_2                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Handling Interrupts with Generation Tracking

```python
async def restart(self):
    """Restart pipeline - used for interrupts"""
    # Force-complete current generation
    self.generation_tracker.reset()

    await self.stop()
    self._clear_all_queues()
    await self.start()

    logger.info("Pipeline restarted, generation tracker reset")
```

### Key Benefits of Generation Tracking

| Problem | Solution |
|---------|----------|
| Phantom audio from previous generation | Each chunk tied to generation_id, stale chunks ignored |
| Overlapping generations | `start_generation()` waits for previous to complete |
| "Is it done yet?" | Check `generation.is_complete` or await events |
| Lost track of progress | `generation.state` shows exactly where we are |
| Debug logging | Generation ID in all logs makes tracing easy |

### Simpler Alternative: Completion Counter

If the full `GenerationContext` feels heavy, a simpler approach tracks just the essentials:

```python
class SimpleGenerationTracker:
    """Lightweight generation tracking"""

    def __init__(self):
        self._generation_id = 0
        self._active_generation: Optional[str] = None
        self._completion_event = asyncio.Event()
        self._completion_event.set()  # Start as "ready"

    async def begin(self) -> str:
        """Start a new generation, wait if one is active"""
        await self._completion_event.wait()  # Block until previous is done
        self._completion_event.clear()

        self._generation_id += 1
        self._active_generation = f"gen_{self._generation_id}"
        return self._active_generation

    def complete(self):
        """Mark current generation as done"""
        self._active_generation = None
        self._completion_event.set()  # Unblock next generation

    def reset(self):
        """Force reset for interrupts"""
        self._active_generation = None
        self._completion_event.set()
```

This ensures generations don't overlap: each `begin()` waits for the previous `complete()`.

---

## Open Questions

1. **Should Transcribe also be orchestrated?**
   - Currently runs in a separate thread (RealtimeSTT limitation)
   - Could wrap thread management in orchestrator, but may be overkill
   - **Recommendation:** Leave Transcribe as-is for now

2. **Error handling strategy?**
   - Current: Tasks catch and log errors, continue running
   - Could add: Task restart on failure, error callbacks to client
   - **Recommendation:** Start simple, add restart logic if needed

3. **Multiple simultaneous conversations?**
   - Current architecture is single-user
   - Orchestrator pattern makes this easier to add later
   - **Recommendation:** Don't build for it now (YAGNI)

---

## Summary

The refactor introduces a `PipelineOrchestrator` class that:

1. **Centralizes task management** - All three pipeline tasks created and tracked in one place
2. **Clarifies data flow** - ASCII diagram in docstring shows the pipeline
3. **Simplifies WebSocketManager** - Focused on connection handling, delegates to orchestrator
4. **Maintains simplicity** - One new class, no framework, no magic

This follows KISS/YAGNI while providing a clear "control center" for pipeline orchestration.
