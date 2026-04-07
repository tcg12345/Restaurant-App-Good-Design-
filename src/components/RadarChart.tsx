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
}

export const RadarChart: React.FC<RadarChartProps> = ({ data, color = "#9f3012" }) => {
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsRadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="#e5e1e0" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: '#1e1b1a', fontSize: 10, fontWeight: 500 }}
          />
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
