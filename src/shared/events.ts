import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ArrayChunk } from './bulk';

try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * Runs a set function once using events
 * @param context - event context
 * @param eventsCol - defaults to '_events'
 * @returns - true if not first run
 */
export async function eventExists(context: functions.EventContext, eventsCol = '_events'): Promise<boolean> {
  // TODO: add date input

  const eventId = context.eventId;

  // only check events once per invocation
  if (globalThis.AFF_EVENT === eventId) {
    return false;
  }
  globalThis.AFF_EVENT = eventId;

  // create event for accurate increment
  const eventRef = db.doc(`${eventsCol}/${eventId}`);
  const eventSnap = await eventRef.get();

  // do nothing if event exists
  if (eventSnap.exists) {
    console.log('Duplicate function run: ', eventId);
    return true;
  }
  // add event and update size
  eventRef
    .set({
      completed: admin.firestore.FieldValue.serverTimestamp(),
    })
    .catch((e) => {
      console.log(e);
    });
  // get yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // delete all _event docs older than yesterday
  const delDocs: FirebaseFirestore.DocumentReference[] = [];
  const eventFilter = db.collection(eventsCol).where('completed', '<=', yesterday);
  const eventFilterSnap = await eventFilter.get();
  eventFilterSnap.forEach((doc) => {
    // collect all document references
    delDocs.push(doc.ref);
  });
  const numDocs = delDocs.length;
  // chunk index array at 100 items
  const chunks = new ArrayChunk(delDocs);
  chunks.forEachChunk(async (chunk) => {
    const batch = db.batch();
    chunk.forEach((docRef) => {
      batch.delete(docRef);
    });
    // delete chunk of events
    console.log('Deleting old events');
    await batch.commit().catch((e) => {
      console.log(e);
    });
    console.log('Finished deleting ', numDocs, ' events');
  });
  return false;
}
