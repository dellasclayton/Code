# Updates Guide
This is a rough draft helper outline for changes to fastserver.py.

## Main Goal
To create a more modular and properly structured conversation pipeline while maintaining super low-latency (with concurrency).
WebSocketManager currently has too many (disparate) responsibilities, leaving us with no clear pipeline/conversation flow, and making it difficult to modify the generations without ttouching unrelated code.

## Structure of Document
I have tried to provide a roadmap/outline of what should change (and how) and what can stay the same. It's important to note that there are many syntax errors, as I am not a coder, so please understand that you'll need to correctly fill the gaps even on provided functions more times than not.

## Unchanged
Data Models, Queues, STT - should be able to stay as is.

## Additions
class ConversationTurn is added as the main starting point (conversation loop). This can be used as an ongoing loop, orchestrator, whatever makes the most sense.

## Main Changes
WebSocketManager: much of the unrelated stuff moved elsewhere.

TTS: tts_worker and generate_speech take places of process_sentences and generate_audio_for_sentence, respectively. tts_worker is background task. No start/stop. I've also updated all functions with a is_final to be at the end (please make sure I did it correctly).

stream_character_response and generate_sentences are now two separate functions - please review.