import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import BotDetail from './pages/BotDetail.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bot/:name" element={<BotDetail />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
