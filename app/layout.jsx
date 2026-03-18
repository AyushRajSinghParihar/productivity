import './globals.css'
import Toolbar from './components/Toolbar'

export const metadata = {
  title: 'Focus Board',
  description: 'Your personal focus dashboard',
}

const themeScript = `
  (function() {
    try {
      var s = localStorage.getItem('focusboard-settings');
      var t = s ? JSON.parse(s).theme : 'dark';
      document.documentElement.setAttribute('data-theme', t || 'dark');
    } catch(e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
`

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Toolbar />
        {children}
      </body>
    </html>
  )
}
