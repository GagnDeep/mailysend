import type { QueueBatch } from '@mailysend/platform'
import type { Env } from '../env.ts'

/**
 * The queues whose consumers are thin: segment recomputation, automation
 * triggers, DMARC ingestion and exports.
 *
 * They share a file because each is a dispatch into work that already lives
 * somewhere else — an actor method or a package function. Splitting them into
 * four near-identical files would add ceremony without adding clarity.
 */

export async function consumeMisc(batch: QueueBatch<{ type?: string }>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await dispatch(batch.queue, message.body, env)
      message.ack()
    } catch (err) {
      console.error(`[${batch.queue}] failed`, err)
      if (message.attempts < 4) message.retry({ delaySeconds: 30 * message.attempts })
      else message.ack()
    }
  }
}

async function dispatch(queue: string, body: { type?: string }, env: Env): Promise<void> {
  const { doName } = await import('@mailysend/core')
  const { tenancyFor } = await import('../context.ts')

  switch (queue) {
    case 'ms-segments': {
      const job = body as { workspace_id: string; segment_id: string; mode?: 'full' | 'delta' }
      const actor = env.SEGMENT.get(doName('Segment', job.workspace_id, job.segment_id))
      await (job.mode === 'delta' ? actor.delta() : actor.recompute())
      return
    }

    case 'ms-automation-triggers': {
      // Three job shapes share this queue: a trigger decides who enters, and
      // the other two carry out a `send` step for one person or for a cohort.
      // They share a queue because they share a rate: one automation's work.
      const automations = await import('../services/automations.ts')
      if (body.type === 'automation-send') {
        await automations.handleAutomationSend(body as never, env)
      } else if (body.type === 'automation-fanout') {
        await automations.handleAutomationFanOut(body as never, env)
      } else {
        await automations.handleAutomationTrigger(body as never, env)
      }
      return
    }

    case 'ms-dmarc': {
      const { ingestDmarcReport } = await import('../services/dmarc.ts')
      await ingestDmarcReport(body as never, env)
      return
    }

    case 'ms-export': {
      const { runExport } = await import('../services/export.ts')
      await runExport(body as never, env)
      return
    }

    default:
      console.warn(`[queue] no consumer for ${queue}`)
      void tenancyFor
  }
}
