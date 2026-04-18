import React from 'react';
import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts';

interface RadarChartProps {
  data: {
    subject: string;
    value: number;
    fullMark: number;
  }[];
  color?: string;
  /** Tailwind sizing class applied to the outer container. Defaults to a
   *  compact square that matches the flavor-profile layout on mobile. */
  className?: string;
  /** Whether to render the angle labels on the polar axis. Off by default
   *  when the list next to the chart already names each flavor. */
  showLabels?: boolean;
}

export const RadarChart: React.FC<RadarChartProps> = ({ data, color = "#9f3012", className = "w-full aspect-square", showLabels = true }) => {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsRadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="#e5e1e0" />
          {showLabels && (
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: '#1e1b1a', fontSize: 10, fontWeight: 500 }}
            />
          )}
          <Radar
            name="Taste Profile"
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.6}
          />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
};
