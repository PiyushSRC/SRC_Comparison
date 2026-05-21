import React, { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import annotationPlugin from 'chartjs-plugin-annotation';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin
);

interface ChartComponentProps {
  data: any[];
  threshold: number;
  hideTooltipInPdf?: boolean;
}

const ChartComponent = React.memo(({ data, threshold, hideTooltipInPdf = false }: ChartComponentProps) => {
  const chartData = useMemo(() => {
    return {
      labels: data.map(d => d.baseId),
      datasets: [
        {
          label: '% Var',
          data: data.map(d => d.percentageOfBase),
          backgroundColor: data.map(d => {
            if (d.percentageOfBase < (100 - threshold)) return '#f59e0b'; // Low: Yellow/Amber
            if (d.percentageOfBase > (100 + threshold)) return '#ef4444'; // High: Red
            return '#22c55e'; // Normal: Green
          }),
          borderRadius: 4,
          maxBarThickness: 40,
        },
      ],
    };
  }, [data, threshold]);

  const options = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: !hideTooltipInPdf,
          backgroundColor: '#1f2937',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          padding: 8,
          cornerRadius: 4,
          callbacks: {
            title: (context: any) => {
              if (context.length === 0) return '';
              const idx = context[0].dataIndex;
              const item = data[idx];
              return `${item.baseId} vs ${item.variantId}`;
            },
            label: (context: any) => {
              const idx = context.dataIndex;
              const item = data[idx];
              return [
                `Base: ${item.baseValue} | Var: ${item.variantValue}`,
                `Var: ${item.percentageOfBase.toFixed(2)}%`
              ];
            },
          },
        },
        annotation: {
          annotations: {
            lineBase: {
              type: 'line' as const,
              yMin: 100,
              yMax: 100,
              borderColor: '#9ca3af',
              borderWidth: 1.5,
              borderDash: [3, 3],
            },
            lineLow: {
              type: 'line' as const,
              yMin: 100 - threshold,
              yMax: 100 - threshold,
              borderColor: '#f59e0b',
              borderWidth: 1.5,
              borderDash: [4, 4],
              label: {
                content: `-${threshold}%`,
                display: true,
                position: 'end' as const,
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                color: '#f59e0b',
                font: { size: 10, weight: 'bold' as const },
                padding: 4,
              },
            },
            lineHigh: {
              type: 'line' as const,
              yMin: 100 + threshold,
              yMax: 100 + threshold,
              borderColor: '#ef4444',
              borderWidth: 1.5,
              borderDash: [4, 4],
              label: {
                content: `+${threshold}%`,
                display: true,
                position: 'end' as const,
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                color: '#ef4444',
                font: { size: 10, weight: 'bold' as const },
                padding: 4,
              },
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: '#6b7280',
            font: { size: 10 },
          },
        },
        y: {
          grid: {
            color: '#f3f4f6',
          },
          ticks: {
            color: '#6b7280',
            font: { size: 10 },
          },
        },
      },
    };
  }, [data, threshold, hideTooltipInPdf]);

  return <Bar data={chartData} options={options} />;
});

ChartComponent.displayName = 'ChartComponent';

export default ChartComponent;
