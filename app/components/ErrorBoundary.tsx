"use client";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Tampilkan komponen custom saat error. Jika tidak diisi, gunakan fallback default. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Error Boundary HARUS class component — React belum support hooks untuk ini.
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log ke console agar bisa ditangkap oleh monitoring (Sentry, dll)
    console.error("[ErrorBoundary] Unhandled React error:", error);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    // ── Default fallback UI ─────────────────────────────────────────────────
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          background: "#0d1117",
          color: "#c9d1d9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            background: "#161b22",
            border: "0.5px solid #f8514940",
            borderRadius: "12px",
            padding: "2rem",
            maxWidth: "480px",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>💥</div>
          <h2 style={{ color: "#f85149", fontWeight: 600, marginBottom: "0.5rem", fontSize: "1.1rem" }}>
            Terjadi Kesalahan Tak Terduga
          </h2>
          <p style={{ color: "#8b949e", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
            Komponen mengalami error. Data yang sudah di-scrape mungkin masih tersimpan di
            localStorage dan bisa dimuat kembali setelah reset.
          </p>
          {this.state.error && (
            <pre
              style={{
                background: "#0d1117",
                border: "0.5px solid #30363d",
                borderRadius: "6px",
                padding: "0.75rem",
                fontSize: "0.75rem",
                color: "#f85149",
                textAlign: "left",
                overflowX: "auto",
                marginBottom: "1.25rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              onClick={this.handleReset}
              style={{
                background: "#238636",
                border: "none",
                borderRadius: "6px",
                color: "white",
                padding: "0.5rem 1.25rem",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              🔄 Coba Lagi
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#21262d",
                border: "0.5px solid #30363d",
                borderRadius: "6px",
                color: "#c9d1d9",
                padding: "0.5rem 1.25rem",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              🔃 Reload Halaman
            </button>
          </div>
        </div>
      </div>
    );
  }
}
