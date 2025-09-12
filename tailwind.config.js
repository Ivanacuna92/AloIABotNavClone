/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/web/react/index.html",
    "./src/web/react/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'navetec': {
          'primary': '#12b4ffff',
          'primary-dark': '#a41983ff',
          'primary-medium': '#0364ffff',
          'primary-light': '#5d80d8ff',
          'secondary-1': '#1aaa0dff',
          'secondary-2': '#08f000ff',
          'secondary-3': '#ea2626ff',
          'secondary-4': '#c32520ff',
        }
      },
      fontFamily: {
        'merriweather': ['Merriweather Sans', 'sans-serif'],
        'futura': ['Futura PT', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}