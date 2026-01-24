import CharacterDirectory from '@/components/characters/CharacterDirectory'
import CharacterEditor from '@/components/characters/CharacterEditor'

function CharactersPage() {
  return (
    <div className="h-full w-full p-6">
      <div className="grid h-full min-h-0 w-full gap-8 lg:grid-cols-[1.25fr_3fr]">
        <div className="flex h-full min-h-0 w-full flex-col">
          <CharacterDirectory />
        </div>
        <div className="flex h-full min-h-0 w-full flex-col">
          <CharacterEditor />
        </div>
      </div>
    </div>
  )
}

export default CharactersPage
