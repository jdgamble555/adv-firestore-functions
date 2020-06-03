import * as admin from 'firebase-admin';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();

/**
 * Runs a set function once using events
 * @returns - true if first run
 */
export async function eventExists(eventId: string, eventsCol = '_events') {
  // TODO: add date input

  const { ArrayChunk } = require('./bulk');

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
    .catch((e: any) => {
      console.log(e);
    });
  // get yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // delete all _event docs older than yesterday
  const delDocs: any = [];
  const eventFilter = db.collection(eventsCol).where('completed', '<=', yesterday);
  const eventFilterSnap = await eventFilter.get();
  eventFilterSnap.forEach((doc: any) => {
    // collect all document references
    delDocs.push(doc.ref);
  });
  const numDocs = delDocs.length;
  // chunk index array at 100 items
  const chunks = new ArrayChunk(delDocs);
  chunks.forEachChunk(async (ch: any[]) => {
    const batch = db.batch();
    ch.forEach((docRef: any) => {
      batch.delete(docRef);
    });
    // delete chunk of events
    console.log('Deleting old events');
    await batch.commit().catch((e: any) => {
      console.log(e);
    });
    console.log('Finished deleting ', numDocs, ' events');
  });
  return false;
}
