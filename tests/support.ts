/** Test-only deep-mutable view of a frozen domain object. */
export type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T[K] extends object
      ? DeepMutable<T[K]>
      : T[K];
};

export function mutable<T>(value: T): DeepMutable<T> {
  return value as DeepMutable<T>;
}
