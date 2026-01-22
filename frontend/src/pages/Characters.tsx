import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

import CharacterCard from '@/components/characters/CharacterCard'
import CharacterModal from '@/components/characters/CharacterModal'
import type {
  Character,
  CharacterDraft,
} from '@/components/characters/types'
import { Button } from '@/components/ui/button'
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

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-hidden p-6 lg:flex-row">
      <div className="flex w-full flex-col gap-6 lg:w-[30%] lg:min-w-[220px] lg:max-w-[320px]">
        <div className="rounded-2xl border border-[#2d3138] bg-[#171a1f] p-5 shadow-[0_20px_45px_rgba(0,0,0,0.35)]">
          <Button
            type="button"
            onClick={handleNewCharacter}
            className={cn(
              'w-full justify-center gap-2 rounded-xl bg-[#0f7cc4] text-white shadow-[0_12px_30px_rgba(15,124,196,0.35)]',
              'hover:bg-[#1692df]'
            )}
          >
            <Plus className="h-4 w-4" />
            New Character
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <ScrollArea className="flex-1 min-h-0">
          <div className="grid grid-cols-2 gap-4 p-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {characters.map((character) => (
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
