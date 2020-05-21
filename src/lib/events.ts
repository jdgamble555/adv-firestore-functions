import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Runs a set function once using events
 * @returns - true if first run
 */
module.exports = {

    eventExists: async function (eventId: string, eventsCol = '_events'): Promise<boolean> {

        // TODO: add date input

        // create event for accurate increment
        const eventRef = db.doc(`${eventsCol}/${eventId}`);
        const eventSnap = await eventRef.get();

        const { arrayChunk } = require('./arrayChunk');

        // do nothing if event exists
        if (eventSnap.exists) {
            return Promise.resolve(true);
        }
        // add event and update size
        eventRef.set({
            completed: admin.firestore.FieldValue.serverTimestamp()
        }).catch((e: any) => {
            console.log(e);
        });
        // get yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // delete all _event docs older than yesterday
        const eventFilter = db.collection(eventsCol).where('completed', '<=', yesterday);
        const eventFilterSnap = await eventFilter.get();

        // chunk index array at 100 items
        const chunks = new arrayChunk(eventFilterSnap);
        chunks.forEachChunk(async (ch: any[]) => {

            const batch = db.batch();

            ch.forEach(async (doc: any) => {
                batch.delete(doc.ref);
            });
            // delete chunk of events
            await batch.commit()
                .catch((e: any) => {
                    console.log(e);
                });
        });
        return Promise.resolve(false);
    }
}