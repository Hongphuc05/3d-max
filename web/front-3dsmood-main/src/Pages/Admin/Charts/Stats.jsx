import React from 'react';

const stats = [
  { label: 'Unique Visitors', value: '24.7K', change: '+20%', trend: 'up' },
  { label: 'Total Pageviews', value: '55.9K', change: '+4%', trend: 'up' },
  { label: 'Bounce Rate', value: '54%', change: '-1.59%', trend: 'down' },
  { label: 'Visit Duration', value: '2m 56s', change: '+7%', trend: 'up' },
];

const Stats = () => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {stats.map((item, idx) => (
        <div key={idx} className="bg-white rounded-xl p-4 shadow">
          <p className="text-sm text-gray-500">{item.label}</p>
          <h2 className="text-2xl font-bold">{item.value}</h2>
          <p className={`${item.trend === 'up' ? 'text-green-500' : 'text-red-500'} text-xs mt-1`}>
            {item.change} Vs last month
          </p>
        </div>
      ))}
    </div>
  );
};

export default Stats;
