import * as admin from 'firebase-admin';
try { admin.initializeApp(); } catch (e) { }
const db = admin.firestore();

/**
 * @param change - functions change interface
 * @param context - event context
 * @param field - the field to index
 * @param fk - the foreign key field to get
 * @param n - number of word chunks to index at a time
 * @param searchCol - name of search collection
 */
export async function fullTextIndex(change: any, context: any, field: string, fk = 'id', n = 6, searchCol = '_search') {

    // get collection
    const colId = context.resource.name.split('/')[5];
    const docId = context.params.docId;

    // delimter
    const delim = '__';

    // simplify input data
    const after: any = change.after.exists ? change.after.data() : null;
    const before: any = change.before.exists ? change.before.data() : null;

    // simplify event types
    const createDoc = change.after.exists && !change.before.exists;
    const deleteDoc = change.before.exists && !change.after.exists;
    const updateDoc = change.before.exists && change.after.exists;
    const writeDoc = createDoc || updateDoc;
    const popDoc = updateDoc || deleteDoc;

    const { arrayChunk } = require('./tools');

    // update or delete
    if (popDoc) {

        // if deleting doc, field change, or foreign key change
        if (deleteDoc || before[field] !== after[field] || before[fk] !== after[fk]) {

            // get old key to delete
            const fkValue = before ? before[fk] : after[fk];

            // remove old indexes
            const delDocs: any = [];
            const searchSnap = await db.collection(`${searchCol}/${colId}/${field}`).where(fk, '==', fkValue).get();
            searchSnap.forEach((doc: any) => {
                // collect all document references
                delDocs.push(doc.ref);
            });

            // chunk index array at 100 items
            const chunks = new arrayChunk(delDocs);
            chunks.forEachChunk(async (ch: any[]) => {

                const batch = db.batch();
                // delete the docs in batches
                ch.forEach((docRef: any) => {
                    batch.delete(docRef);
                });
                console.log("Deleting batch of docs")
                await batch.commit().catch((e: any) => {
                    console.log(e);
                });
            });
        }
    }
    // create or update
    if (writeDoc) {

        // if creating a doc, field change, or foreign key change
        if (createDoc || before[field] !== after[field] || before[fk] !== after[fk]) {

            // get new key to add
            const fkValue = after ? after[fk] : before[fk];

            // new indexes
            let fieldValue = after[field];

            // if array, turn into string
            if (Array.isArray(fieldValue)) {
                fieldValue = fieldValue.join(' ');
            }
            console.log("Creating index on ", field, " field");
            const index = createIndex(fieldValue, n);

            // chunk index array at 100 items
            const chunks = new arrayChunk(index);
            chunks.forEachChunk(async (ch: any[]) => {

                const batch = db.batch();
                // create the docs in batches
                ch.forEach((a: any) => {
                    if (!a) { return; }
                    const searchRef = db.doc(`${searchCol}/${colId}/${field}/${a}${delim}${docId}`);
                    batch.set(searchRef, { [fk]: fkValue });
                });
                console.log("Creating batch of docs");
                await batch.commit().catch((e: any) => {
                    console.log(e);
                });
            });
        }
    }
    return null;
}
/**
 * Returns a search array ready to be indexed
 * @param html - to be parsed for indexing
 * @param n - number of words to index
 * @returns - array of indexes 
 */
function createIndex(html: any, n: number) {

    // get rid of pre code blocks
    function beforeReplace(text: any) {
        return text
            .replace(/&nbsp;/g, ' ')
            .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, '');
    }
    // create document after text stripped from html
    function createDocs(text: any) {
        const final_array: any = [];
        const word_array = text.toLowerCase()
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .replace(/ +/g, ' ')
            .split(' ');
        do {
            final_array.push(word_array.slice(0, n).join(' '));
            word_array.shift();
        } while (word_array.length !== 0);
        return final_array;
    }
    // strip text from html
    function extractContent(content: any) {
        const htmlToText = require('html-to-text');
        return htmlToText.fromString(content, {
            ignoreHref: true,
            ignoreImage: true
        });
    }
    // get rid of code first
    return createDocs(extractContent(extractContent(beforeReplace(html))));
}