import CharacterEditor from '@/components/characters/CharacterEditor'

function CharactersPage() {
  return (
    <div className="h-full w-full p-6">
      <div className="grid h-full w-full gap-8 lg:grid-cols-[1.25fr_3fr]">
        <div className="h-full w-full" />
        <div className="h-full w-full">
          <CharacterEditor />
        </div>
      </div>
    </div>
  )
}

export default CharactersPage
