import { createFileRoute } from '@tanstack/react-router'
import { BroadcastComposer } from '~/components/app/broadcast-composer.tsx'
import { PageHeader } from '~/components/app/page.tsx'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/broadcasts/new')({
  head: () => appHead('New broadcast'),
  component: NewBroadcast,
})

function NewBroadcast() {
  return (
    <>
      <PageHeader
        eyebrow="New broadcast"
        title="Write it, then decide to send it"
        description="Saving creates a draft. Nothing leaves until you confirm the send by typing the broadcast's name."
      />
      <BroadcastComposer />
    </>
  )
}
