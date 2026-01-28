# Group Chat Audio Pipeline - Planning Document

## Overview

This document outlines the design for a pipeline component that ensures correct speaker and sentence ordering during audio playback in group chats, while maintaining low latency.

## Current Architecture Analysis

### Existing Data Flow

```
User Message
    ↓
ChatLLM.process_message_prompt()
    ↓
[For each character in order of mention]
    ↓
stream_character_response()
    ↓
TTSSentence → sentence_queue
    ↓
Speech.process_sentences()
    ↓
AudioChunk → audio_queue
    ↓
stream_audio_to_client()
    ↓
WebSocket → Browser
```

### Existing Data Structures

```python
@dataclass
class TTSSentence:
    text: str
    index: int              # Sentence index within message
    message_id: str         # Unique ID for this character's response
    character_id: str
    character_name: str
    voice_id: str
    is_final: bool = False  # Sentinel marking end of character's response

@dataclass
class AudioChunk:
    audio_bytes: bytes
    sentence_index: int
    chunk_index: int
    message_id: str
    character_id: str
    character_name: str
    is_final: bool = False  # Sentinel marking end of character's audio
```

### Current Problem

The TTS worker (`Speech.process_sentences`) processes sentences as they arrive and immediately pushes audio chunks to `audio_queue`. If multiple characters are generating audio concurrently (or near-concurrently), chunks could be interleaved incorrectly:

```
Expected: [CharA-S0-C0] [CharA-S0-C1] [CharA-S1-C0] ... [CharB-S0-C0] ...
Possible: [CharA-S0-C0] [CharB-S0-C0] [CharA-S0-C1] ... (wrong!)
```

**Key insight**: The LLM already processes characters sequentially in `process_message_prompt()`. However, TTS generation for one character may still be running when the next character's LLM response starts streaming sentences.

---

## Proposed Solution: GroupChatAudioPipeline

### Design Goals

1. **Correct ordering**: Play all audio for Character A before Character B
2. **Low latency**: Start playback as soon as first audio chunk is ready
3. **Simple**: Minimal changes to existing architecture
4. **Sentence ordering**: Within a character, sentences play in order
5. **Chunk ordering**: Within a sentence, chunks play in order

### Architecture Decision

**Option A: Ordering at the audio_queue consumer (chosen)**
- Add ordering logic in `stream_audio_to_client()`
- Buffer chunks when out-of-order, release when correct speaker's turn
- Pros: Minimal changes, works with existing queues
- Cons: Slightly more buffering

**Option B: Separate queues per speaker**
- Create per-character audio queues
- Pros: Clean separation
- Cons: More complex management, harder to coordinate

**Option C: Priority queue with ordering key**
- Replace audio_queue with priority-based structure
- Pros: Automatic ordering
- Cons: Requires speaker index, more overhead

### Chosen Approach: Speaker-Ordered Audio Streamer

We'll create a `GroupChatAudioPipeline` that sits between the `audio_queue` and WebSocket output, managing:

1. **Speaker order tracking** - Which character should play next
2. **Audio buffering** - Hold chunks for future speakers until current speaker completes
3. **Playback coordination** - Release chunks in correct order

---

## Implementation Design

### New Data Structure: SpeakerTurn

```python
@dataclass
class SpeakerTurn:
    """Tracks a character's turn in the conversation"""
    character_id: str
    character_name: str
    message_id: str
    speaker_index: int          # Order in conversation (0, 1, 2, ...)
    is_complete: bool = False   # True when final sentinel received
```

### Modified TTSSentence

```python
@dataclass
class TTSSentence:
    text: str
    index: int
    message_id: str
    character_id: str
    character_name: str
    voice_id: str
    speaker_index: int = 0      # NEW: Order of this character in conversation
    is_final: bool = False
```

### Modified AudioChunk

```python
@dataclass
class AudioChunk:
    audio_bytes: bytes
    sentence_index: int
    chunk_index: int
    message_id: str
    character_id: str
    character_name: str
    speaker_index: int = 0      # NEW: Order of this character in conversation
    is_final: bool = False
```

### GroupChatAudioPipeline Class

```python
class GroupChatAudioPipeline:
    """
    Coordinates audio playback order for group chats.

    Ensures speakers are played in conversation order while maintaining
    low latency by streaming chunks as soon as they're available for
    the current speaker.
    """

    def __init__(self, audio_queue: asyncio.Queue):
        self.audio_queue = audio_queue

        # Current playback state
        self.current_speaker_index = 0

        # Buffer for future speakers' chunks
        # Key: speaker_index, Value: list of AudioChunk
        self.speaker_buffers: Dict[int, List[AudioChunk]] = defaultdict(list)

        # Track which speakers have completed (received is_final)
        self.completed_speakers: Set[int] = set()

        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

    def reset(self):
        """Reset state for new conversation turn"""
        self.current_speaker_index = 0
        self.speaker_buffers.clear()
        self.completed_speakers.clear()

    async def process_chunk(self, chunk: AudioChunk) -> AsyncGenerator[AudioChunk, None]:
        """
        Process incoming chunk and yield chunks ready for playback.

        Yields chunks immediately if they belong to current speaker,
        otherwise buffers them for later.
        """
        async with self._lock:
            speaker_idx = chunk.speaker_index

            # Handle final sentinel
            if chunk.is_final:
                self.completed_speakers.add(speaker_idx)

                if speaker_idx == self.current_speaker_index:
                    # Current speaker done - yield their final sentinel
                    yield chunk

                    # Advance to next speaker and flush their buffer
                    self.current_speaker_index += 1
                    async for buffered in self._flush_current_buffer():
                        yield buffered
                else:
                    # Future speaker completed - just mark it
                    self.speaker_buffers[speaker_idx].append(chunk)
                return

            # Regular audio chunk
            if speaker_idx == self.current_speaker_index:
                # This is the current speaker - yield immediately
                yield chunk
            else:
                # Future speaker - buffer for later
                self.speaker_buffers[speaker_idx].append(chunk)

    async def _flush_current_buffer(self) -> AsyncGenerator[AudioChunk, None]:
        """Flush buffered chunks for current speaker"""
        while self.current_speaker_index in self.speaker_buffers:
            buffer = self.speaker_buffers.pop(self.current_speaker_index)

            for chunk in buffer:
                yield chunk

                if chunk.is_final:
                    # This speaker is done, advance
                    self.current_speaker_index += 1
```

### Integration with WebSocketManager

```python
class WebSocketManager:
    def __init__(self):
        # ... existing init ...
        self.audio_pipeline: Optional[GroupChatAudioPipeline] = None

    async def initialize(self):
        # ... existing init ...
        self.audio_pipeline = GroupChatAudioPipeline(self.queues.audio_queue)

    async def stream_audio_to_client(self):
        """Background task: stream synthesized audio chunks to the client."""
        current_message_id: Optional[str] = None

        while True:
            try:
                chunk: AudioChunk = await asyncio.wait_for(
                    self.queues.audio_queue.get(), timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            # Process through ordering pipeline
            async for ordered_chunk in self.audio_pipeline.process_chunk(chunk):
                if ordered_chunk.is_final:
                    await self.on_audio_stream_stop(ordered_chunk)
                    current_message_id = None
                    continue

                if current_message_id != ordered_chunk.message_id:
                    await self.on_audio_stream_start(ordered_chunk)
                    current_message_id = ordered_chunk.message_id

                if self._suppress_audio:
                    continue

                # Send to client
                await self.send_text_to_client({
                    "type": "audio_chunk",
                    "data": {
                        "character_id": ordered_chunk.character_id,
                        "character_name": ordered_chunk.character_name,
                        "message_id": ordered_chunk.message_id,
                        "sentence_index": ordered_chunk.sentence_index,
                        "chunk_index": ordered_chunk.chunk_index,
                    },
                })

                if self.websocket:
                    await self.websocket.send_bytes(ordered_chunk.audio_bytes)
```

### Modifications to ChatLLM

Add speaker indexing when creating TTSSentence objects:

```python
async def process_message_prompt(self, user_message: str, sentence_queue: asyncio.Queue, ...):
    # ... existing code ...

    responding_characters = self.parse_character_mentions(...)

    for speaker_index, character in enumerate(responding_characters):
        message_id = str(uuid.uuid4())

        # Pass speaker_index to stream_character_response
        full_response = await self.stream_character_response(
            messages=messages,
            character=character,
            message_id=message_id,
            speaker_index=speaker_index,  # NEW
            model_settings=model_settings,
            sentence_queue=sentence_queue,
            on_text_chunk=on_text_chunk
        )
        # ... rest of existing code ...

async def stream_character_response(self, ..., speaker_index: int, ...):
    # ... existing code ...

    # When creating TTSSentence, include speaker_index
    await sentence_queue.put(TTSSentence(
        text=sentence_text,
        index=sentence_index,
        message_id=message_id,
        character_id=character.id,
        character_name=character.name,
        voice_id=character.voice,
        speaker_index=speaker_index,  # NEW
        is_final=False,
    ))

    # ... final sentinel also gets speaker_index ...
    await sentence_queue.put(TTSSentence(
        text="",
        index=sentence_index,
        message_id=message_id,
        character_id=character.id,
        character_name=character.name,
        voice_id=character.voice,
        speaker_index=speaker_index,  # NEW
        is_final=True,
    ))
```

### Modifications to Speech Worker

Pass through speaker_index when creating AudioChunk:

```python
async def process_sentences(self):
    while self.is_running:
        # ... get sentence ...

        # Pass through sentinels with speaker_index
        if sentence.is_final:
            await self.queues.audio_queue.put(AudioChunk(
                audio_bytes=b"",
                sentence_index=sentence.index,
                chunk_index=0,
                message_id=sentence.message_id,
                character_id=sentence.character_id,
                character_name=sentence.character_name,
                speaker_index=sentence.speaker_index,  # NEW
                is_final=True,
            ))
            continue

        # Generate audio chunks with speaker_index
        async for pcm_bytes in self.generate_audio_for_sentence(...):
            audio_chunk = AudioChunk(
                audio_bytes=pcm_bytes,
                sentence_index=sentence.index,
                chunk_index=chunk_index,
                message_id=sentence.message_id,
                character_id=sentence.character_id,
                character_name=sentence.character_name,
                speaker_index=sentence.speaker_index,  # NEW
                is_final=False,
            )
            await self.queues.audio_queue.put(audio_chunk)
            chunk_index += 1
```

---

## Flow Diagram

```
User: "Hey Alice and Bob, what do you think?"

1. ChatLLM parses mentions → [Alice (speaker_index=0), Bob (speaker_index=1)]

2. Stream Alice's response (speaker_index=0):
   → TTSSentence(text="Hi!", speaker_index=0, index=0)
   → TTSSentence(text="I think...", speaker_index=0, index=1)
   → TTSSentence(text="", speaker_index=0, is_final=True)

3. Stream Bob's response (speaker_index=1):
   → TTSSentence(text="Hello!", speaker_index=1, index=0)
   → TTSSentence(text="", speaker_index=1, is_final=True)

4. TTS processes sentences (may interleave):
   → AudioChunk(speaker_index=0, sentence_index=0, chunk_index=0) ✓ play now
   → AudioChunk(speaker_index=1, sentence_index=0, chunk_index=0) ✗ buffer
   → AudioChunk(speaker_index=0, sentence_index=0, chunk_index=1) ✓ play now
   → AudioChunk(speaker_index=0, is_final=True) ✓ done, advance to speaker 1
   → Flush buffer → play Bob's chunks

5. Result: All of Alice's audio plays, then all of Bob's audio
```

---

## Questions for Discussion

1. **Interrupt handling**: When user interrupts, should we:
   - Clear all buffers immediately? (current approach)
   - Allow current sentence to finish?

2. **Concurrent TTS**: Currently TTS processes sentences sequentially. Should we:
   - Keep sequential (simpler, current behavior)?
   - Allow concurrent TTS for different speakers (more complex, potentially faster)?

3. **Buffer limits**: Should we limit buffer size per speaker?
   - Pro: Prevents memory issues if one speaker has very long response
   - Con: Could cause audio gaps

4. **Error recovery**: If TTS fails for one sentence:
   - Skip that sentence and continue?
   - Retry?
   - Fail the entire speaker's turn?

5. **Frontend coordination**: Does the frontend need any changes to handle:
   - Speaker transitions?
   - Visual indicators for "buffering next speaker"?

---

## Summary of Changes Required

| File | Changes |
|------|---------|
| `fastserver.py` | Add `speaker_index` to `TTSSentence` and `AudioChunk` |
| `fastserver.py` | Add `GroupChatAudioPipeline` class |
| `fastserver.py` | Modify `ChatLLM.stream_character_response()` to include speaker_index |
| `fastserver.py` | Modify `Speech.process_sentences()` to pass through speaker_index |
| `fastserver.py` | Modify `WebSocketManager.stream_audio_to_client()` to use pipeline |
| `fastserver.py` | Add pipeline reset on conversation turn/interrupt |

---

## Alternative: Simpler Approach (No New Class)

If the above feels like over-engineering, we can achieve the same with a simpler modification:

Since the LLM already processes characters sequentially and we only have one TTS worker, the issue only arises when TTS for character A is still running when character B's first sentence arrives.

**Simple fix**: Don't start TTS for next character until previous character's `is_final` sentinel is processed.

```python
async def process_sentences(self):
    while self.is_running:
        sentence = await self.queues.sentence_queue.get()

        if sentence.is_final:
            # Signal completion and wait briefly for audio to flush
            await self.queues.audio_queue.put(AudioChunk(..., is_final=True))
            continue

        # Generate audio - this naturally blocks until complete
        async for pcm_bytes in self.generate_audio_for_sentence(...):
            await self.queues.audio_queue.put(AudioChunk(...))
```

This works because:
1. LLM sends sentences sequentially per character
2. TTS processes sentences one at a time (current behavior)
3. Each character's final sentinel is only sent after all their sentences are queued
4. TTS won't start next character until it processes current character's sentences

**However**, this may not work if we want to parallelize TTS in the future.

---

## Recommendation

Implement the `GroupChatAudioPipeline` class because:
1. Explicit ordering logic is clearer and more maintainable
2. Supports future parallelization of TTS
3. Minimal additional complexity (one small class)
4. Easy to test in isolation
