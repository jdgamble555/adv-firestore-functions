import { Timestamp } from 'firebase-admin/firestore';

export function isKeyOfObject<T>(key: string | number | symbol, obj: T): key is keyof T {
  return key in obj;
}

export type DocumentRecord<K extends string, T> = { [P in K]?: T };

export function isTimestamp(value: unknown): value is Timestamp {
  return value !== null && value !== undefined && typeof (value as Timestamp).toDate === 'function';
}
