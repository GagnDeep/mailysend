import { Input } from '@mailysend/ui'
import { useId, useState } from 'react'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * A warm-up ramp you can adjust.
 *
 * The doubling shape is the same one the send path's own rate limiter
 * converges on — halve after a rejection, at most double after a clean day —
 * so the plan a sender follows and the behaviour the software exhibits are the
 * same curve rather than two unrelated pieces of advice.
 *
 * Every row renders. The inputs move the numbers; they never hide a day.
 */
const ramp = (start: number, target: number): Array<{ day: number; volume: number }> => {
  const rows: Array<{ day: number; volume: number }> = []
  let volume = Math.max(1, Math.round(start))
  for (let day = 1; day <= 30 && rows.length < 30; day++) {
    rows.push({ day, volume: Math.min(volume, target) })
    if (volume >= target) break
    volume = Math.round(volume * 1.8)
  }
  return rows
}

export const WarmupPlanner = () => {
  const id = useId()
  const [start, setStart] = useState(200)
  const [target, setTarget] = useState(100_000)

  const rows = ramp(start, target)
  const reached = rows[rows.length - 1]?.volume ?? 0

  return (
    <WidgetShell
      title="WARM-UP PLANNER"
      source="A schedule, not a guarantee. Receivers decide the real pace, and the two signals under the table are what tell you to hold."
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <WidgetField
            label="Day one volume"
            htmlFor={`${id}-start`}
            hint="Your most engaged recipients only."
          >
            <Input
              id={`${id}-start`}
              type="number"
              min={1}
              value={start}
              onChange={(event) => setStart(Math.max(1, Number(event.target.value) || 1))}
              className="font-mono text-[13px]"
            />
          </WidgetField>
          <WidgetField label="Target daily volume" htmlFor={`${id}-target`}>
            <Input
              id={`${id}-target`}
              type="number"
              min={1}
              value={target}
              onChange={(event) => setTarget(Math.max(1, Number(event.target.value) || 1))}
              className="font-mono text-[13px]"
            />
          </WidgetField>
        </div>

        <div className="overflow-x-auto rounded-tile border border-line">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-tint text-left">
                <th className="px-4 py-2 text-[12px] font-semibold">Day</th>
                <th className="px-4 py-2 text-[12px] font-semibold">Send</th>
                <th className="px-4 py-2 text-[12px] font-semibold">Who</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day} className="border-line border-t">
                  <td className="px-4 py-1.5 font-mono text-[13px]">{row.day}</td>
                  <td className="px-4 py-1.5 font-mono text-[13px]">
                    {row.volume.toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 text-muted-2">
                    {row.day <= 3
                      ? 'Opened in the last 30 days'
                      : row.day <= 8
                        ? 'Opened in the last 90 days'
                        : row.day <= 15
                          ? 'Opened in the last 180 days'
                          : 'Everyone still engaged'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <WidgetResult tone={reached >= target ? 'positive' : 'warning'}>
          {reached >= target
            ? `Reaches ${target.toLocaleString()} a day on day ${rows.length}, if nothing pushes back.`
            : `Thirty days is not enough to reach ${target.toLocaleString()} from ${start.toLocaleString()}. Start higher, or accept a longer ramp.`}
        </WidgetResult>

        <p className="m-0 text-[13px] leading-[1.55] text-muted-2">
          Hold at the current rung — do not climb — if deferrals rise, if the unknown-user rate
          moves, or if the complaint rate moves at all. Warming faster than receivers will accept
          does not compress the timeline; it restarts it.
        </p>
      </div>
    </WidgetShell>
  )
}
