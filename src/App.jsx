import { Component } from 'react'
import IronManScene from './IronManScene'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100vw', height: '100vh', background: '#000008',
          color: '#00ccff', fontFamily: 'monospace', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ fontSize: 22, letterSpacing: 4 }}>SYSTEM ERROR</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{String(this.state.error)}</div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <div style={{ position: 'relative' }}>
        <IronManScene />
      </div>
    </ErrorBoundary>
  )
}
