import { StudyView } from '@/views/StudyView'

interface Props {
  params: Promise<{ deckId: string }>
}

export default async function StudyPage({ params }: Props) {
  const { deckId } = await params
  return <StudyView deckId={deckId} />
}
