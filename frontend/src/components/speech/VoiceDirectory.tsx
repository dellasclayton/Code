import { Plus, Search, Volume2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import VoiceBuilderForm from '@/components/speech/VoiceBuilderForm'

type Voice = {
  id: string
  name: string
  description: string
  tags: string[]
}

const voices: Voice[] = [
  {
    id: 'aria',
    name: 'Aria',
    description: 'Warm, balanced narration with a confident cadence.',
    tags: ['English (US)', 'Warm'],
  },
  {
    id: 'atlas',
    name: 'Atlas',
    description: 'Deep, steady presence suited for long-form explainers.',
    tags: ['English (UK)', 'Gravitas'],
  },
  {
    id: 'beacon',
    name: 'Beacon',
    description: 'Clear and bright with quick, friendly enunciation.',
    tags: ['English (US)', 'Bright'],
  },
  {
    id: 'coda',
    name: 'Coda',
    description: 'Smooth midrange tone for helpful, guiding responses.',
    tags: ['English (US)', 'Friendly'],
  },
  {
    id: 'drift',
    name: 'Drift',
    description: 'Soft, airy texture for ambient storytelling.',
    tags: ['English (CA)', 'Breathy'],
  },
  {
    id: 'echo',
    name: 'Echo',
    description: 'Crisp articulation for prompts, alerts, and system cues.',
    tags: ['English (US)', 'Crisp'],
  },
  {
    id: 'lumen',
    name: 'Lumen',
    description: 'Bright, energetic delivery with a modern edge.',
    tags: ['English (US)', 'Energetic'],
  },
  {
    id: 'nova',
    name: 'Nova',
    description: 'Optimistic and upbeat for onboarding and guidance.',
    tags: ['English (US)', 'Upbeat'],
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'Neutral corporate read for product demos.',
    tags: ['English (US)', 'Neutral'],
  },
  {
    id: 'vega',
    name: 'Vega',
    description: 'Warm contralto for reflective, intimate moments.',
    tags: ['English (US)', 'Calm'],
  },
]

const alphabet = Array.from({ length: 26 }, (_, index) =>
  String.fromCharCode(65 + index)
)

const groupVoicesByLetter = (items: Voice[]) =>
  items.reduce<Record<string, Voice[]>>((groups, voice) => {
    const letter = voice.name.charAt(0).toUpperCase()
    if (!groups[letter]) {
      groups[letter] = []
    }
    groups[letter].push(voice)
    return groups
  }, {})

function VoiceDirectory() {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const filteredVoices = useMemo(() => {
    if (!normalizedQuery) {
      return voices
    }

    return voices.filter((voice) => {
      const haystack = `${voice.name} ${voice.description} ${voice.tags.join(
        ' '
      )}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [normalizedQuery])

  const groupedVoices = useMemo(() => {
    const grouped = groupVoicesByLetter(filteredVoices)
    Object.keys(grouped).forEach((letter) => {
      grouped[letter] = grouped[letter].slice().sort((a, b) => {
        return a.name.localeCompare(b.name)
      })
    })
    return grouped
  }, [filteredVoices])

  const lettersWithVoices = useMemo(
    () => alphabet.filter((letter) => groupedVoices[letter]?.length),
    [groupedVoices]
  )

  const jumpToLetter = (letter: string) => {
    const target = document.getElementById(`voice-letter-${letter}`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="flex h-full w-full flex-col p-8">
      <div className="flex min-h-0 flex-1 flex-col gap-6 xl:flex-row">
        <div className="flex w-full flex-1 flex-col xl:w-[600px] xl:flex-none">
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#2d3138] bg-[#171a1f]/85',
              'shadow-[0_20px_40px_rgba(0,0,0,0.35)]'
            )}
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-[#2a2f36] px-4 py-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d8792]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search voices..."
                  aria-label="Search voices"
                  className={cn(
                    'h-9 border-[#2d3138] bg-[#171a1f] pl-9 text-sm text-[#dfe3e8]',
                    'placeholder:text-[#6c7480] focus-visible:border-[#3a414b] focus-visible:ring-[#2c323a]'
                  )}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Create voice"
                className={cn(
                  'border-[#2f353d] bg-[#1e2228] text-[#cbd2da]',
                  'hover:border-[#3b424c] hover:bg-[#252a32] hover:text-white'
                )}
              >
                <Plus className="h-4 w-4 text-[#7fd2ff]" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1">
              <ScrollArea className="flex-1">
                <div className="px-5 py-4">
                  {lettersWithVoices.length ? (
                    <div className="space-y-8">
                      {lettersWithVoices.map((letter) => {
                        const items = groupedVoices[letter] ?? []
                        return (
                          <section
                            key={letter}
                            id={`voice-letter-${letter}`}
                            className="scroll-mt-6 space-y-3"
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#8b93a0]">
                              {letter}
                            </div>
                            <ItemGroup>
                              {items.map((voice, index) => (
                                <div key={voice.id}>
                                  <Item
                                    size="sm"
                                    role="listitem"
                                    className={cn(
                                      'border-[#2a2f36] bg-[#1a1d22]/80',
                                      'hover:bg-[#22262d]'
                                    )}
                                  >
                                    <ItemContent>
                                      <ItemTitle className="w-full">
                                        <span className="text-sm font-semibold text-[#e2e6ea]">
                                          {voice.name}
                                        </span>
                                        <div className="ml-auto flex flex-wrap items-center gap-2">
                                          {voice.tags.map((tag) => (
                                            <Badge
                                              key={tag}
                                              variant="outline"
                                              className="border-[#2a2f36] text-[10px] text-[#aab2bd]"
                                            >
                                              {tag}
                                            </Badge>
                                          ))}
                                        </div>
                                      </ItemTitle>
                                      <ItemDescription className="text-[#8b93a0]">
                                        {voice.description}
                                      </ItemDescription>
                                    </ItemContent>
                                    <ItemActions>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                          'border-[#2f353d] bg-[#1e2228] text-[#cbd2da]',
                                          'hover:border-[#3b424c] hover:bg-[#252a32] hover:text-white'
                                        )}
                                      >
                                        <Volume2 className="h-4 w-4 text-[#7fd2ff]" />
                                        Preview
                                      </Button>
                                    </ItemActions>
                                  </Item>
                                  {index < items.length - 1 ? (
                                    <ItemSeparator className="my-2 bg-[#2a2f36]" />
                                  ) : null}
                                </div>
                              ))}
                            </ItemGroup>
                          </section>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-[#7a828c]">
                      No voices match your search.
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="hidden w-10 flex-col items-center gap-1 border-l border-[#242a31] py-4 pr-3 text-[10px] font-semibold text-[#6f7782] md:flex">
                {alphabet.map((letter) => {
                  const isActive = groupedVoices[letter]?.length
                  return (
                    <button
                      key={letter}
                      type="button"
                      onClick={() => jumpToLetter(letter)}
                      disabled={!isActive}
                      aria-label={`Jump to ${letter}`}
                      className={cn(
                        'rounded-full px-1 py-0.5 transition',
                        isActive
                          ? 'text-[#8b93a0] hover:bg-[#242a31] hover:text-white'
                          : 'text-[#404751] opacity-50'
                      )}
                    >
                      {letter}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-1 flex-col">
          <VoiceBuilderForm />
        </div>
      </div>
    </div>
  )
}

export default VoiceDirectory
