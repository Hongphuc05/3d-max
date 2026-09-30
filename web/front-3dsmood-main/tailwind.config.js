/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        codec: ['"Codec Pro"'],
         swiss: ['Swiss721BT', 'sans-serif'],
         source: ['"Source Sans Pro"', 'sans-serif'],

      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '50%': { transform: 'translateX(4px)' },
          '75%': { transform: 'translateX(-2px)' },
        },
      },
      animation: {
        shake: 'shake 0.4s ease-in-out',
      },
      // GỘP screens ở đây
      screens: {
        '3xl': '1800px',
                // thêm 4 cỡ mong muốn
                'lap14': '1366px', // ~14.1"
                'mon21': '1600px', // ~21"
                'mon24': '1920px', // ~24"
                'mon27': '2560px', // ~27"
      },
    },
  },
  plugins: [],
}
