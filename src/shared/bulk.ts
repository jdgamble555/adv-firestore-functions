import * as admin from 'firebase-admin';
import { DocumentRecord } from './types';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * Chunk array in parts
 * @param arr - array to chunk
 * @param chunk - number of chunks
 */
export class ArrayChunk<T> {
  readonly arr: T[];
  readonly chunk: number;

  constructor(arr: T[], chunk = 100) {
    this.arr = arr;
    this.chunk = chunk;
  }
  /**
   * for each chunk
   * @param funct - chunk function
   */
  forEachChunk(funct: (chunk: T[]) => Promise<void>) {
    for (let i = 0, j = this.arr.length; i < j; i += this.chunk) {
      const tempArray = this.arr.slice(i, i + this.chunk);
      void funct(tempArray);
    }
  }
}
/**
 * bulk update data
 * @param docs - doc references to update
 * @param field - field to update
 * @param data - data to update
 */
export function bulkUpdate<T extends DocumentRecord<string, unknown>>(
  docs: FirebaseFirestore.DocumentReference<T>[],
  data: object,
) {
  // number of docs to delete
  const numDocs = docs.length;

  // chunk data
  const chunks = new ArrayChunk(docs);
  chunks.forEachChunk(async (chunk) => {
    const batch = db.batch();
    // add the join data to each document
    chunk.forEach((docRef) => {
      batch.set(docRef, data, { merge: true });
    });
    console.log('Updating batch of docs');
    await batch.commit().catch((e: Error) => {
      console.log(e);
    });
  });
  console.log('Finished updating ', numDocs, ' docs');
  return null;
}
/**
 * Bulk delete data
 * @param docs - doc references to delete
 */
export function bulkDelete<T extends DocumentRecord<string, unknown>>(docs: FirebaseFirestore.DocumentReference<T>[]) {
  // number of docs to delete
  const numDocs = docs.length;

  // chunk index array at 100 items
  const chunks = new ArrayChunk(docs);
  chunks.forEachChunk(async (chunk) => {
    const batch = db.batch();

    // delete the docs in batches
    chunk.forEach((docRef) => {
      batch.delete(docRef);
    });
    console.log('Deleting batch of docs');
    await batch.commit().catch((e: Error) => {
      console.log(e);
    });
  });
  console.log('Finished deleting ', numDocs, ' docs');
  return null;
}
