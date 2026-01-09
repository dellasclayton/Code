/**
 * characters.js - Character Management Functionality
 * Handles character creation, editing, deletion, and display
 * Uses character cache for instant access with SQLite backend
 */

// Import cache and utilities
import { characterCache } from './characterCache.js';
import { handleDbError } from './db.js';
import * as websocket from './websocket.js';

// Character data storage (populated from cache)
let characters = [];
let voices = [];
let selectedCharacterId = null;
let currentCharacter = null;
let isLoading = false;
let searchQuery = '';
let modalEventsBound = false;

/**
 * Initialize the characters page
 */
export async function initCharacters() {
  searchQuery = '';
  // Create notification container
  createNotificationContainer();

  // Setup event listeners
  setupEventListeners();

  // Setup cache event handlers
  setupCacheEventHandlers();

  // Load data from cache (and initialize if needed)
  await loadData();

  console.log('Characters page initialized');
}

/**
 * Load all data from cache (instant access after initialization)
 */
async function loadData() {
  isLoading = true;
  showLoadingState();

  try {
    // Initialize cache if not already done (loads from database on first call)
    if (!characterCache.isInitialized) {
      console.log('Initializing cache from database...');
      const data = await characterCache.initialize();
      characters = data.characters;
      voices = data.voices;
      console.log(`✅ Cache initialized: ${characters.length} characters, ${voices.length} voices`);
    } else {
      // Get from cache (instant!)
      console.log('Loading from cache (instant)...');
      const data = characterCache.getAll();
      characters = data.characters;
      voices = data.voices;
      console.log(`✅ Loaded from cache: ${characters.length} characters, ${voices.length} voices`);
    }

    // Render the character grid and active list
    renderCharacterGrid();
    renderActiveCharacterList();

    // Populate voice dropdown if card is open
    populateVoiceDropdown();
  } catch (error) {
    console.error('Error loading data:', error);
    const errorMessage = handleDbError(error);
    showNotification('Error Loading Data', errorMessage, 'error');

    // Render empty state
    characters = [];
    voices = [];
    renderCharacterGrid();
    renderActiveCharacterList();
  } finally {
    isLoading = false;
    hideLoadingState();
  }
}

/**
 * Setup cache event handlers for UI updates
 */
function setupCacheEventHandlers() {
  // Character created
  characterCache.on('character:created', (character) => {
    console.log('Character created:', character.id);
    characters = characterCache.getAllCharacters();
    renderCharacterGrid();
    renderActiveCharacterList();
  });

  // Character updated
  characterCache.on('character:updated', (character) => {
    console.log('Character updated:', character.id);
    characters = characterCache.getAllCharacters();
    renderCharacterGrid();
    renderActiveCharacterList();

    // If currently viewing this character, reload its data
    if (currentCharacter && currentCharacter.id === character.id) {
      currentCharacter = character;
      loadCharacterData(character);
      updateModalChatButtonState();
    }
  });

  // Character deleted
  characterCache.on('character:deleted', ({ id }) => {
    console.log('Character deleted:', id);
    characters = characterCache.getAllCharacters();
    renderCharacterGrid();
    renderActiveCharacterList();

    if (currentCharacter && currentCharacter.id === id) {
      hideCharacterModal();
    }
  });

  // Voice created
  characterCache.on('voice:created', (voice) => {
    console.log('Voice created:', voice.voice);
    voices = characterCache.getAllVoices();
    populateVoiceDropdown();
  });

  // Voice updated
  characterCache.on('voice:updated', (voice) => {
    console.log('Voice updated:', voice.voice);
    voices = characterCache.getAllVoices();
    populateVoiceDropdown();
  });

  // Voice deleted
  characterCache.on('voice:deleted', ({ voice }) => {
    console.log('Voice deleted:', voice);
    voices = characterCache.getAllVoices();
    populateVoiceDropdown();
  });
}

/**
 * Create notification container
 */
function createNotificationContainer() {
  // Check if container already exists
  if (document.getElementById('notification-container')) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'notification-container';
  container.className = 'notification-container';
  document.body.appendChild(container);
}

/**
 * Show loading state
 */
function showLoadingState() {
  const gridContainer = document.getElementById('character-grid');
  if (gridContainer) {
    gridContainer.innerHTML = `
      <div class="character-list-loading">
        <div class="loading-spinner"></div>
        <p>Loading characters...</p>
      </div>
    `;
  }
}

/**
 * Hide loading state
 */
function hideLoadingState() {
  // Loading state will be replaced by renderCharacterGrid()
}

/**
 * Populate voice dropdown
 */
function populateVoiceDropdown() {
  const voiceSelect = document.getElementById('character-voice');
  if (!voiceSelect) return;

  // Clear existing options except the first placeholder
  voiceSelect.innerHTML = '<option value="">Select voice</option>';

  // Add voices from cache
  voices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.voice;
    option.textContent = voice.voice;
    voiceSelect.appendChild(option);
  });

  // Set current character's voice if exists
  if (currentCharacter && currentCharacter.voice) {
    voiceSelect.value = currentCharacter.voice;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Add character button
  const addBtn = document.getElementById('add-character-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => showCharacterModal(true));
  }

  // Character search
  const searchInput = document.getElementById('character-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => filterCharacters(e.target.value));
  }

  // Close card button
  const closeBtn = document.getElementById('character-card-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hideCharacterModal());
  }

  // Modal backdrop close
  const modal = document.getElementById('character-modal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        hideCharacterModal();
      }
    });
  }

  if (!modalEventsBound) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideCharacterModal();
      }
    });
    modalEventsBound = true;
  }

  // Tab buttons
  const tabButtons = document.querySelectorAll('.character-tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  // Image upload
  const imageSection = document.getElementById('image-section');
  const imageInput = document.getElementById('character-image-input');
  const avatarEditBtn = document.getElementById('avatar-edit-btn');

  if (imageSection && imageInput) {
    imageSection.addEventListener('click', () => imageInput.click());
  }

  if (avatarEditBtn && imageInput) {
    avatarEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      imageInput.click();
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', handleImageUpload);
  }

  // Character name input sync
  const characterNameInput = document.getElementById('character-name-input');
  if (characterNameInput) {
    characterNameInput.addEventListener('input', (e) => {
      const name = e.target.value || 'Character name';
      const characterName = document.getElementById('character-name-display');
      if (characterName) {
        characterName.textContent = name;
      }
    });
  }

  // Save button
  const saveBtn = document.getElementById('save-character-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveCharacter);
  }

  // Delete button
  const deleteBtn = document.getElementById('delete-character-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteCharacter);
  }

  // Chat button
  const chatBtn = document.getElementById('chat-character-btn');
  if (chatBtn) {
    chatBtn.addEventListener('click', () => handleChatWithCharacter());
  }

  // Create Voice button
  /* 
  const createVoiceBtn = document.getElementById('create-voice-btn');
  if (createVoiceBtn) {
    createVoiceBtn.addEventListener('click', handleCreateVoice);
  }
  */
}

/**
 * Render the character grid
 */
function renderCharacterGrid() {
  const gridContainer = document.getElementById('character-grid');

  if (!gridContainer) {
    console.warn('Character grid container not found');
    return;
  }

  gridContainer.innerHTML = '';

  if (characters.length === 0) {
    gridContainer.innerHTML = `
      <div class="character-grid-empty">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <p>No characters yet. Click "Add Character" to create one.</p>
      </div>
    `;
    return;
  }

  const visibleCharacters = getFilteredCharacters();

  if (visibleCharacters.length === 0) {
    gridContainer.innerHTML = `
      <div class="character-grid-empty">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <p>No matches for your search.</p>
      </div>
    `;
    return;
  }

  visibleCharacters.forEach(character => {
    const card = createCharacterCard(character);
    gridContainer.appendChild(card);
  });
}

/**
 * Render the active character list
 */
function renderActiveCharacterList() {
  const listContainer = document.getElementById('active-character-list');
  const emptyState = document.getElementById('active-character-empty');

  if (!listContainer) {
    console.warn('Active character list container not found');
    return;
  }

  listContainer.innerHTML = '';

  const activeCharacters = characters.filter(character => character.is_active);

  if (emptyState) {
    emptyState.style.display = activeCharacters.length === 0 ? 'flex' : 'none';
  }

  activeCharacters.forEach(character => {
    const item = createActiveCharacterItem(character);
    listContainer.appendChild(item);
  });
}

/**
 * Create a character card element for the grid
 */
function createCharacterCard(character) {
  const card = document.createElement('div');
  card.className = 'character-grid-card';
  card.dataset.characterId = character.id;

  if (character.id === selectedCharacterId) {
    card.classList.add('selected');
  }

  if (character.is_active) {
    card.classList.add('active');
  }

  const media = document.createElement('div');
  media.className = 'character-grid-media';

  if (character.image_url) {
    const img = document.createElement('img');
    img.src = character.image_url;
    img.alt = character.name || 'Character image';
    img.className = 'character-grid-image';
    media.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'character-grid-placeholder';
    placeholder.textContent = getCharacterInitials(character.name);
    media.appendChild(placeholder);
  }

  const footer = document.createElement('div');
  footer.className = 'character-grid-footer';

  const nameWrap = document.createElement('div');
  nameWrap.className = 'character-grid-name';

  const statusDot = document.createElement('span');
  statusDot.className = 'character-status-indicator';

  const name = document.createElement('span');
  name.className = 'character-name-text';
  name.textContent = character.name || 'Unnamed';

  nameWrap.append(statusDot, name);

  const chatBtn = document.createElement('button');
  chatBtn.type = 'button';
  chatBtn.className = 'character-grid-chat-btn';
  chatBtn.textContent = 'Chat';
  chatBtn.dataset.defaultLabel = 'Chat';
  chatBtn.setAttribute('aria-pressed', character.is_active ? 'true' : 'false');

  if (character.is_active) {
    chatBtn.classList.add('active');
  }

  chatBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    updateCharacterActiveState(character.id, !character.is_active, chatBtn);
  });

  footer.append(nameWrap, chatBtn);
  card.append(media, footer);

  card.addEventListener('click', () => openCharacterModal(character.id));

  return card;
}

/**
 * Create an active character list item
 */
function createActiveCharacterItem(character) {
  const item = document.createElement('div');
  item.className = 'active-character-item';
  item.dataset.characterId = character.id;

  const thumb = document.createElement('div');
  thumb.className = 'active-character-thumb';

  if (character.image_url) {
    const img = document.createElement('img');
    img.src = character.image_url;
    img.alt = character.name || 'Character image';
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = getCharacterInitials(character.name);
    thumb.appendChild(placeholder);
  }

  const info = document.createElement('div');
  info.className = 'active-character-info';

  const name = document.createElement('div');
  name.className = 'active-character-name';
  name.textContent = character.name || 'Unnamed';

  const status = document.createElement('div');
  status.className = 'active-character-status';
  status.textContent = 'Active';

  info.append(name, status);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'active-character-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.dataset.defaultLabel = 'Remove';
  removeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    updateCharacterActiveState(character.id, false, removeBtn);
  });

  item.append(thumb, info, removeBtn);
  item.addEventListener('click', () => openCharacterModal(character.id));

  return item;
}

function getFilteredCharacters() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...characters];
  }

  return characters.filter(character => {
    const name = (character.name || '').toLowerCase();
    const prompt = (character.system_prompt || '').toLowerCase();
    return name.includes(normalizedQuery) || prompt.includes(normalizedQuery);
  });
}

function getCharacterInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] || '';
  const second = parts.length > 1 ? parts[1][0] : (parts[0][1] || '');
  return (first + second).toUpperCase();
}

/**
 * Filter characters based on search query
 */
function filterCharacters(query) {
  searchQuery = query;
  renderCharacterGrid();
}

/**
 * Select a character and show their modal
 */
function openCharacterModal(characterId) {
  selectedCharacterId = characterId;
  currentCharacter = characters.find(c => c.id === characterId);

  if (!currentCharacter) {
    console.error('Character not found:', characterId);
    return;
  }

  renderCharacterGrid();

  const card = document.getElementById('character-card');
  const modal = document.getElementById('character-modal');
  const isModalVisible = modal?.classList.contains('show');

  if (isModalVisible && card) {
    card.classList.add('switching');

    setTimeout(() => {
      loadCharacterData(currentCharacter);
      updateModalChatButtonState();
      card.classList.remove('switching');
    }, 150);
  } else {
    loadCharacterData(currentCharacter);
    updateModalChatButtonState();
    showCharacterModal();
  }
}

/**
 * Show the character modal
 */
function showCharacterModal(isNew = false) {
  const modal = document.getElementById('character-modal');
  const card = document.getElementById('character-card');

  if (!modal || !card) {
    console.warn('Character modal not found');
    return;
  }

  if (isNew || !currentCharacter) {
    currentCharacter = {
      id: null,
      name: 'Character name',
      image_url: null,
      voice: '',
      system_prompt: '',
      images: [],
      is_active: false,
      voiceData: {
        method: 'clone',
        speaker_desc: '',
        scene_prompt: '',
        audio_path: '',
        text_path: ''
      }
    };
    selectedCharacterId = null;
    renderCharacterGrid();
    loadCharacterData(currentCharacter);
  }

  updateModalChatButtonState();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

/**
 * Hide the character modal
 */
function hideCharacterModal() {
  const modal = document.getElementById('character-modal');
  if (!modal) {
    return;
  }

  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');

  currentCharacter = null;
  selectedCharacterId = null;
  renderCharacterGrid();
}

function updateModalChatButtonState() {
  const chatBtn = document.getElementById('chat-character-btn');
  if (!chatBtn) return;

  if (!currentCharacter || !currentCharacter.id) {
    chatBtn.textContent = 'Chat';
    chatBtn.classList.remove('active');
    chatBtn.disabled = true;
    return;
  }

  chatBtn.disabled = false;
  if (currentCharacter.is_active) {
    chatBtn.textContent = 'Remove from Chat';
    chatBtn.classList.add('active');
  } else {
    chatBtn.textContent = 'Chat';
    chatBtn.classList.remove('active');
  }
}

/**
 * Load character data into the card form
 */
function loadCharacterData(character) {
  // Character name in header
  const nameDisplay = document.getElementById('character-name-display');
  if (nameDisplay) {
    nameDisplay.textContent = character.name;
  }

  // Character name input
  const nameInput = document.getElementById('character-name-input');
  if (nameInput) {
    nameInput.value = character.name;
  }

  // Avatar
  const headerAvatar = document.getElementById('header-avatar');
  const imageUploadArea = document.getElementById('image-upload-area');

  if (character.image_url) {
    if (headerAvatar) {
      headerAvatar.innerHTML = `<img src="${character.image_url}" alt="${character.name}" />`;
    }
    if (imageUploadArea) {
      imageUploadArea.innerHTML = `<img src="${character.image_url}" class="image-preview" alt="${character.name}" />`;
    }
  } else {
    if (headerAvatar) {
      headerAvatar.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      `;
    }
    if (imageUploadArea) {
      imageUploadArea.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span>Click to upload image</span>
      `;
    }
  }

  // Global prompt (not in database schema - skip for now)
  const globalPromptInput = document.getElementById('character-global-prompt');
  if (globalPromptInput) {
    globalPromptInput.value = '';
  }

  // System prompt
  const systemPromptInput = document.getElementById('character-system-prompt');
  if (systemPromptInput) {
    systemPromptInput.value = character.system_prompt || '';
  }

  // Voice
  populateVoiceDropdown();
  const voiceSelect = document.getElementById('character-voice');
  if (voiceSelect) {
    voiceSelect.value = character.voice || '';
  }

  updateModalChatButtonState();

  // Voice tab data
  /*
  if (character.voiceData) {
    const cloneRadio = document.getElementById('voice-method-clone');
    const profileRadio = document.getElementById('voice-method-profile');
    const speakerDesc = document.getElementById('voice-speaker-description');
    const scenePrompt = document.getElementById('voice-scene-prompt');
    const audioPath = document.getElementById('voice-audio-path');
    const textPath = document.getElementById('voice-text-path');

    if (cloneRadio && profileRadio) {
      if (character.voiceData.method === 'clone') {
        cloneRadio.checked = true;
      } else {
        profileRadio.checked = true;
      }
    }

    if (speakerDesc) {
      speakerDesc.value = character.voiceData.speaker_desc || '';
    }
    if (scenePrompt) {
      scenePrompt.value = character.voiceData.scene_prompt || '';
    }
    if (audioPath) {
      audioPath.value = character.voiceData.audio_path || '';
    }
    if (textPath) {
      textPath.value = character.voiceData.text_path || '';
    }

    // Update disabled states based on method
    handleVoiceMethodChange();
  }
  */
}

/**
 * Handle image upload
 */
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const imgUrl = event.target.result;

      // Update image upload area
      const imageUploadArea = document.getElementById('image-upload-area');
      if (imageUploadArea) {
        imageUploadArea.innerHTML = `<img src="${imgUrl}" class="image-preview" alt="Character image">`;
      }

      // Update header avatar
      const headerAvatar = document.getElementById('header-avatar');
      if (headerAvatar) {
        headerAvatar.innerHTML = `<img src="${imgUrl}" alt="Character avatar">`;
      }

      // Store in current character
      if (currentCharacter) {
        currentCharacter.image_url = imgUrl;
      }
    };
    reader.readAsDataURL(file);
  }
}

/**
 * Switch between tabs
 */
function switchTab(tabName) {
  // Remove active class from all buttons and panels
  document.querySelectorAll('.character-tab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  // Add active class to clicked button and corresponding panel
  const button = document.querySelector(`[data-tab="${tabName}"]`);
  const panel = document.getElementById(`${tabName}-panel`);

  if (button) button.classList.add('active');
  if (panel) panel.classList.add('active');

  // Show/hide image section based on tab
  const imageSection = document.getElementById('image-section');
  const contentSection = document.getElementById('content-section');

  if (tabName === 'profile') {
    imageSection?.classList.remove('hidden');
    contentSection?.classList.remove('full-width');
  } else {
    imageSection?.classList.add('hidden');
    contentSection?.classList.add('full-width');
  }

  // Initialize voice method state if switching to voice tab
  /*
  if (tabName === 'voice') {
    handleVoiceMethodChange();
  }
  */
}

/**
 * Handle voice method change (Clone vs Profile)
 */
/**
 * Handle voice method change (Clone vs Profile)
 */
/*
function handleVoiceMethodChange() {
  const cloneRadio = document.getElementById('voice-method-clone');
  const profileRadio = document.getElementById('voice-method-profile');
  const speakerDesc = document.getElementById('voice-speaker-description');
  const audioPath = document.getElementById('voice-audio-path');
  const textPath = document.getElementById('voice-text-path');

  if (!cloneRadio || !profileRadio || !speakerDesc || !audioPath || !textPath) {
    return;
  }

  if (cloneRadio.checked) {
    // Clone method: disable speaker description, enable audio and text paths
    speakerDesc.disabled = true;
    speakerDesc.classList.add('disabled');
    audioPath.disabled = false;
    audioPath.classList.remove('disabled');
    textPath.disabled = false;
    textPath.classList.remove('disabled');
  } else if (profileRadio.checked) {
    // Profile method: enable speaker description, disable audio and text paths
    speakerDesc.disabled = false;
    speakerDesc.classList.remove('disabled');
    audioPath.disabled = true;
    audioPath.classList.add('disabled');
    textPath.disabled = true;
    textPath.classList.add('disabled');
  }
}
*/

/**
 * Generate a voice name from character name
 */
/*
function generateVoiceName(characterName) {
  // Convert to lowercase, replace spaces with dashes, remove special chars
  const baseName = characterName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Add timestamp to ensure uniqueness
  const timestamp = Date.now();
  return `${baseName}-voice-${timestamp}`;
}
*/

/**
 * Handle Create Voice button click
 */
/*
async function handleCreateVoice() {
  const cloneRadio = document.getElementById('voice-method-clone');
  const speakerDesc = document.getElementById('voice-speaker-description');
  const scenePrompt = document.getElementById('voice-scene-prompt');
  const audioPath = document.getElementById('voice-audio-path');
  const textPath = document.getElementById('voice-text-path');

  if (!cloneRadio || !speakerDesc || !scenePrompt || !audioPath || !textPath) {
    return;
  }

  // Validate: need character name for voice name
  if (!currentCharacter || !currentCharacter.name) {
    showNotification('Validation Error', 'Please enter a character name first', 'error');
    return;
  }

  const method = cloneRadio.checked ? 'clone' : 'description';

  // Validate based on method
  if (method === 'description' && !speakerDesc.value.trim()) {
    showNotification('Validation Error', 'Speaker description is required for description method', 'error');
    return;
  }

  if (method === 'clone' && (!audioPath.value.trim() || !textPath.value.trim())) {
    showNotification('Validation Error', 'Audio path and text path are required for clone method', 'error');
    return;
  }

  // Generate voice name from character name
  const voiceName = generateVoiceName(currentCharacter.name);

  const voiceData = {
    voice: voiceName,
    method: method,
    speaker_desc: speakerDesc.value,
    scene_prompt: scenePrompt.value,
    audio_path: audioPath.value,
    text_path: textPath.value
  };

  // Disable button
  const createBtn = document.getElementById('create-voice-btn');
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';
  }

  try {
    // Create voice via cache (optimistic update + background sync)
    const data = await characterCache.createVoice(voiceData);

    console.log('Voice created:', data);

    // Update local voices array from cache
    voices = characterCache.getAllVoices();

    // Update voice dropdown
    populateVoiceDropdown();

    // Auto-select the newly created voice
    const voiceSelect = document.getElementById('character-voice');
    if (voiceSelect) {
      voiceSelect.value = data.voice;
      currentCharacter.voice = data.voice;
    }

    showNotification(
      'Voice Created',
      `Voice "${data.voice}" created successfully and assigned to ${currentCharacter.name}`,
      'success'
    );
  } catch (error) {
    console.error('Error creating voice:', error);
    const errorMessage = handleDbError(error);
    showNotification('Error Creating Voice', errorMessage, 'error');
  } finally {
    // Re-enable button
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Voice';
    }
  }
}
*/

/**
 * Save character
 */
async function saveCharacter() {
  if (!currentCharacter) {
    console.error('No character to save');
    return;
  }

  // Get form values
  const nameInput = document.getElementById('character-name-input');
  const systemPromptInput = document.getElementById('character-system-prompt');
  const voiceSelect = document.getElementById('character-voice');

  // Validate required fields
  const characterName = nameInput?.value?.trim();
  if (!characterName) {
    showNotification('Validation Error', 'Character name is required', 'error');
    return;
  }

  // Prepare character data
  const characterData = {
    name: characterName,
    system_prompt: systemPromptInput?.value || '',
    voice: voiceSelect?.value || '',
    image_url: currentCharacter.image_url || '',
    images: currentCharacter.images || [],
    is_active: currentCharacter.is_active || false,
  };

  const isNewCharacter = !currentCharacter.id;

  // Disable save button to prevent double-clicks
  const saveBtn = document.getElementById('save-character-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    let savedCharacter;

    if (isNewCharacter) {
      // Create new character via cache (optimistic update + background sync)
      savedCharacter = await characterCache.createCharacter(characterData);
      console.log('Character created:', savedCharacter);
    } else {
      // Update existing character via cache (optimistic update + background sync)
      savedCharacter = await characterCache.updateCharacter(currentCharacter.id, characterData);
      console.log('Character updated:', savedCharacter);
    }

    // Update local array from cache
    characters = characterCache.getAllCharacters();

    // Re-render the character list (UI already updated optimistically, but refresh to be sure)
    renderCharacterGrid();
    renderActiveCharacterList();

    // Show success notification
    showNotification(
      isNewCharacter ? 'Character Created' : 'Character Saved',
      `${characterName} has been ${isNewCharacter ? 'created' : 'updated'} successfully`,
      'success'
    );

    // Close the card after saving
    hideCharacterModal();
  } catch (error) {
    console.error('Error saving character:', error);
    const errorMessage = handleDbError(error);
    showNotification(
      'Error Saving Character',
      errorMessage,
      'error'
    );
  } finally {
    // Re-enable save button
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Character';
    }
  }
}

/**
 * Delete character
 */
async function deleteCharacter() {
  if (!currentCharacter || !currentCharacter.id) {
    console.error('No character to delete');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${currentCharacter.name}? This action cannot be undone.`)) {
    return;
  }

  const characterName = currentCharacter.name;
  const characterId = currentCharacter.id;

  // Disable delete button to prevent double-clicks
  const deleteBtn = document.getElementById('delete-character-btn');
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
  }

  try {
    // Delete via cache (optimistic update + background sync)
    await characterCache.deleteCharacter(characterId);

    console.log('Character deleted:', characterId);

    // Update local array from cache
    characters = characterCache.getAllCharacters();

    // Re-render the character list (UI already updated optimistically)
    renderCharacterGrid();
    renderActiveCharacterList();

    // Show success notification
    showNotification(
      'Character Deleted',
      `${characterName} has been deleted successfully`,
      'success'
    );

    // Hide the card
    hideCharacterModal();
  } catch (error) {
    console.error('Error deleting character:', error);
    const errorMessage = handleDbError(error);
    showNotification(
      'Error Deleting Character',
      errorMessage,
      'error'
    );

    // Re-enable delete button
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete';
    }
  }
}

/**
 * Handle chat button click - toggle active state
 */
async function handleChatWithCharacter() {
  if (!currentCharacter || !currentCharacter.id) {
    showNotification('Error', 'Please save the character first before chatting', 'error');
    return;
  }

  const chatBtn = document.getElementById('chat-character-btn');
  await updateCharacterActiveState(currentCharacter.id, !currentCharacter.is_active, chatBtn);
}

async function updateCharacterActiveState(characterId, isActive, buttonEl) {
  const character = characters.find(c => c.id === characterId);
  if (!character) {
    console.error('Character not found:', characterId);
    return;
  }
  const characterName = character.name || 'Character';

  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.classList.add('loading');
    if (buttonEl.id !== 'chat-character-btn') {
      buttonEl.textContent = isActive ? 'Adding...' : 'Removing...';
    }
  }

  try {
    await characterCache.updateCharacter(characterId, { is_active: isActive });

    if (websocket.isConnected()) {
      websocket.refreshActiveCharacters();
    }

    if (currentCharacter && currentCharacter.id === characterId) {
      currentCharacter.is_active = isActive;
      updateModalChatButtonState();
    }

    showNotification(
      isActive ? 'Character Activated' : 'Character Removed',
      `${characterName} ${isActive ? 'is now active for chat' : 'was removed from chat'}`,
      'success'
    );
  } catch (error) {
    console.error('Error updating character state:', error);
    const errorMessage = handleDbError(error);
    showNotification('Error Updating Character', errorMessage, 'error');
  } finally {
    if (buttonEl && buttonEl.isConnected) {
      buttonEl.disabled = false;
      buttonEl.classList.remove('loading');
      if (buttonEl.dataset.defaultLabel) {
        buttonEl.textContent = buttonEl.dataset.defaultLabel;
      }
    }
  }
}

/**
 * Get all characters
 */
export function getCharacters() {
  return characters;
}

/**
 * Get selected character
 */
export function getSelectedCharacter() {
  return currentCharacter;
}

/**
 * Show notification
 */
function showNotification(title, message, type = 'success') {
  const container = document.getElementById('notification-container');

  if (!container) {
    console.warn('Notification container not found');
    return;
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;

  // Icon based on type
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    `;
  } else if (type === 'error') {
    iconSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    `;
  } else if (type === 'warning') {
    iconSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    `;
  }

  notification.innerHTML = `
    <div class="notification-icon ${type}">
      ${iconSvg}
    </div>
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      ${message ? `<div class="notification-message">${message}</div>` : ''}
    </div>
    <button class="notification-close">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  `;

  // Add to container
  container.appendChild(notification);

  // Setup close button
  const closeBtn = notification.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => {
    removeNotification(notification);
  });

  // Show with animation
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    removeNotification(notification);
  }, 3000);
}

/**
 * Remove notification
 */
function removeNotification(notification) {
  notification.classList.remove('show');

  setTimeout(() => {
    notification.remove();
  }, 300);
}
