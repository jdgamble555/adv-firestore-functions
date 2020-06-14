import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * @param change - functions change interface
 * @param context - event context
 * @param field - the field to index
 * @param fk - the foreign key field to get
 * @param n - number of word chunks to index at a time
 * @param searchCol - name of search collection
 */
export async function fullTextIndex(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  field: string,
  fk = 'id',
  type = 'id',
  n = 6,
  searchCol = '_search',
) {
  // get collection
  const colId = context.resource.name.split('/')[5];
  const docId = context.params.docId;

  // delimter
  const delim = '__';

  // term field for maps and arrays
  const termName = '_terms';

  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const deleteDoc = change.before.exists && !change.after.exists;
  const updateDoc = change.before.exists && change.after.exists;
  const writeDoc = createDoc || updateDoc;
  const popDoc = updateDoc || deleteDoc;

  const { fkChange, getValue, valueChange } = require('./tools');
  const { ArrayChunk, bulkDelete } = require('./bulk');

  // update or delete
  if (popDoc) {
    // if deleting doc, field change, or foreign key change
    if (deleteDoc || valueChange(field) || fkChange(change, fk)) {
      // get old key to delete
      const fkValue = getValue(change, fk);

      // remove old indexes
      const delDocs: any = [];
      const searchSnap = await db.collection(`${searchCol}/${colId}/${field}`).where(fk, '==', fkValue).get();
      searchSnap.forEach((doc: any) => {
        // collect all document references
        delDocs.push(doc.ref);
      });

      // delete data
      await bulkDelete(delDocs);
    }
  }
  // create or update
  if (writeDoc) {
    // if creating a doc, field change, or foreign key change
    if (createDoc || valueChange(field) || fkChange(change, fk)) {
      // add new foreign key field(s)
      const fkeys: any = {};
      if (Array.isArray(fk)) {
        fk.forEach((k: any) => {
          fkeys[k] = after ? after[k] : before[k];
        });
      } else {
        fkeys[fk] = getValue(change, fk);
      }
      // new indexes
      let fieldValue = after[field];

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }
      console.log('Generating index array on ', field, ' field');
      const index = createIndex(fieldValue, n);
      const numDocs = index.length;

      // chunk index array at 100 items
      const chunks = new ArrayChunk(index);
      chunks.forEachChunk(async (ch: any[]) => {
        const batch = db.batch();
        // create the docs in batches
        ch.forEach((phrase: string) => {
          if (!phrase) {
            return;
          }
          const searchRef = db.doc(`${searchCol}/${colId}/${field}/${phrase}${delim}${docId}`);
          const data: any = {};

          // if index for array and map types
          if (type === 'map' || type === 'array') {
            // map and array term index

            let v = '';
            const a: any[] = [];
            const m: any = {};
            for (let i = 0; i < phrase.length; i++) {
              v = phrase.slice(0, i + 1);
              if (type === 'map') {
                m[v] = true;
              } else {
                a.push(v);
              }
            }
            data[termName] = type === 'map' ? m : a;
          }
          batch.set(searchRef, { ...fkeys, ...data });
        });
        console.log('Creating batch of docs on ', field, ' field');
        await batch.commit().catch((e: any) => {
          console.log(e);
        });
      });
      console.log('Finished creating ', numDocs, ' docs on ', field, ' field');
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
    return text.replace(/&nbsp;/g, ' ').replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, '');
  }
  // create document after text stripped from html
  function createDocs(text: any) {
    const finalArray: any = [];
    const wordArray = text
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .replace(/ +/g, ' ')
      .split(' ');
    do {
      finalArray.push(wordArray.slice(0, n).join(' '));
      wordArray.shift();
    } while (wordArray.length !== 0);
    return finalArray;
  }
  // strip text from html
  function extractContent(content: any) {
    const htmlToText = require('html-to-text');
    return htmlToText.fromString(content, {
      ignoreHref: true,
      ignoreImage: true,
    });
  }
  // get rid of code first
  return createDocs(extractContent(extractContent(beforeReplace(html))));
}
