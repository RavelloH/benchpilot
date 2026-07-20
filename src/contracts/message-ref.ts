export type MessageValue = string | number | boolean | null;

export interface MessageRef<Key extends string = string> {
  readonly key: Key;
  readonly values?: Readonly<Record<string, MessageValue>>;
  readonly fallback?: string;
}

export const messageRef = <Key extends string>(
  key: Key,
  values?: Readonly<Record<string, MessageValue>>,
  fallback?: string,
): MessageRef<Key> => ({
  key,
  ...(values ? { values } : {}),
  ...(fallback ? { fallback } : {}),
});
