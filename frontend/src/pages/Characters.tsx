import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import CharacterCard from '@/components/characters/CharacterCard'
import CharacterModal from '@/components/characters/CharacterModal'
import type {
  Character,
  CharacterDraft,
} from '@/components/characters/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const emptyDraft: CharacterDraft = {
  name: '',
  image: '',
  voice: '',
  globalPrompt: '',
  systemPrompt: '',
}

const storageKey = 'bosun.characters'

const readCharacters = () => {
  if (typeof window === 'undefined') {
    return []
  }

  const stored = window.localStorage.getItem(storageKey)
  if (!stored) {
    return []
  }

  try {
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? (parsed as Character[]) : []
  } catch {
    return []
  }
}

const writeCharacters = (items: Character[]) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(items))
}

const createCharacterId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const toDraft = (character?: Character): CharacterDraft =>
  character
    ? {
        id: character.id,
        name: character.name,
        image: character.image,
        voice: character.voice,
        globalPrompt: character.globalPrompt,
        systemPrompt: character.systemPrompt,
      }
    : { ...emptyDraft }

function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<CharacterDraft>({ ...emptyDraft })
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setCharacters(readCharacters())
  }, [])

  const handleOpenCharacter = (character: Character) => {
    setDraft(toDraft(character))
    setDialogOpen(true)
  }

  const handleNewCharacter = () => {
    setDraft({ ...emptyDraft })
    setDialogOpen(true)
  }

  const handleFieldChange = (
    key: keyof CharacterDraft,
    value: string
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const input = event.target
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setDraft((prev) => ({ ...prev, image: result }))
      input.value = ''
    }
    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    const id = draft.id ?? createCharacterId()
    const existing = characters.find((character) => character.id === id)
    const record: Character = {
      id,
      name: draft.name.trim(),
      image: draft.image,
      voice: draft.voice,
      globalPrompt: draft.globalPrompt,
      systemPrompt: draft.systemPrompt,
      inChat: existing?.inChat ?? false,
    }

    setCharacters((prev) => {
      const next = prev.some((character) => character.id === id)
        ? prev.map((character) => (character.id === id ? record : character))
        : [record, ...prev]
      writeCharacters(next)
      return next
    })

    setDialogOpen(false)
  }

  const handleDelete = () => {
    if (!draft.id) {
      setDialogOpen(false)
      return
    }

    setCharacters((prev) => {
      const next = prev.filter((character) => character.id !== draft.id)
      writeCharacters(next)
      return next
    })

    setDialogOpen(false)
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleCharacters =
    normalizedQuery.length === 0
      ? characters
      : characters.filter((character) =>
          character.name.toLowerCase().includes(normalizedQuery)
        )

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-hidden p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[420px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8791]" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search characters"
            type="text"
            className="h-9 rounded-lg border-[#2f353d] bg-[#22252a] pl-9 text-sm text-[#d5d9de] placeholder:text-[#6c7480] focus-visible:border-[#3d4652] focus-visible:ring-0"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleNewCharacter}
          className={cn(
            'h-9 shrink-0 justify-center gap-2 rounded-lg bg-[#0f7cc4] px-4 text-sm text-white shadow-none',
            'hover:bg-[#1692df]'
          )}
        >
          <Plus className="h-4 w-4" />
          New Character
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-wrap items-start gap-3 p-1">
            {visibleCharacters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onOpen={handleOpenCharacter}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      <CharacterModal
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setDraft({ ...emptyDraft })
          }
        }}
        draft={draft}
        onFieldChange={handleFieldChange}
        onImageChange={handleImageChange}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  )
}

export default CharactersPage
