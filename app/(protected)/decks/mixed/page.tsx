import { redirect } from 'next/navigation'
import { StudyView } from '@/views/StudyView'

interface Props {
  searchParams: Promise<{ book?: string; chapter?: string }>
}

export default async function MixedStudyPage({ searchParams }: Props) {
  const { book, chapter } = await searchParams

  if (!book || !chapter) {
    redirect('/decks')
  }

  const bookNumber = parseInt(book, 10)
  const chapterNumber = parseInt(chapter, 10)

  if (isNaN(bookNumber) || isNaN(chapterNumber)) {
    redirect('/decks')
  }

  return <StudyView deckId="mixed" bookNumber={bookNumber} chapterNumber={chapterNumber} />
}
