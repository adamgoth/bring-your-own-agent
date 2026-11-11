import { AlertCircle } from 'lucide-react';

export function ErrorNotice({ message, title = 'Something went wrong', onRetry }: { message: string; title?: string; onRetry?: () => void }) {
  // Keep programming errors out of the main message, but available for debugging.
  const technical = /is not a function|Cannot read properties|is not defined/i.test(message);
  return <div className="error-notice" role="alert">
    <AlertCircle size={17} aria-hidden="true"/>
    <div><strong>{title}</strong><p>{technical ? 'Margin could not complete this action. Try again. If it continues, export any unsaved writing and reload the page.' : message}</p>
      {technical && <details><summary>Technical details</summary><code>{message}</code></details>}
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  </div>;
}
