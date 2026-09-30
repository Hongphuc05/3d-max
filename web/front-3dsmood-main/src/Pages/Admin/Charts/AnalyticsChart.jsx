import React from 'react';

const AnalyticsChart = () => {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
        <h3 className="font-semibold text-lg">Analytics</h3>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="px-3 py-1 bg-gray-100 rounded font-medium">12 months</button>
          <button className="px-3 py-1 rounded text-gray-500">30 days</button>
          <button className="px-3 py-1 rounded text-gray-500">7 days</button>
          <button className="px-3 py-1 rounded text-gray-500">24 hours</button>
        </div>
      </div>
      <div className="h-64 bg-gray-50 rounded flex items-center justify-center text-gray-400">
        Bar Chart
      </div>
    </div>
  );
};

export default AnalyticsChart;
