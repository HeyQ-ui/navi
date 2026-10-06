import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer,
} from 'recharts'
import type { RadarRow } from '../lib/result-math.js'

/**
 * 生涯倾向雷达。rows 只含 7 个画像类指标（result-math 保证）。
 * 传了 ideal 的行会多画一条墨色虚线——「你和这条路」的叠加态（主文档 §9.4）。
 */
export function ProfileRadar({ rows }: { rows: RadarRow[] }) {
  const hasIdeal = rows.some(r => r.ideal !== undefined)
  return (
    <div className="h-[320px] w-full" role="img" aria-label="生涯倾向雷达图">
      <ResponsiveContainer>
        <RadarChart data={rows} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#E6DDD0" />
          <PolarAngleAxis dataKey="name" tick={{ fill: '#6E6459', fontSize: 13 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="你" dataKey="score" stroke="#E05A1F" fill="#E05A1F"
            fillOpacity={0.22} animationDuration={600}
          />
          {hasIdeal && (
            <Radar
              name="理想画像" dataKey="ideal" stroke="#201A14" strokeDasharray="4 3"
              fill="none" animationDuration={600}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
