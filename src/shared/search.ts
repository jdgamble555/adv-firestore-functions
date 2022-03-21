import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * Full Text Search
 * @param change - functions change interface
 * @param context - event context
 * @param field - the field to index
 * @param fk - the foreign key fields to get
 * @param type - { id, map, array } - defaults to id
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
  const { eventExists } = require('./events');
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // get collection
  const colId = context.resource.name.split('/')[5];
  const docId = context.params.docId;

  // delimter
  const delim = '__';

  // term field for maps and arrays
  const termName = '_terms';

  const { getAfter, popDoc, deleteDoc, writeDoc, createDoc, fkChange, getValue, valueChange } = require('./tools');
  const { ArrayChunk, bulkDelete } = require('./bulk');

  // update or delete
  if (popDoc(change)) {
    // if deleting doc, field change, or foreign key change
    if (deleteDoc(change) || valueChange(change, field) || fkChange(change, fk)) {
      // get old key to delete
      const fkValue = getValue(change, fk);

      // remove old indexes
      const delDocs: any = [];

      // see if search for id field
      const sfk = (fk === 'id') ? admin.firestore.FieldPath.documentId() : fk;

      const searchSnap = await db.collection(`${searchCol}/${colId}/${field}`).where(sfk, '==', fkValue).get();
      searchSnap.forEach((doc: any) => {
        // collect all document references
        delDocs.push(doc.ref);
      });

      // delete data
      await bulkDelete(delDocs);
    }
  }
  // create or update
  if (writeDoc(change)) {
    // if creating a doc, field change, or foreign key change
    if (createDoc(change) || valueChange(change, field) || fkChange(change, fk)) {
      // add new foreign key field(s)
      const fkeys: any = {};
      if (Array.isArray(fk)) {
        fk.forEach((k: any) => {

          fkeys[k] = getValue(change, k);
        });
      } else {
        fkeys[fk] = getValue(change, fk);
      }
      // new indexes
      let fieldValue = getAfter(change, field);

      if (fieldValue === null || fieldValue === undefined) {
        return;
      }

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
          batch.set(searchRef, { ...fkeys, ...data }, { merge: true });
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
 * Relevant search callable function
 * @param _opts {
 *   query - query to search
 *   col - collection to search
 *   fields - fields to search
 *   searchCol - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   filterFunc - name of function to filter
 *   limit - number of search results to limit, default 10
 *   startId - id field for paging, only works with _all index
 * }
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
export async function relevantSearch(
  _opts: {
    query: string;
    col: string;
    fields: string;
    searchCol?: string;
    termField?: string;
    filterFunc?: any;
    limit?: number;
    startId?: string;
  }
) {
  const opts = {
    fields: _opts.fields || ['_all'],
    col: _opts.col,
    query: _opts.query,
    searchCol: _opts.searchCol || '_search',
    termField: _opts.termField || '_term',
    filterFunc: _opts.filterFunc,
    limit: _opts.limit || 10,
    startId: _opts.startId
  }

  // if soundex function or other filter
  const exp = opts.filterFunc
    ? opts.query.split(' ').map((v: string) => opts.filterFunc(v)).join(' ')
    : opts.query;

  if (typeof opts.fields === 'string') {
    opts.fields = [opts.fields];
  }

  if (opts.fields[0] === '_all') {

    // if start id
    const start = opts.startId
      ? db.doc(`${opts.searchCol}/${opts.col}/_all/${opts.startId}`)
      : [];

    const query = db.collection(`${opts.searchCol}/${opts.col}/_all`)
      .orderBy(`${opts.termField}.${exp}`, "desc").limit(opts.limit).startAfter(start);

    // return results
    const docsSnap = await query.get();

    return docsSnap.docs.map((doc: any) => {
      const data = doc.data();
      const id = doc.id;
      const relevance = data._term[exp];
      return { id, relevance };
    });
  }

  // get queries for each field
  const s: any = [];
  for (const field of opts.fields) {
    const query = db.collection(`${opts.searchCol}/${opts.col}/${field}`)
      .orderBy(`${opts.termField}.${exp}`, "desc").limit(opts.limit);
    s.push(query.get());
  }
  const docsSnaps: any = await Promise.all(s);
  const ids: any = {};
  let i = 0;

  // return merged results
  return [].concat.apply([], docsSnaps.map((q: any) => {
    // get relevant info from docs
    return q.docs.map((doc: any) => {
      const data = doc.data();
      const id = doc.id;
      const relevance = data._term[exp];
      return { id, relevance };
    });
  })).filter((r: any) => {
    // filter duplicates
    if (ids[r.id]) {
      ids[r.id] += r.relevance;
      return;
    }
    ids[r.id] = r.relevance;
    return r;
  }).map((r: any) => {
    // merge relevances
    r.relevance = ids[r.id];
    return r;
    // sort by relevance again
  }).sort((a: any, b: any) => b.relevance < a.relevance ? -1 : a.relevance ? 1 : 0)
    .filter((r: any) => {
      // limit opts.limit
      if (i < opts.limit) {
        ++i;
        return r;
      }
      return;
    });
}
/**
 * Trigram Search callable function
 * @param _opts {
 *   query - query to search
 *   col - collection to search
 *   fields - fields to search
 *   searchCol - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   limit - number of search results to limit, default 10
 * }
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
export async function trigramSearch(
  _opts: {
    query: string;
    col: string;
    fields?: string[];
    searchCol?: string;
    termField?: string;
    limit?: number;
  }
) {

  const opts = {
    fields: _opts.fields || ['_all'],
    col: _opts.col,
    query: _opts.query,
    searchCol: _opts.searchCol || '_trigrams',
    termField: _opts.termField || '_term',
    limit: _opts.limit || 10,
  }

  // trigram function
  function tg(s1: string) {
    const n = 3;
    const r: string[] = [];
    for (let k = 0; k <= s1.length - n; k++)
      r.push(s1.substring(k, k + n));
    return r;
  }

  const trigrams = tg(opts.query);
  const s: any = [];
  const searchable: any = [];

  // create searchable queries
  searchable.push({ s: trigrams, r: 3 })

  for (const a of trigrams) {
    const tg2 = trigrams.filter((t: any) => t !== a);
    searchable.push({ s: tg2, r: 2 });
    for (const b of tg2) {
      const tg3 = tg2.filter((t: any) => t !== b);
      searchable.push({ s: tg3, r: 1 });
    }
  }

  // go through each field
  for (const field of opts.fields) {
    // go through all searchable queries
    for (const gram of searchable) {
      const query = db.collection(`${opts.searchCol}/${opts.col}/${field}`);
      let newRef: any = query;
      for (const t of gram.s) {
        newRef = newRef.where(`${opts.termField}.${t}`, '==', true);
      }
      // push to new query
      s.push(newRef.get().then((r: any) => {
        r.relevance = gram.r;
        return r;
      }));
    }
  }

  const docsSnaps: any = await Promise.all(s);
  const ids: any = {};
  let i = 0;

  // return merged results
  return [].concat.apply([], docsSnaps.map((q: any) => {
    // get relevant info from docs
    return q.docs.map((doc: any) => {
      const id = doc.id;
      const data = doc.data();
      const relevance = q.relevance;
      return { id, relevance, ...data };
    });
  })).filter((r: any) => {
    // filter duplicates
    if (ids[r.id]) {
      ids[r.id] += r.relevance;
      return;
    }
    ids[r.id] = r.relevance;
    return r;
  }).map((r: any) => {
    // merge relevances
    r.relevance = ids[r.id];
    return r;
    // sort by relevance again
  }).sort((a: any, b: any) => b.relevance < a.relevance ? -1 : a.relevance ? 1 : 0)
    .filter((r: any) => {
      // limit opts.limit
      if (i < 10) {
        ++i;
        return r;
      }
      return;
    });
}
/**
 * indexes a collection by relevance
 * @param change
 * @param context
 * @param _opts: {
 *   fields - array of fields to index
 *   searchCol - name of search collection, default _search
 *   numWords - number of words to index at a time, default 6
 *   combine - whether or not to combine fields in one collection, default true
 *   combinedCol - name of combined fields collection, default _all
 *   termField - name of terms array, default _term
 *   filterFunc - function to filter, can pass a soundex function
 * }
 */
export async function relevantIndex(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  _opts: {
    fields: string[];
    searchCol?: string;
    numWords?: number;
    combine?: boolean;
    combinedCol?: string;
    termField?: string;
    filterFunc?: any;
  }
) {
  const { getAfter, deleteDoc, writeDoc } = require('./tools');
  const { eventExists } = require('./events');

  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // define default options
  const opts = {
    fields: _opts.fields,
    searchCol: _opts.searchCol || '_search',
    numWords: _opts.numWords || 6,
    combine: _opts.combine || true,
    combinedCol: _opts.combinedCol || '_all',
    termField: _opts.termField || '_term',
    filterFunc: _opts.filterFunc,
  }
  // get collection
  const colId = context.resource.name.split('/')[5];
  const docId = context.params.docId;
  const searchRef = db.doc(`${opts.searchCol}/${colId}/${opts.combinedCol}/${docId}`);

  if (typeof opts.fields === 'string') {
    opts.fields = [opts.fields];
  }

  // delete
  if (deleteDoc(change)) {
    if (opts.combine) {
      await searchRef.delete();
    } else {
      for (const field of opts.fields) {
        const searchRefF = db.doc(`${opts.searchCol}/${colId}/${field}/${docId}`);
        await searchRefF.delete();
      }
    }
  }
  // create or update
  if (writeDoc(change)) {

    const data: any = {};
    let m: any = {};

    // go through each field to index
    for (const field of opts.fields) {

      // new indexes
      let fieldValue = getAfter(change, field);

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }

      if (fieldValue === null || fieldValue === undefined) {
        return;
      }

      let index = createIndex(fieldValue, opts.numWords);

      // if filter function, run function on each word
      if (opts.filterFunc) {
        const temp = [];
        for (const i of index) {
          temp.push(i.split(' ').map((v: string) => opts.filterFunc(v)).join(' '));
        }
        index = temp;
        for (const phrase of index) {
          if (phrase) {
            let v = '';
            const t = phrase.split(' ');
            while (t.length > 0) {
              const r = t.shift();
              v += v ? ' ' + r : r;
              // increment for relevance
              m[v] = m[v] ? m[v] + 1 : 1;
            }
          }
        }
      } else {
        for (const phrase of index) {
          if (phrase) {
            let v = '';
            for (let i = 0; i < phrase.length; i++) {
              v = phrase.slice(0, i + 1);
              // increment for relevance
              m[v] = m[v] ? m[v] + 1 : 1;
            }
          }
        }
      }

      // index individual field
      if (!opts.combine) {
        data[opts.termField] = m;
        console.log('Creating relevant index on ', field, ' field for ', colId + '/' + docId);
        const searchRefF = db.doc(`${opts.searchCol}/${colId}/${field}/${docId}`);
        await searchRefF.set(data).catch((e: any) => {
          console.log(e);
        });
        // clear index history
        m = {};
      }
    }
    if (opts.combine) {
      data[opts.termField] = m;
      console.log('Saving new relevant index for ', colId + '/' + docId);
      await searchRef.set(data).catch((e: any) => {
        console.log(e);
      });
    }
  }
  return null;
};
/**
 * Generates an index for trigrams on a document
 * @param change
 * @param context
 * @param _opts {
 *   fields - array of fields to index
 *   trigramCol - name of trigram colleciton, default _trigrams
 *   combine - whether or not to combine fields in one collection, default true
 *   combinedCol - name of combined collection, default _all
 *   termField - name of field to store trigrams, default _term
 * }
 */
export async function trigramIndex(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  _opts: {
    trigramCol?: string;
    combinedCol?: string;
    combine?: boolean;
    termField?: string;
    fields: string[];
  }
) {
  const { getAfter, deleteDoc, writeDoc, generateTrigrams } = require('./tools');
  const { eventExists } = require('./events');

  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }

  const opts = {
    trigramCol: _opts.trigramCol || '_trigrams',
    combinedCol: _opts.combinedCol || '_all',
    combine: _opts.combine || true,
    termField: _opts.termField || '_term',
    fields: _opts.fields,
  }
  // get collection
  const colId = context.resource.name.split('/')[5];
  const docId = context.params.docId;
  const trigramRef = db.doc(`${opts.trigramCol}/${colId}/${opts.combinedCol}/${docId}`);

  // delete
  if (deleteDoc(change)) {
    if (opts.combine) {
      await trigramRef.delete();
    } else {
      for (const field of opts.fields) {
        const trigramRefF = db.doc(`${opts.trigramCol}/${colId}/${field}/${docId}`);
        await trigramRefF.delete();
      }
    }
  }
  // create or update
  if (writeDoc(change)) {

    let data: any = {};
    let m: any = {};

    // go through each field to index
    for (const field of opts.fields) {

      // new indexes
      let fieldValue = getAfter(change, field);

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }
      if (fieldValue === null || fieldValue === undefined) {
        return;
      }
      // generate trigrams
      const index = createIndex(fieldValue, 0, true);
      const tg = generateTrigrams(index);
      for (const gram of tg) {
        m[gram] = true;
      }
      // save data to doc
      data[`_${field}`] = index;

      // index individual field
      if (!opts.combine) {
        data[opts.termField] = m;
        console.log('Creating trigram index on ', field, ' field for ', colId + '/' + docId);
        const searchRefF = db.doc(`${opts.trigramCol}/${colId}/${field}/${docId}`);
        await searchRefF.set(data).catch((e: any) => {
          console.log(e);
        });
        // clear index history
        m = {};
        data = {};
      }
    }
    if (opts.combine) {
      data[opts.termField] = m;
      console.log('Saving new trigram index for ', colId + '/' + docId);
      await trigramRef.set(data).catch((e: any) => {
        console.log(e);
      });
    }
  }
  return null;
}
/**
 * Returns a search array ready to be indexed
 * @param html - to be parsed for indexing
 * @param n - number of words to index
 * @param stringOnly - just return string, default false
 * @returns - array of indexes
 */
function createIndex(html: any, n: number, stringOnly = false): any {
  // get rid of pre code blocks
  function beforeReplace(text: string) {
    return text.replace(/&nbsp;/g, ' ').replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, '');
  }
  // create document after text stripped from html
  function createDocs(text: string) {
    const finalArray: any = [];
    const wordArray = text
      .toLowerCase()
      // fix only english problem, get unicode for any language
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/ +/g, ' ')
      .split(' ');
    if (stringOnly) {
      return wordArray.join(' ');
    }
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

