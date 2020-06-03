import * as admin from 'firebase-admin';
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
export class ArrayChunk {
  arr: any[];
  chunk: number;

  constructor(arr: any[], chunk = 100) {
    this.arr = arr;
    this.chunk = chunk;
  }
  /**
   * for each chunk
   * @param funct - chunk function
   */
  forEachChunk(funct: (ch: any[]) => void) {
    for (let i = 0, j = this.arr.length; i < j; i += this.chunk) {
      const tempArray = this.arr.slice(i, i + this.chunk);
      funct(tempArray);
    }
  }
}
/**
 * bulk update data
 * @param docs - doc references to update
 * @param field - field to update
 * @param data - data to update
 */
export async function bulkUpdate(
  docs: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>[],
  field: string,
  data: any,
) {
  // number of docs to delete
  const numDocs = docs.length;

  // chunk data
  const chunks = new ArrayChunk(docs);
  chunks.forEachChunk(async (ch: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>[]) => {
    const batch = db.batch();
    // add the join data to each document
    ch.forEach((docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>) => {
      batch.set(docRef, data, { merge: true });
    });
    console.log('Updating batch of docs for ', field, ' field');
    await batch.commit().catch((e: any) => {
      console.log(e);
    });
  });
  console.log('Finished updating ', numDocs, ' docs on ', field, ' field');
  return null;
}
/**
 * Bulk delete data
 * @param docs - doc references to delete
 * @param field - field to delete
 */
export async function bulkDelete(
  docs: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>[],
  field: string,
) {
  // number of docs to delete
  const numDocs = docs.length;

  // chunk index array at 100 items
  const chunks = new ArrayChunk(docs);
  chunks.forEachChunk(async (ch: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>[]) => {
    const batch = db.batch();

    // delete the docs in batches
    ch.forEach((docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>) => {
      batch.delete(docRef);
    });
    console.log('Deleting batch of docs for ', field, ' field');
    await batch.commit().catch((e: any) => {
      console.log(e);
    });
  });
  console.log('Finished deleting ', numDocs, ' docs on ', field, ' field');
  return null;
}
