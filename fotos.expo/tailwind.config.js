/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./ios-ui/**/*.{js,jsx,ts,tsx}",
    "../vger.ui/src/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#edf8f2',
          100: '#d5efe1',
          200: '#afdcc5',
          300: '#80c4a4',
          400: '#4ca67e',
          500: '#1b7e50',
          600: '#176c45',
          700: '#16563a',
          800: '#14452f',
          900: '#113827',
        },
      },
    },
  },
  plugins: [],
}
