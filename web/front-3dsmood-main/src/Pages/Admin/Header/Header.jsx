import React from 'react';

const Header = () => {
  return (
    <div className="flex flex-wrap justify-between items-center mb-6 w-full">
      <input
        type="text"
        placeholder="Search or type command..."
        className="w-full sm:w-1/2 md:w-1/3 px-4 py-2 border border-gray-300 rounded-lg"
      />
      <div className="flex items-center gap-4 mt-4 sm:mt-0">
        <button className="w-10 h-10 rounded-full border border-gray-300" />
        <button className="w-10 h-10 rounded-full border border-gray-300" />
        <div className="flex items-center gap-2">
          <img
            src="https://randomuser.me/api/portraits/men/76.jpg"
            alt="Musharof"
            className="w-10 h-10 rounded-full"
          />
          <span className="font-semibold">Musharof</span>
        </div>
      </div>
    </div>
  );
};

export default Header;
