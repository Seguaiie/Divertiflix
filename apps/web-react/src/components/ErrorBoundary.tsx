import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode; fallback?: (retry: () => void) => ReactNode; onError?(e: Error): void }

/** Une erreur de rendu dans une rangée ou une page ne doit jamais blanchir toute l'application. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError?.(error); console.error(error, info.componentStack) }
  retry = () => this.setState({ error: null })
  render() { return this.state.error ? (this.props.fallback?.(this.retry) ?? null) : this.props.children }
}
