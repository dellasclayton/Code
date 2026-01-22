import type { KeyboardEvent } from 'react'
import { MessageCircle, User } from 'lucide-react'

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
        'group relative overflow-hidden rounded-3xl border border-[#2f353d] bg-[#111316] text-left',
        'shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition-all duration-300',
        'hover:-translate-y-1 hover:border-[#3a4048]'
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f12]/90 via-[#0d0f12]/30 to-transparent" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4">
        <div className="text-base font-semibold text-white">{cardName}</div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full border',
              character.inChat
                ? 'border-emerald-200 bg-emerald-400'
                : 'border-[#4a515c] bg-[#2a2e34]'
            )}
            aria-label={character.inChat ? 'In chat' : 'Not in chat'}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'h-8 rounded-full border-[#3a4048] bg-[#15181c]/70 px-3 text-xs text-[#dbe1e8]',
              'hover:bg-[#1e2228] hover:text-white'
            )}
          >
            <MessageCircle className="h-3.5 w-3.5 text-[#6cc5ff]" />
            Chat
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CharacterCard
