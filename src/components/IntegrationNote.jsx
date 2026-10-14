export default function IntegrationNote({ children }) {
  return (
    <div className="integration-note" role="note">
      <span className="integration-note__icon" aria-hidden="true">i</span>
      <p>{children}</p>
    </div>
  );
}
