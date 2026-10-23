import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/variables.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');
  if (!('noteDesk' in window)) {
    container.innerHTML =
      '<div style="padding:24px;font-family:system-ui,sans-serif;color:#b3261e"><h2>预加载脚本未加载</h2><p>请通过桌面应用（Electron）启动，而不是直接在浏览器中打开页面。</p></div>';
    return;
  }
  createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('renderer crashed:', error);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#b3261e', fontFamily: 'system-ui, sans-serif' }}>
          <h2>界面初始化失败</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

void bootstrap();
