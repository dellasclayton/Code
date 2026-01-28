# Group Chat Audio Pipeline - Planning Document

## Problem Statement

In group chats with multiple character responses, we have two issues:

1. **Phantom audio playback** - Audio doesn't correctly end/cleanup when transitioning between characters
2. **Premature next-speaker playback** - Character 2's audio starts playing as soon as it's ready, even if Character 1 is still audibly playing

## Root Cause Analysis

The current architecture sends audio chunks to the client as they're generated:

```
Backend generates → WebSocket sends → Client plays immediately
```

There's no coordination to ensure:
- Character 1's audio has finished *playing* before Character 2 starts
- Clean delineation between speaker turns
- Proper lifecycle management (start → chunks → stop)

## Solution: Speaker-Turn Scheduling

We need to delineate each character's audio as a discrete "turn" and ensure sequential playback.

### Approach: Backend Coordinates, Frontend Queues

**Backend responsibilities:**
1. Assign each character response a `speaker_index` (0, 1, 2, ...)
2. Send clear turn boundaries: `turn_start` → audio chunks → `turn_end`
3. Include speaker metadata with every chunk for proper grouping

**Frontend responsibilities:**
1. Queue incoming audio by speaker_index
2. Only start playing speaker N+1 after speaker N's audio completes
3. Properly cleanup audio context between turns

---

## Data Structure Changes

### Add `speaker_index` to TTSSentence

```python
@dataclass
class TTSSentence:
    text: str
    index: int
    message_id: str
    character_id: str
    character_name: str
    voice_id: str
    speaker_index: int = 0      # NEW: Order in conversation (0, 1, 2...)
    is_final: bool = False
```

### Add `speaker_index` to AudioChunk

```python
@dataclass
class AudioChunk:
    audio_bytes: bytes
    sentence_index: int
    chunk_index: int
    message_id: str
    character_id: str
    character_name: str
    speaker_index: int = 0      # NEW: Order in conversation (0, 1, 2...)
    is_final: bool = False
```

---

## Backend Changes

### 1. ChatLLM: Assign speaker_index

In `process_message_prompt()`:

```python
async def process_message_prompt(self, user_message: str, sentence_queue: asyncio.Queue, ...):
    # ... existing code ...

    responding_characters = self.parse_character_mentions(...)

    for speaker_index, character in enumerate(responding_characters):
        message_id = str(uuid.uuid4())

        # Pass speaker_index through the pipeline
        full_response = await self.stream_character_response(
            messages=messages,
            character=character,
            message_id=message_id,
            speaker_index=speaker_index,      # NEW
            model_settings=model_settings,
            sentence_queue=sentence_queue,
            on_text_chunk=on_text_chunk
        )
        # ... rest unchanged ...
```

### 2. stream_character_response: Include speaker_index in TTSSentence

```python
async def stream_character_response(self, ..., speaker_index: int, ...):
    # ... existing streaming code ...

    async for sentence in generate_sentences_async(...):
        sentence_text = sentence.strip()
        if sentence_text:
            await sentence_queue.put(TTSSentence(
                text=sentence_text,
                index=sentence_index,
                message_id=message_id,
                character_id=character.id,
                character_name=character.name,
                voice_id=character.voice,
                speaker_index=speaker_index,   # NEW
                is_final=False,
            ))
            sentence_index += 1

    # Final sentinel also includes speaker_index
    await sentence_queue.put(TTSSentence(
        text="",
        index=sentence_index,
        message_id=message_id,
        character_id=character.id,
        character_name=character.name,
        voice_id=character.voice,
        speaker_index=speaker_index,           # NEW
        is_final=True,
    ))
```

### 3. Speech: Pass speaker_index to AudioChunk

In `process_sentences()`:

```python
async def process_sentences(self):
    while self.is_running:
        # ... get sentence ...

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

        chunk_index = 0
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

### 4. WebSocket Messages: Include speaker_index

Update the WebSocket message formats to include `speaker_index`:

```python
# audio_stream_start
await self.send_text_to_client({
    "type": "audio_stream_start",
    "data": {
        "character_id": chunk.character_id,
        "character_name": chunk.character_name,
        "message_id": chunk.message_id,
        "speaker_index": chunk.speaker_index,    # NEW
        "sample_rate": sample_rate,
    },
})

# audio_chunk metadata
await self.send_text_to_client({
    "type": "audio_chunk",
    "data": {
        "character_id": chunk.character_id,
        "character_name": chunk.character_name,
        "message_id": chunk.message_id,
        "speaker_index": chunk.speaker_index,    # NEW
        "sentence_index": chunk.sentence_index,
        "chunk_index": chunk.chunk_index,
    },
})

# audio_stream_stop
await self.send_text_to_client({
    "type": "audio_stream_stop",
    "data": {
        "character_id": chunk.character_id,
        "character_name": chunk.character_name,
        "message_id": chunk.message_id,
        "speaker_index": chunk.speaker_index,    # NEW
    },
})
```

---

## GroupChatAudioPipeline Class

This class manages audio chunk ordering on the backend, ensuring chunks are released to the client in the correct speaker order:

```python
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Set, AsyncGenerator, Optional

@dataclass
class SpeakerBuffer:
    """Buffer for a single speaker's audio chunks"""
    chunks: List[AudioChunk] = field(default_factory=list)
    is_complete: bool = False


class GroupChatAudioPipeline:
    """
    Coordinates audio chunk ordering for group chat playback.

    Ensures speakers are played in order by buffering future speakers'
    chunks until the current speaker completes.
    """

    def __init__(self):
        self.current_speaker_index: int = 0
        self.speaker_buffers: Dict[int, SpeakerBuffer] = defaultdict(SpeakerBuffer)

    def reset(self):
        """Reset for a new conversation turn"""
        self.current_speaker_index = 0
        self.speaker_buffers.clear()

    async def process_chunk(self, chunk: AudioChunk) -> AsyncGenerator[AudioChunk, None]:
        """
        Process an incoming chunk and yield chunks ready for sending.

        Chunks for the current speaker are yielded immediately.
        Chunks for future speakers are buffered until their turn.
        """
        speaker_idx = chunk.speaker_index

        if chunk.is_final:
            # Mark this speaker as complete
            self.speaker_buffers[speaker_idx].is_complete = True

            if speaker_idx == self.current_speaker_index:
                # Current speaker done - yield their final chunk
                yield chunk

                # Advance to next speaker and flush their buffer
                self.current_speaker_index += 1
                async for buffered in self._flush_next_speaker():
                    yield buffered
            else:
                # Future speaker completed - just buffer the final marker
                self.speaker_buffers[speaker_idx].chunks.append(chunk)
            return

        # Regular audio chunk
        if speaker_idx == self.current_speaker_index:
            # Current speaker - yield immediately (low latency)
            yield chunk
        else:
            # Future speaker - buffer for later
            self.speaker_buffers[speaker_idx].chunks.append(chunk)

    async def _flush_next_speaker(self) -> AsyncGenerator[AudioChunk, None]:
        """Flush buffered chunks for the current speaker (after advancement)"""
        while self.current_speaker_index in self.speaker_buffers:
            buffer = self.speaker_buffers.pop(self.current_speaker_index)

            for chunk in buffer.chunks:
                yield chunk

                if chunk.is_final:
                    # This speaker is done, advance to next
                    self.current_speaker_index += 1

            # If buffer was incomplete, stop flushing
            if not buffer.is_complete:
                break
```

### Integration in WebSocketManager

```python
class WebSocketManager:
    def __init__(self):
        # ... existing init ...
        self.audio_pipeline = GroupChatAudioPipeline()

    async def stream_audio_to_client(self):
        """Stream audio chunks to client with speaker ordering"""
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
                await self._send_audio_chunk(ordered_chunk, current_message_id)

                if ordered_chunk.is_final:
                    current_message_id = None
                elif current_message_id != ordered_chunk.message_id:
                    current_message_id = ordered_chunk.message_id

    async def _send_audio_chunk(self, chunk: AudioChunk, current_message_id: Optional[str]):
        """Send a single audio chunk to the client"""
        if chunk.is_final:
            await self.on_audio_stream_stop(chunk)
            return

        # Send stream start if new message
        if current_message_id != chunk.message_id:
            await self.on_audio_stream_start(chunk)

        if self._suppress_audio:
            return

        # Send chunk metadata
        await self.send_text_to_client({
            "type": "audio_chunk",
            "data": {
                "character_id": chunk.character_id,
                "character_name": chunk.character_name,
                "message_id": chunk.message_id,
                "speaker_index": chunk.speaker_index,
                "sentence_index": chunk.sentence_index,
                "chunk_index": chunk.chunk_index,
            },
        })

        # Send audio bytes
        if self.websocket:
            await self.websocket.send_bytes(chunk.audio_bytes)

    async def handle_interrupt(self):
        """Handle user interrupt - reset pipeline"""
        await self.stop_pipeline()
        self._clear_queue(self.queues.transcribe_queue)
        self._clear_queue(self.queues.sentence_queue)
        self._clear_queue(self.queues.audio_queue)
        self.audio_pipeline.reset()           # NEW: Reset ordering state
        self._suppress_audio = False
        await self.start_pipeline()
        await self.send_text_to_client({"type": "interrupt_ack"})
```

---

## Frontend Requirements

The frontend needs an audio scheduler that:

1. **Queues audio by speaker_index**
2. **Plays speakers sequentially** - Only start speaker N+1 after speaker N finishes
3. **Tracks playback completion** - Use AudioContext events, not just "received all chunks"

### Conceptual Frontend Audio Scheduler

```javascript
// Conceptual implementation
class AudioScheduler {
    constructor() {
        this.audioContext = new AudioContext({ sampleRate: 24000 });
        this.speakerQueues = new Map();  // speaker_index -> chunk[]
        this.currentSpeaker = 0;
        this.isPlaying = false;
    }

    onAudioStreamStart(data) {
        const { speaker_index, character_name, sample_rate } = data;
        if (!this.speakerQueues.has(speaker_index)) {
            this.speakerQueues.set(speaker_index, []);
        }
        console.log(`[Audio] Speaker ${speaker_index} (${character_name}) starting`);
    }

    onAudioChunk(data, audioBytes) {
        const { speaker_index } = data;
        const queue = this.speakerQueues.get(speaker_index) || [];
        queue.push(audioBytes);
        this.speakerQueues.set(speaker_index, queue);

        // Start playback if this is current speaker and not already playing
        if (speaker_index === this.currentSpeaker && !this.isPlaying) {
            this.playNextChunk();
        }
    }

    onAudioStreamStop(data) {
        const { speaker_index } = data;
        // Mark speaker as complete
        const queue = this.speakerQueues.get(speaker_index) || [];
        queue.push(null);  // null = end marker
        this.speakerQueues.set(speaker_index, queue);
    }

    async playNextChunk() {
        const queue = this.speakerQueues.get(this.currentSpeaker);
        if (!queue || queue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const chunk = queue.shift();

        if (chunk === null) {
            // Current speaker done - advance to next
            console.log(`[Audio] Speaker ${this.currentSpeaker} complete`);
            this.currentSpeaker++;
            this.isPlaying = false;

            // Check if next speaker has buffered chunks
            if (this.speakerQueues.has(this.currentSpeaker)) {
                this.playNextChunk();
            }
            return;
        }

        // Decode and play the chunk
        const audioBuffer = await this.decodeChunk(chunk);
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        source.onended = () => {
            this.playNextChunk();  // Play next chunk when this one ends
        };

        source.start();
    }

    async decodeChunk(pcm16Bytes) {
        // Convert PCM16 to Float32 AudioBuffer
        const int16Array = new Int16Array(pcm16Bytes);
        const float32Array = new Float32Array(int16Array.length);

        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        const audioBuffer = this.audioContext.createBuffer(
            1,                           // mono
            float32Array.length,
            this.audioContext.sampleRate
        );
        audioBuffer.getChannelData(0).set(float32Array);

        return audioBuffer;
    }

    reset() {
        this.speakerQueues.clear();
        this.currentSpeaker = 0;
        this.isPlaying = false;
    }
}
```

---

## Message Flow Diagram

```
User: "Hey Alice and Bob!"

Backend:
  ChatLLM assigns: Alice=speaker_index:0, Bob=speaker_index:1

  Alice streams → TTSSentence(speaker_index=0) → Speech → AudioChunk(speaker_index=0)
  Bob streams   → TTSSentence(speaker_index=1) → Speech → AudioChunk(speaker_index=1)

GroupChatAudioPipeline:
  Receives: [Alice chunk 0] → yield immediately (current_speaker=0)
  Receives: [Bob chunk 0]   → buffer (speaker_index=1 > current_speaker=0)
  Receives: [Alice chunk 1] → yield immediately
  Receives: [Alice final]   → yield, advance current_speaker to 1, flush Bob's buffer
  Flushes:  [Bob chunk 0]   → yield
  Receives: [Bob chunk 1]   → yield immediately (current_speaker=1 now)
  Receives: [Bob final]     → yield

WebSocket sends (in order):
  audio_stream_start (Alice, speaker_index=0)
  audio_chunk + bytes (Alice)
  audio_chunk + bytes (Alice)
  audio_stream_stop (Alice)
  audio_stream_start (Bob, speaker_index=1)
  audio_chunk + bytes (Bob)
  audio_chunk + bytes (Bob)
  audio_stream_stop (Bob)

Frontend AudioScheduler:
  Receives Alice chunks → plays immediately (current speaker)
  Receives Bob chunks → buffers (waiting for Alice to finish PLAYING)
  Alice playback ends → advances to Bob, plays buffered chunks
```

---

## Summary of Required Changes

| Component | Change |
|-----------|--------|
| `TTSSentence` | Add `speaker_index: int = 0` field |
| `AudioChunk` | Add `speaker_index: int = 0` field |
| `ChatLLM.process_message_prompt()` | Pass `speaker_index` to `stream_character_response()` |
| `ChatLLM.stream_character_response()` | Accept `speaker_index`, include in `TTSSentence` |
| `Speech.process_sentences()` | Pass through `speaker_index` to `AudioChunk` |
| `WebSocketManager` | Add `GroupChatAudioPipeline`, use in `stream_audio_to_client()` |
| `WebSocketManager.handle_interrupt()` | Call `audio_pipeline.reset()` |
| WebSocket messages | Include `speaker_index` in all audio-related messages |
| Frontend | Implement `AudioScheduler` with speaker-based queuing |

---

## Benefits

1. **Clear turn delineation** - Each speaker has a distinct index
2. **Low latency maintained** - Current speaker's audio streams immediately
3. **No phantom audio** - Proper start/stop lifecycle per speaker
4. **Correct ordering** - Buffering ensures speakers play in order
5. **Clean interrupts** - Pipeline reset clears all state
