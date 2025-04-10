import NavigationAssistant from './components/NavigationAssistant'

function App() {
  return (
    <div className="min-h-screen p-4 bg-slate-50">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold mb-2">Vision Assistant</h1>
        <p className="text-slate-500">Navigation guidance for the visually impaired</p>
      </div>
      <NavigationAssistant />
    </div>
  )
}

export default App