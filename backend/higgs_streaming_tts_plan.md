# Higgs Streaming TTS Component - Implementation Plan

## Overview

A standalone streaming TTS component that uses `generate_delta_stream` from `HiggsAudioServeEngine` to produce audio with consistent voice characteristics across multiple generations. Supports two voice methods: **Clone** (from reference audio) and **Profile** (from text description).

---

## Core Concepts

### Voice Consistency Mechanism

Higgs maintains voice consistency by:
1. Providing initial voice context (either audio reference or text profile)
2. **Accumulating context** from previously generated audio tokens and messages
3. Feeding this accumulated context into each subsequent generation

This means the component must track and concatenate:
- **Reference audio tokens** (for clone method)
- **Generated audio tokens** from all previous generations
- **Message history** (user prompts + assistant audio responses)

---

## Data Structures

### Existing Types (from `boson_multimodal/data_types.py`)

```python
@dataclass
class AudioContent:
    audio_url: str                    # Path to audio file or "placeholder" or ""
    raw_audio: Optional[str] = None   # Base64 encoded audio bytes
    type: str = "audio"

@dataclass
class TextContent:
    text: str
    type: str = "text"

@dataclass
class Message:
    role: str                         # "system", "user", "assistant"
    content: Union[str, AudioContent, TextContent, List[...]]

@dataclass
class ChatMLSample:
    messages: List[Message]
```

### Streaming Output (from `serve_engine.py`)

```python
@dataclass
class HiggsAudioStreamerDelta:
    text: Optional[str] = None
    text_tokens: Optional[torch.Tensor] = None
    audio_tokens: Optional[torch.Tensor] = None  # Shape: (num_codebooks,) per step
    finish_reason: Optional[str] = None
```

---

## Two Voice Methods

### Method 1: Clone (Reference Audio)

**Inputs Required:**
- `audio_path`: Path to `.wav` file (the voice to clone)
- `text_path`: Path to `.txt` file (transcript of the audio)

**How It Works:**
1. Encode reference audio to tokens: `audio_tokenizer.encode(audio_path)`
2. Read transcript text from `text_path`
3. Build initial messages:
   ```python
   messages = [
       Message(role="system", content="Generate audio following instruction."),
       Message(role="user", content=transcript_text),
       Message(role="assistant", content=AudioContent(audio_url=""))  # placeholder
   ]
   ```
4. Store `reference_audio_ids` for context

**System Message Options:**
- Simple: `"Generate audio following instruction."`
- With scene: `"Generate audio following instruction.\n\n<|scene_desc_start|>\n{scene_prompt}\n<|scene_desc_end|>"`

### Method 2: Profile (Text Description)

**Inputs Required:**
- `speaker_desc`: Text describing voice characteristics (e.g., "feminine, warm tone, conversational pace")
- `scene_prompt` (optional): Scene/environment description

**How It Works:**
1. No reference audio needed
2. Build system message with voice profile:
   ```python
   system_content = (
       "Generate audio following instruction.\n\n"
       f"<|scene_desc_start|>\n"
       f"SPEAKER0: {speaker_desc}\n"
       f"<|scene_desc_end|>"
   )
   # With optional scene prompt:
   system_content = (
       "Generate audio following instruction.\n\n"
       f"<|scene_desc_start|>\n{scene_prompt}\n\n"
       f"SPEAKER0: {speaker_desc}\n"
       f"<|scene_desc_end|>"
   )
   ```
3. No initial audio tokens (empty `audio_ids`)

---

## Context Accumulation Pattern

### Key Insight from `generation.py`

The critical pattern for voice consistency across generations:

```python
# Initial context
audio_ids = [reference_audio_tokens]  # Clone only; empty for Profile
generation_messages = []               # Track conversation history
generated_audio_ids = []               # Accumulate generated audio tokens

# For EACH generation:
for chunk_text in text_chunks:
    # 1. Add user message with text to speak
    generation_messages.append(Message(role="user", content=chunk_text))

    # 2. Build ChatMLSample with ALL messages
    chatml_sample = ChatMLSample(messages=base_messages + generation_messages)

    # 3. Prepare context audio tokens (reference + all generated)
    context_audio_ids = audio_ids + generated_audio_ids

    # 4. Generate audio (streaming)
    async for delta in engine.generate_delta_stream(chatml_sample, ...):
        # Collect audio tokens from delta
        ...

    # 5. After generation complete:
    # - Append generated audio tokens to generated_audio_ids
    generated_audio_ids.append(new_audio_tokens)

    # - Append assistant message placeholder
    generation_messages.append(Message(role="assistant", content=AudioContent(audio_url="")))

    # 6. Optional: Trim old context to prevent memory growth
    if buffer_size and len(generated_audio_ids) > buffer_size:
        generated_audio_ids = generated_audio_ids[-buffer_size:]
        generation_messages = generation_messages[(-2 * buffer_size):]
```

### Building ChatMLDatasetSample with Context

From `generation.py:309-324`:

```python
context_audio_ids = audio_ids + generated_audio_ids

curr_sample = ChatMLDatasetSample(
    input_ids=torch.LongTensor(input_tokens),
    label_ids=None,
    audio_ids_concat=torch.concat([ele.cpu() for ele in context_audio_ids], dim=1)
        if context_audio_ids else None,
    audio_ids_start=torch.cumsum(
        torch.tensor([0] + [ele.shape[1] for ele in context_audio_ids], dtype=torch.long), dim=0
    ) if context_audio_ids else None,
    audio_waveforms_concat=None,
    audio_waveforms_start=None,
    audio_sample_rate=None,
    audio_speaker_indices=None,
)
```

---

## Audio Token Processing

### During Streaming

Each `HiggsAudioStreamerDelta` yields audio tokens with shape `(num_codebooks,)` per timestep. Accumulate them:

```python
audio_token_buffer = []
async for delta in streamer:
    if delta.audio_tokens is not None:
        audio_token_buffer.append(delta.audio_tokens)

# Stack to get shape (num_codebooks, seq_len)
raw_audio_tokens = torch.stack(audio_token_buffer, dim=1)
```

### Post-Processing Generated Tokens

From `generation.py:352-360` and `serve_engine.py:400-403`:

```python
from boson_multimodal.model.higgs_audio.utils import revert_delay_pattern

# 1. Revert delay pattern
audio_out_ids = revert_delay_pattern(raw_audio_tokens)

# 2. Clip to valid codebook range
audio_out_ids = audio_out_ids.clip(0, audio_tokenizer.codebook_size - 1)

# 3. Remove BOS/EOS tokens (first and last columns)
audio_out_ids = audio_out_ids[:, 1:-1]

# 4. Decode to waveform
waveform = audio_tokenizer.decode(audio_out_ids.unsqueeze(0))[0, 0]
# Returns numpy array, sample_rate = audio_tokenizer.sampling_rate (typically 24000)
```

---

## Proposed Component Design

### Class: `HiggsStreamingTTS`

```python
@dataclass
class TTSConfig:
    method: str  # "clone" or "profile"
    # Clone method
    audio_path: Optional[str] = None
    text_path: Optional[str] = None
    # Profile method
    speaker_desc: Optional[str] = None
    scene_prompt: Optional[str] = None
    # Generation params
    max_new_tokens: int = 2048
    temperature: float = 1.0
    top_k: int = 50
    top_p: float = 0.95
    context_buffer_size: Optional[int] = None  # Limit context history


class HiggsStreamingTTS:
    def __init__(self, engine: HiggsAudioServeEngine, config: TTSConfig):
        self.engine = engine
        self.config = config

        # State for context accumulation
        self._base_messages: List[Message] = []
        self._reference_audio_ids: List[torch.Tensor] = []
        self._generated_audio_ids: List[torch.Tensor] = []
        self._generation_messages: List[Message] = []

        # Initialize based on method
        self._initialize_voice_context()

    def _initialize_voice_context(self):
        """Set up base messages and reference audio based on method."""
        if self.config.method == "clone":
            self._init_clone()
        elif self.config.method == "profile":
            self._init_profile()

    async def generate_stream(self, text: str) -> AsyncGenerator[bytes, None]:
        """Generate audio for text, yielding audio chunks as they're produced."""
        ...

    def reset_context(self):
        """Clear accumulated generation context (keep base voice config)."""
        self._generated_audio_ids.clear()
        self._generation_messages.clear()
```

---

## Implementation Steps

### Step 1: Create Helper Functions

**File:** `backend/boson_multimodal/serve/tts_helpers.py`

```python
def build_clone_context(
    audio_path: str,
    text_path: str,
    audio_tokenizer,
    scene_prompt: Optional[str] = None
) -> Tuple[List[Message], List[torch.Tensor]]:
    """Build initial messages and audio tokens for clone method."""

def build_profile_context(
    speaker_desc: str,
    scene_prompt: Optional[str] = None
) -> Tuple[List[Message], List[torch.Tensor]]:
    """Build initial messages for profile method (no audio tokens)."""

def build_chatml_sample_with_context(
    base_messages: List[Message],
    generation_messages: List[Message],
    new_text: str
) -> ChatMLSample:
    """Build ChatMLSample for next generation."""

def process_streamed_audio_tokens(
    audio_tokens_list: List[torch.Tensor],
    audio_tokenizer,
    use_delay_pattern: bool = True
) -> Tuple[torch.Tensor, np.ndarray, int]:
    """Process accumulated tokens into final audio.
    Returns: (processed_tokens, waveform, sample_rate)
    """
```

### Step 2: Modify `serve_engine.py` (if needed)

**Current limitation:** `_prepare_inputs` in `HiggsAudioServeEngine` doesn't accept pre-computed `audio_ids`. It loads audio from `AudioContent.audio_url` or `raw_audio`.

**Two options:**

1. **Option A (Preferred):** Add method to accept pre-computed audio context:
   ```python
   def _prepare_inputs_with_context(
       self,
       chat_ml_sample: ChatMLSample,
       context_audio_ids: List[torch.Tensor],  # Pre-computed tokens
       force_audio_gen: bool = False
   ):
   ```

2. **Option B:** Store generated audio to temp files and reference via `audio_url`. Less efficient but requires no engine changes.

### Step 3: Create Main Component

**File:** `backend/boson_multimodal/serve/streaming_tts.py`

Implement `HiggsStreamingTTS` class with:
- `__init__`: Initialize engine, config, voice context
- `_init_clone()`: Load reference audio, encode tokens, build messages
- `_init_profile()`: Build system message with speaker description
- `generate_stream(text)`: Main streaming generation method
- `_build_generation_sample()`: Build ChatMLSample with accumulated context
- `_accumulate_context(audio_tokens)`: Add generated tokens to history
- `reset_context()`: Clear generation history

---

## Questions for Clarification

1. **Real-time streaming:** Should we yield partial audio chunks during generation, or yield complete audio after each generation finishes?
   - Partial: More complex, requires handling incomplete delay patterns
   - Complete: Simpler, but higher latency per chunk

2. **Context buffer management:** What's a reasonable default for `context_buffer_size`? The example uses `generation_chunk_buffer_size` but doesn't specify a default.

3. **Error handling:** How should we handle generation failures mid-conversation? Reset context or attempt recovery?

4. **Thread safety:** Will this component be used from multiple async tasks? If so, need to protect the context state.

5. **Engine modification preference:** Should we modify `serve_engine.py` to accept pre-computed audio tokens (cleaner), or work around it with temp files (no engine changes)?

---

## File Structure

```
backend/boson_multimodal/serve/
├── serve_engine.py          # Existing - may need minor modification
├── streaming_tts.py         # NEW - Main HiggsStreamingTTS component
└── tts_helpers.py           # NEW - Helper functions for message/context building
```

---

## Testing Checklist

- [ ] Clone method: Single generation with reference audio
- [ ] Clone method: Multiple generations maintain voice consistency
- [ ] Profile method: Single generation with text description
- [ ] Profile method: Multiple generations maintain voice consistency
- [ ] Context buffer trimming works correctly
- [ ] Audio tokens correctly processed (delay pattern reversion, clipping)
- [ ] Waveform output is valid audio at correct sample rate
- [ ] Error handling for invalid audio paths
- [ ] Error handling for generation failures
