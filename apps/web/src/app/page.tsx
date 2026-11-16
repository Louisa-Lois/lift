import { API_BASE_PATH } from "@lift/shared";

// Placeholder until FE-01 builds the app shell, theme tokens, fonts and shadcn/ui.
export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, padding: 48 }}>
      <h1>Lift</h1>
      <p>The dashboard starts with FE-01 (docs/prd/02-frontend.md).</p>
      <p>
        In development, requests to <code>{API_BASE_PATH}</code> on this origin go to the API on
        port 4000. Try <a href={`${API_BASE_PATH}/health`}>{`${API_BASE_PATH}/health`}</a>.
      </p>
    </main>
  );
}
