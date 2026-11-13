/** Local-only Web Speech adapter. Never use recognition without explicit local support. */
export interface LocalRecognition {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface LocalRecognitionConstructor {
  new (): LocalRecognition;
  prototype: LocalRecognition;
  available(options: { langs: string[]; processLocally: true }): Promise<string>;
  install(options: { langs: string[]; processLocally: true }): Promise<boolean>;
}
export function localRecognizer(): LocalRecognitionConstructor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: LocalRecognitionConstructor;
    webkitSpeechRecognition?: LocalRecognitionConstructor;
  };
  const API = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (
    !API ||
    !('processLocally' in API.prototype) ||
    typeof API.available !== 'function' ||
    typeof API.install !== 'function'
  )
    return;
  return API;
}

export async function withDeadline<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Speech operation timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
