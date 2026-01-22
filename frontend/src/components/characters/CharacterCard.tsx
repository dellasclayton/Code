import type { KeyboardEvent } from 'react'
import { User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Character } from '@/components/characters/types'

type CharacterCardProps = {
  character: Character
  onOpen: (character: Character) => void
}

function CharacterCard({ character, onOpen }: CharacterCardProps) {
  const cardName = character.name.trim() || 'Character name'

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(character)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${cardName} details`}
      onClick={() => onOpen(character)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative overflow-hidden rounded-3xl border-6 border-[#050607] bg-[#111316] text-left',
        'shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition-all duration-300',
        'hover:border-[#111111] hover:shadow-[0_18px_40px_rgba(0,0,0,0.35),0_0_0_2px_rgba(96,165,250,0.22)]'
      )}
    >
      <div className="relative aspect-[3/4] w-full">
        {character.image ? (
          <img
            src={character.image}
            alt={cardName}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#15181c]">
            <User className="h-12 w-12 text-[#6c7480]" />
          </div>
        )}
        {character.inChat ? (
          <div className="absolute left-3 top-3 rounded-full bg-emerald-400/95 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-950 shadow-[0_8px_18px_rgba(16,185,129,0.35)]">
            Active
          </div>
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f12]/90 via-[#0d0f12]/30 to-transparent" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4">
        <div className="text-lg font-semibold text-white">{cardName}</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'h-8 rounded-full border-white/25 bg-white/10 px-4 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(0,0,0,0.35)]',
            'transition-all duration-200',
            'hover:bg-white/20 hover:text-white',
            'opacity-0 translate-y-1 pointer-events-none',
            'group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto',
            'group-focus-visible:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:pointer-events-auto',
            'focus-visible:opacity-100 focus-visible:translate-y-0 focus-visible:pointer-events-auto',
            'cursor-pointer'
          )}
        >
          Chat
        </Button>
      </div>
    </div>
  )
}

export default CharacterCard
