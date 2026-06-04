'use client'

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts'

interface TripleHRadarProps {
  head: number
  heart: number
  hands: number
  size?: number
}

export function TripleHRadar({ head, heart, hands, size }: TripleHRadarProps) {
  const data = [
    { axis: 'HEAD', value: head, fullMark: 100 },
    { axis: 'HEART', value: heart, fullMark: 100 },
    { axis: 'HANDS', value: hands, fullMark: 100 },
  ]

  return (
    <div
      className="mx-auto"
      style={{ width: size ?? 300, height: size ?? 300 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
          <PolarGrid
            stroke="hsl(var(--border))"
            strokeOpacity={0.5}
            gridType="polygon"
          />
          <PolarAngleAxis
            dataKey="axis"
            tick={(props: Record<string, unknown>) => {
              const payload = props.payload as { value: string }
              const cx = Number(props.x)
              const cy = Number(props.y)
              const anchor = String(props.textAnchor) as
                | 'start'
                | 'middle'
                | 'end'

              const entry = data.find((d) => d.axis === payload.value)
              const score = entry?.value ?? 0

              // Color mapping
              const colorMap: Record<string, { text: string; badge: string }> =
                {
                  HEAD: {
                    text: 'fill-blue-500',
                    badge: 'fill-blue-500/20',
                  },
                  HEART: {
                    text: 'fill-rose-500',
                    badge: 'fill-rose-500/20',
                  },
                  HANDS: {
                    text: 'fill-green-500',
                    badge: 'fill-green-500/20',
                  },
                }
              const colors = colorMap[payload.value] ?? {
                text: 'fill-foreground',
                badge: 'fill-muted',
              }

              // Offset the label outward a bit more
              const offsetX =
                anchor === 'start' ? 8 : anchor === 'end' ? -8 : 0
              const offsetY = cy < 150 ? -6 : 6

              return (
                <g transform={`translate(${cx + offsetX},${cy + offsetY})`}>
                  <text
                    textAnchor={anchor}
                    className={`text-xs font-bold tracking-wide ${colors.text}`}
                    dy={-6}
                  >
                    {payload.value}
                  </text>
                  <text
                    textAnchor={anchor}
                    className={`text-sm font-semibold tabular-nums ${colors.text}`}
                    dy={10}
                  >
                    {score}
                  </text>
                </g>
              )
            }}
          />
          {/* HEAD - blue fill */}
          <Radar
            name="HEAD"
            dataKey="value"
            stroke="hsl(217, 91%, 60%)"
            fill="hsl(217, 91%, 60%)"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={{
              r: 4,
              fill: 'hsl(217, 91%, 60%)',
              stroke: 'white',
              strokeWidth: 2,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
