import * as admin from 'firebase-admin';

const db = admin.firestore();

module.exports = {
    /**
     * Runs the counter function
     * @param change 
     * @param context 
     */
    colCounter: async function (change: any, context: any, countersCol = '_counters') {

        // get parent collection
        // TODO: will need to be edited for sub collections...
        const parentCol = context.resource.name.split('/').slice(0, -1).pop();
        //const parentDocId = context.resource.name.split('/').pop();

        // simplify event types
        const createDoc = change.after.exists && !change.before.exists;

        // check for sub collection
        const isSubCol = context.params.subDocId;

        const parentDoc = `${countersCol}/${parentCol}`;
        const countDoc = isSubCol
            ? `${parentDoc}/${context.params.docId}/${context.params.subColId}`
            : `${parentDoc}`;

        // collection references
        const countRef = db.doc(countDoc);
        const countSnap = await countRef.get();

        // increment size if doc exists
        if (countSnap.exists) {
            // createDoc or deleteDoc
            const n = createDoc ? 1 : -1;
            const i = admin.firestore.FieldValue.increment(n);

            db.runTransaction(async (t: any): Promise<any> => {
                // add event and update size
                return await t.update(countRef, { count: i });
            }).catch((e: any) => {
                console.log(e);
            });
            // otherwise count all docs in the collection and add size
        } else {
            const colRef = db.collection(change.after.ref.parent.path);
            db.runTransaction(async (t: any): Promise<any> => {
                // update size
                const colSnap = await t.get(colRef);
                return t.set(countRef, { count: colSnap.size });
            }).catch((e: any) => {
                console.log(e);
            });
        }
        return null;
    },
    /**
     * Adds a counter to a doc
     * @param change - change ref
     * @param queryRef - the query ref to count
     * @param countRef - the counter document ref
     * @param countName - the name of the counter on the counter document
     * @param del - whether or not to delete the document
     * @param n - 1 for create, -1 for delete
     */
    queryCounter: async function (change: any, queryRef: any, countRef: any, countName: string, del = 0, n = 0) {

        // simplify event type
        const createDoc = change.after.exists && !change.before.exists;

        // doc references
        const countSnap = await countRef.get();

        // increment size if field exists
        if (countSnap.get(countName)) {
            // createDoc or deleteDoc
            const _n = n !== 0 ? n : createDoc ? 1 : -1;
            const i = admin.firestore.FieldValue.increment(_n);

            // delete counter document if necessary
            if (countSnap.get(countName) === 1 && n === -1 && del === 1) {
                return countRef.delete();
            }
            db.runTransaction(async (t: any): Promise<any> => {
                // add event and update size
                return await t.set(countRef, { [countName]: i }, { merge: true });
            }).catch((e: any) => {
                console.log(e);
            });
            // otherwise count all docs in the collection and add size
        } else {
            db.runTransaction(async (t: any): Promise<any> => {
                // update size
                const colSnap = await t.get(queryRef);
                return t.set(countRef, { [countName]: colSnap.size }, { merge: true });
            }).catch((e: any) => {
                console.log(e);
            });
        }
        return null;
    }
}